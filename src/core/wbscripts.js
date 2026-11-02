// Scripts do ANSYS Workbench (IronPython) gerados a partir da configuração do pacote, para copiar e
// colar na Command Window (File > Scripting > Open Command Window) ou rodar como arquivo
// (File > Scripting > Run Script File). O aplicativo não executa nada no ANSYS: só escreve o texto.
// Base: scripts usados no VDI (Ansys 2025 R2) — Mechanical 2D, journal Python do Fluent e design points.

import { DEFAULT_FLUENT, referenceValues, reportDefinitions, forceVectors, dsName } from './fluent.js';
import { doeVariables } from './doe.js';
import { parseNum } from './num.js';

export const DEFAULT_WB = Object.freeze({
  systemName: '',       // nome do sistema Fluid Flow no Workbench ('' = nome do pacote)
  geometryPath: '',     // peça do SolidWorks (ex.: C:/fw_estudo/2D/Geometry/<cfg>/<cfg> 2025.SLDPRT)
  projectPath: '',      // projeto .wbpj (a pasta dele recebe os scripts e os logs)
  turb: null,           // 'geko' | 'sst' | null (automático pelo texto "Modelo de turbulência")
  csep: null,           // GEKO Csep (null = valor do texto do modelo; senão 1,75 = padrão do Fluent)
  processors: 4, precision: 'Double',
  iterations: 1500, residual: 1e-6,
  // parada por estabilização de lift_force/drag_force (o resíduo 1e-6 não é atingido: o DP 0 do 1E
  // rodou 3000 iterações com as forças estáveis desde ~120); stop = variação relativa máxima
  conv: { enabled: true, stop: 1e-4, ignore: 100, use: 50 },
  turbIntensity: 1, viscRatio: 10, // inlet: intensidade [%] e razão de viscosidade turbulenta
  initHybrid: true, generateMesh: true, edgeHard: true, solve: false,
  wingSoi: { enabled: true, radius: 0.75, size: null }, // esfera de influência na asa: raio × C, tamanho (mm; null = C/200)
  dp: { param: '', values: '', applyDP0: true, retained: false },
});

export const STAGES = [
  { id: 'workbench', n: 1, title: 'Workbench: sistema Fluid Flow (Fluent) + geometria', tested: true },
  { id: 'mesh', n: 2, title: 'Mechanical: Named Selections + controles de malha', tested: true },
  { id: 'fluent', n: 3, title: 'Fluent: journal Python do setup', tested: true },
  { id: 'dps', n: 4, title: 'Design points (sem resolver)', tested: false },
];

const slash = (p) => String(p || '').trim().replace(/\\/g, '/');
const dirOf = (p) => { const s = slash(p); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : s; };
const ascii = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_');
const safe = (s) => ascii(s).replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'pacote';
/** Literal de string Python (aspas duplas). */
export const py = (s) => JSON.stringify(String(s));
/** Número no formato Python (ponto decimal, sem lixo de ponto flutuante). */
export const pn = (v) => { const x = v == null || v === '' ? NaN : Number(v); if (!Number.isFinite(x)) return 'None'; const t = String(+x.toPrecision(10)); return /[.eE]/.test(t) ? t : `${t}.0`; };
const pnum = (v) => (Number.isFinite(Number(v)) ? String(+Number(v).toPrecision(10)) : 'None');
const pyList = (a, f = pn) => `[${a.map(f).join(', ')}]`;

/** Lista de valores digitada pelo usuário ("0; 0,3; 0,6" ou uma por linha). */
export function parseValues(text) {
  return String(text || '').split(/[;\n\r\t]+/).map((t) => t.trim()).filter(Boolean).map(parseNum);
}

/** Opções do pacote mescladas com os padrões, já resolvidas (caminhos, turbulência, Csep). */
export function wbSettings(pkg) {
  const c = pkg.config, w = c.workbench || {};
  const s = { ...DEFAULT_WB, ...w, wingSoi: { ...DEFAULT_WB.wingSoi, ...(w.wingSoi || {}) }, dp: { ...DEFAULT_WB.dp, ...(w.dp || {}) }, conv: { ...DEFAULT_WB.conv, ...(w.conv || {}) } };
  const f = { ...DEFAULT_FLUENT, ...c.fluent };
  const visc = String(f.viscous || '');
  s.turbResolved = s.turb || (/geko/i.test(visc) ? 'geko' : 'sst');
  const m = visc.match(/Csep\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i);
  s.csepResolved = Number.isFinite(Number(s.csep)) && s.csep !== null ? Number(s.csep) : m ? parseNum(m[1]) : 1.75;
  s.name = String(s.systemName || '').trim() || pkg.name;
  s.wbpj = slash(s.projectPath) || `C:/CFD/${safe(pkg.name)}/${safe(pkg.name)}.wbpj`;
  if (!/\.wbpj$/i.test(s.wbpj)) s.wbpj = `${s.wbpj.replace(/\/$/, '')}/${safe(pkg.name)}.wbpj`;
  s.dir = dirOf(s.wbpj);
  s.tag = safe(s.name);
  s.files = { mesh: `${s.dir}/scripts/mesh_${s.tag}.py`, fluent: `${s.dir}/scripts/fluent_${s.tag}.py`, logMesh: `${s.dir}/log_mesh_${s.tag}.txt`, logFluent: `${s.dir}/log_fluent_${s.tag}.txt` };
  s.geometry = slash(s.geometryPath);
  s.mode = c.mode === '3D' ? '3D' : '2D';
  return s;
}

/** Sugestões de parâmetros para a etapa 4 (nomes DS_ das variáveis do pacote + velocidade). */
export function dpParamOptions(pkg) {
  const out = [];
  doeVariables(pkg).forEach((v) => { const d = dsName(v.key, pkg); if (d && !out.includes(d)) out.push(d); });
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  out.push((f.names && f.names.uinf) || 'Uinf');
  return out;
}

/** Envolve um script interno: o script do Workbench grava o arquivo linha a linha (cabe na Command Window). */
function writerLines(path, inner) {
  const out = ['import codecs', '_L = []'];
  inner.split('\n').forEach((l) => out.push(`_L.append(${py(l)})`));
  out.push(`_f = codecs.open(${py(path)}, "w", "utf-8"); _f.write("\\n".join(_L) + "\\n"); _f.close()`);
  return out;
}

const header = (pkg, s, what) => [
  '# -*- coding: utf-8 -*-',
  `# ${what} — pacote "${pkg.name}" (gerado pelo AERO MULT-MR ELEMENTS em ${new Date().toISOString().slice(0, 10)})`,
  '# Rodar no Workbench: File > Scripting > Run Script File (recomendado) ou colar na Command Window.',
];
const sysLine = (s) => `s = [x for x in GetAllSystems() if x.DisplayText == ${py(s.name)}][0]   # sistema criado na etapa 1`;

// ---------------------------------------------------------------- etapa 1
export function scriptWorkbench(pkg) {
  const s = wbSettings(pkg), issues = [];
  if (!s.geometry) issues.push({ level: 'erro', msg: 'Informe o caminho da peça do SolidWorks (.SLDPRT).' });
  if (!slash(s.projectPath)) issues.push({ level: 'aviso', msg: `Sem caminho do projeto: usando ${s.wbpj}.` });
  const L = [...header(pkg, s, 'Etapa 1: projeto + geometria'),
    `s = GetTemplate(TemplateName="Fluid Flow", Solver="FLUENT").CreateSystem()`,
    `s.DisplayText = ${py(s.name)}`,
    'geo = s.GetContainer(ComponentName="Geometry")',
    `geo.SetFile(FilePath=${py(s.geometry || 'C:/CAMINHO/DA/PECA.SLDPRT')})`];
  if (s.mode === '2D') L.push('geo.GetGeometryProperties().GeometryImportAnalysisType = "AnalysisType_2D"');
  else L.push('# 3D: o tipo de análise padrão do Workbench já é 3D');
  L.push(`Save(FilePath=${py(s.wbpj)}, Overwrite=True)`,
    '# Parâmetros DS_ (SolidWorks): abra a Geometry (DesignModeler), Import1 > "Publish All Parameters" = Yes',
    '# (às vezes é preciso marcar as caixas P à mão), Refresh = "Use Geometry Parameter Values" e Generate.');
  return { text: L.join('\n') + '\n', file: `1_workbench_${s.tag}.py`, issues };
}

// ---------------------------------------------------------------- etapa 2
function meshInner(pkg, s, issues) {
  const c = pkg.config, m = c.mesh, ref = referenceValues(pkg);
  const chords = ref.chords.map((x) => Number(x) / 1000);
  const n = chords.length, C = chords.reduce((a, b) => a + b, 0);
  if (chords.some((x) => !(x > 0))) issues.push({ level: 'erro', msg: 'Há elemento sem corda de referência (Geometria).' });
  const mmm = (v) => (Number(v) > 0 ? Number(v) / 1000 : null);
  const gmax = mmm(m.globalMax);
  if (!gmax) issues.push({ level: 'erro', msg: 'Informe o tamanho global do elemento (Mesh).' });
  const ground = !!c.domain?.groundEnabled;
  const sizing = Array.from({ length: n }, (_, i) => {
    const es = (m.edgeSizing || []).find((e) => e.target === `wall_element_${i + 1}`);
    if (!es || es.enabled === false || !(Number(es.value) > 0)) return 'None';
    if (es.bias) issues.push({ level: 'aviso', msg: `Bias de ${es.target} não é aplicado pelo script (ajuste à mão se precisar).` });
    return es.type === 'divisoes' ? `("div", ${Math.round(es.value)})` : `("size", ${pn(es.value / 1000)})`;
  });
  const R = m.refinements || {};
  const gsize = ground && R.ground?.enabled && Number(R.ground.size) > 0 ? R.ground.size / 1000 : null;
  const wake = R.wake?.enabled && Number(R.wake.size) > 0 ? [Number(R.wake.length) || 2, R.wake.size / 1000] : null;
  const wing = s.wingSoi.enabled ? [Number(s.wingSoi.radius) || 0.75, Number(s.wingSoi.size) > 0 ? s.wingSoi.size / 1000 : C / 200] : null;
  ['le', 'te', 'gap', 'flap', 'gurney'].forEach((k) => { if (R[k]?.enabled) issues.push({ level: 'aviso', msg: `Refinamento "${R[k].label}" está ligado no plano, mas não é criado pelo script (aplique no Mechanical).` }); });
  const groups = new Map();
  (m.inflation || []).filter((x) => x.enabled && Number(x.firstLayer) > 0 && Number(x.layers) > 0).forEach((x) => {
    if (x.surface === 'ground' && !ground) return;
    const k = [x.firstLayer, x.layers, x.growth || 1.2].join('|');
    if (!groups.has(k)) groups.set(k, { names: [], y1: x.firstLayer / 1000, nl: Math.round(x.layers), gr: x.growth || 1.2 });
    groups.get(k).names.push(x.surface);
  });
  if (!groups.size) issues.push({ level: 'aviso', msg: 'Nenhuma inflation ativa com 1ª camada e nº de camadas.' });
  const infl = [...groups.values()].map((g) => `(${pyList(g.names, py)}, ${pn(g.y1)}, ${g.nl}, ${pn(g.gr)})`);
  const defeat = mmm(m.defeature);
  return `# Mechanical 2D: named selections por posicao + malha CFD (gerado pelo AERO MULT-MR ELEMENTS)
# Pacote: ${ascii(pkg.name)} | valores em metros
LOGP = ${py(s.files.logMesh)}
N_EL = ${n}
CHORDS = ${pyList(chords)}   # cordas do site, na ordem wall_element_1..n
C = ${pn(C)}
GLOBAL = ${pn(gmax)}
GROWTH = ${pn(m.growthRate || 1.2)}
DEFEAT = ${defeat ? pn(defeat) : 'None'}
METHOD = ${py(m.method || 'triangles')}
WALL_SIZING = [${sizing.join(', ')}]   # ("size", m) | ("div", n) | None
EDGE_HARD = ${s.edgeHard ? 'True' : 'False'}
GROUND = ${ground ? 'True' : 'False'}
GROUND_SIZE = ${gsize ? pn(gsize) : 'None'}
WING_SOI = ${wing ? `(${pn(wing[0])}, ${pn(wing[1])})` : 'None'}   # (raio / C, tamanho)
WAKE_SOI = ${wake ? `(${pn(wake[0])}, ${pn(wake[1])})` : 'None'}   # (comprimento / C a partir do BF, tamanho)
INFL = [${infl.join(', ')}]   # (superficies, 1a camada, camadas, crescimento)
GENERATE = ${s.generateMesh ? 'True' : 'False'}
import codecs
LOG = codecs.open(LOGP, "w", "utf-8")
def log(t):
    LOG.write(u"%s\\n" % (t,)); LOG.flush()
def tryset(o, attr, val):
    try:
        setattr(o, attr, val)
    except Exception as ex:
        log("ERRO set %s: %s" % (attr, ex))
def sel(ids):
    q = ExtAPI.SelectionManager.CreateSelectionInfo(SelectionTypeEnum.GeometryEntities)
    q.Ids = list(ids)
    return q
try:
    geo = DataModel.GeoData
    body = [b for a in geo.Assemblies for p in a.Parts for b in p.Bodies][0]
    face = body.Faces[0]
    edges = list(body.Edges)
    allv = [(v.X, v.Y, v.Z) for e in edges for v in e.Vertices]
    rng = [max(q[k] for q in allv) - min(q[k] for q in allv) for k in range(3)]
    A, B = sorted(range(3), key=lambda k: -rng[k])[:2]
    pts = [(q[A], q[B]) for q in allv]
    X0 = min(p[0] for p in pts); X1 = max(p[0] for p in pts)
    Y0 = min(p[1] for p in pts); Y1 = max(p[1] for p in pts)
    tol = 1e-6 * max(X1 - X0, Y1 - Y0)
    side = {}
    walls = []
    for e in edges:
        c = e.Centroid
        if abs(c[A] - X0) < tol: side.setdefault("xmin", []).append(e)
        elif abs(c[A] - X1) < tol: side.setdefault("xmax", []).append(e)
        elif abs(c[B] - Y0) < tol: side.setdefault("ymin", []).append(e)
        elif abs(c[B] - Y1) < tol: side.setdefault("ymax", []).append(e)
        else: walls.append(e)
    def EC(e): return (e.Centroid[A], e.Centroid[B])
    wx = [EC(e)[0] for e in walls]; wy = [EC(e)[1] for e in walls]
    xw = 0.5 * (min(wx) + max(wx)); yw = 0.5 * (min(wy) + max(wy))
    inlet, outlet = ("xmin", "xmax") if (xw - X0) < (X1 - xw) else ("xmax", "xmin")
    bottom, top = ("ymin", "ymax") if (min(wy) - Y0) < (Y1 - max(wy)) else ("ymax", "ymin")
    fdir = 1.0 if inlet == "xmin" else -1.0
    # paredes agrupadas em lacos (elementos) por vertices compartilhados
    par = {}
    def find(a):
        while par.setdefault(a, a) != a:
            a = par[a]
        return a
    for e in walls:
        vs = [v.Id for v in e.Vertices]
        for v in vs[1:]:
            par[find(v)] = find(vs[0])
    loops = {}
    for e in walls:
        k = find(e.Vertices[0].Id) if len(list(e.Vertices)) else ("e", e.Id)
        loops.setdefault(k, []).append(e)
    loops = list(loops.values())
    def cen(L):
        w = sum(e.Length for e in L)
        return (sum(EC(e)[0] * e.Length for e in L) / w, sum(EC(e)[1] * e.Length for e in L) / w, w)
    # elemento 1 = maior perfil; flaps a jusante dele (em ordem); slats/upper a montante
    mainL = max(loops, key=lambda L: cen(L)[2])
    cm = cen(mainL)[0]
    others = [L for L in loops if L is not mainL]
    downs = sorted([L for L in others if fdir * (cen(L)[0] - cm) >= 0], key=lambda L: fdir * cen(L)[0])
    ups = [L for L in others if fdir * (cen(L)[0] - cm) < 0]
    order = [mainL] + downs + ups
    log("eixos=%s,%s bbox x[%.4f,%.4f] y[%.4f,%.4f] inlet=%s loops=%d (site: %d elementos)" % (A, B, X0, X1, Y0, Y1, inlet, len(order), N_EL))
    log("perimetros/2.03 = %s | cordas do site = %s" % ([round(cen(L)[2] / 2.03, 4) for L in order], CHORDS))
    if len(order) != N_EL:
        log("AVISO: numero de lacos diferente do numero de elementos do site")
    order = order[:N_EL]
    for ns in (list(Model.NamedSelections.Children) if Model.NamedSelections else []):
        ns.Delete()
    NSE = {"inlet": side.get(inlet, []), "outlet": side.get(outlet, []), "symmetry_top": side.get(top, [])}
    NSE["ground" if GROUND else "symmetry_bottom"] = side.get(bottom, [])
    for i, L in enumerate(order):
        NSE["wall_element_%d" % (i + 1)] = L
    for name in ["inlet", "outlet", "symmetry_top", "ground" if GROUND else "symmetry_bottom"] + ["wall_element_%d" % (i + 1) for i in range(len(order))]:
        ns = Model.AddNamedSelection(); ns.Name = name; ns.Location = sel([e.Id for e in NSE[name]])
        log("NS %s: %d arestas" % (name, len(NSE[name])))
    mesh = Model.Mesh
    for c in list(mesh.Children):
        try: c.Delete()
        except: pass
    tryset(mesh, "PhysicsPreference", MeshPhysicsPreferenceType.CFD)
    tryset(mesh, "SolverPreference", MeshSolverPreferenceType.Fluent)
    tryset(mesh, "ElementOrder", ElementOrder.Linear)
    if GLOBAL: tryset(mesh, "ElementSize", Quantity(GLOBAL, "m"))
    tryset(mesh, "GrowthRate", GROWTH)
    tryset(mesh, "CaptureCurvature", False)
    tryset(mesh, "CaptureProximity", False)
    if DEFEAT: tryset(mesh, "DefeatureTolerance", Quantity(DEFEAT, "m"))
    try:
        mth = mesh.AddAutomaticMethod(); mth.Location = sel([body.Id]); mth.Name = "metodo_" + METHOD
        for nm in {"triangles": ["AllTriAllTet"], "quadDominant": ["QuadDominant", "Automatic"], "multizone": ["MultiZone"]}.get(METHOD, ["Automatic"]):
            if hasattr(MethodType, nm):
                mth.Method = getattr(MethodType, nm); break
        log("metodo: %s" % mth.Method)
    except Exception as ex:
        log("ERRO metodo: %s" % ex)
    for i, L in enumerate(order):
        k = WALL_SIZING[i] if i < len(WALL_SIZING) else None
        if k is None: continue
        es = mesh.AddSizing(); es.Location = sel([e.Id for e in L]); es.Name = "sizing_wall_element_%d" % (i + 1)
        if k[0] == "div":
            tryset(es, "Type", SizingType.NumberOfDivisions); tryset(es, "NumberOfDivisions", int(k[1]))
        else:
            tryset(es, "ElementSize", Quantity(k[1], "m"))
        if EDGE_HARD: tryset(es, "Behavior", SizingBehavior.Hard)
    if GROUND and GROUND_SIZE:
        gs = mesh.AddSizing(); gs.Location = sel([e.Id for e in NSE["ground"]]); gs.Name = "sizing_ground"
        tryset(gs, "ElementSize", Quantity(GROUND_SIZE, "m"))
    xte = max(fdir * (cen(L)[0] + fdir * 0.5 * CHORDS[i]) for i, L in enumerate(order)) * fdir
    soi = []
    if WING_SOI: soi.append(("soi_asa", xw, WING_SOI[0] * C, WING_SOI[1]))
    if WAKE_SOI: soi.append(("soi_esteira", xte + fdir * 0.5 * (WAKE_SOI[0] - 0.1) * C, 0.5 * (WAKE_SOI[0] + 0.1) * C, WAKE_SOI[1]))
    for nm, xc, r, hh in soi:
        try:
            cs = Model.CoordinateSystems.AddCoordinateSystem(); cs.Name = "cs_" + nm
            o = [0.0, 0.0, 0.0]; o[A] = xc; o[B] = yw
            cs.OriginX = Quantity(o[0], "m"); cs.OriginY = Quantity(o[1], "m"); cs.OriginZ = Quantity(o[2], "m")
            so = mesh.AddSizing(); so.Name = nm; so.Location = sel([face.Id])
            so.Type = SizingType.SphereOfInfluence; so.SphereCenter = cs
            so.SphereRadius = Quantity(r, "m"); so.ElementSize = Quantity(hh, "m")
            log("%s: centro %.4f raio %.4f tamanho %.6f" % (nm, xc, r, hh))
        except Exception as ex:
            log("ERRO %s: %s" % (nm, ex))
    for names, y1, nl, gr in INFL:
        try:
            ids = [e.Id for n in names if n in NSE for e in NSE[n]]
            inf = mesh.AddInflation(); inf.Location = sel([face.Id]); inf.BoundaryLocation = sel(ids)
            try:
                inf.InflationOption = 1   # First Layer Thickness (inteiro: o enum nao existe nesta versao)
            except Exception as ex:
                log("ERRO InflationOption: %s" % ex)
            inf.FirstLayerHeight = Quantity(y1, "m"); inf.MaximumLayers = nl; inf.GrowthRate = gr
            log("inflation %s: %s x %d x %s (opcao %s)" % (names, y1, nl, gr, inf.InflationOption))
        except Exception as ex:
            log("ERRO inflation %s: %s" % (names, ex))
    if GENERATE:
        mesh.GenerateMesh()
        log("malha: nos=%s elementos=%s" % (mesh.Nodes, mesh.Elements))
    for c in mesh.Children:
        log("  %s state=%s" % (c.Name, c.ObjectState))
    log("OK")
except Exception as ex:
    import traceback
    log("FALHA: %s\\n%s" % (ex, traceback.format_exc()))
LOG.close()`;
}

export function scriptMesh(pkg) {
  const s = wbSettings(pkg), issues = [];
  if (s.mode === '3D') {
    issues.push({ level: 'erro', msg: 'O gerador de malha cobre só pacotes 2D (arestas). Em 3D, configure a malha no Mechanical.' });
    return { text: '# Pacote 3D: gerador de malha disponível só para 2D.\n', file: `2_malha_${s.tag}.py`, inner: '', issues };
  }
  const inner = meshInner(pkg, s, issues);
  const L = [...header(pkg, s, 'Etapa 2: Named Selections + malha (Mechanical)'),
    '# 1) grava o script do Mechanical na pasta do projeto; 2) abre o Mechanical (interativo: as esferas', '#    de influência só funcionam com ele aberto); 3) envia o script. Log em:',
    `#    ${s.files.logMesh}`,
    `import os`,
    `if not os.path.isdir(${py(`${s.dir}/scripts`)}): os.makedirs(${py(`${s.dir}/scripts`)})`,
    ...writerLines(s.files.mesh, inner),
    sysLine(s),
    'c = s.GetComponent(Name="Mesh")',
    'c.Reset(); c.Refresh()   # banco de malha novo: garante que o FFF.msh seja reexportado',
    'm = s.GetContainer(ComponentName="Mesh")',
    'm.Edit()',
    `m.SendCommand(Language="Python", Command=codecs.open(${py(s.files.mesh)}, "r", "utf-8").read())`,
    '# O SendCommand volta antes de o Mechanical terminar: espere "OK" no log e então rode a parte 2b.'];
  const fin = ['# Etapa 2b (depois do "OK" no log): fecha o Mechanical, atualiza a malha e salva',
    sysLine(s), 'm = s.GetContainer(ComponentName="Mesh")', 'm.Exit()', 's.GetComponent(Name="Mesh").Update(AllDependencies=True)', 'Save(Overwrite=True)'];
  return { text: L.join('\n') + '\n', file: `2_malha_${s.tag}.py`, inner, finish: fin.join('\n') + '\n', issues };
}

// ---------------------------------------------------------------- etapa 3
function fluentInner(pkg, s, issues) {
  const c = pkg.config, f = { ...DEFAULT_FLUENT, ...c.fluent }, nm = { ...DEFAULT_FLUENT.names, ...(f.names || {}) };
  const ref = referenceValues(pkg), v = forceVectors(pkg), reps = reportDefinitions(pkg);
  const U = Number(f.Uinf);
  if (!(U > 0)) issues.push({ level: 'erro', msg: 'Informe Uinf (Fluent Setup).' });
  ref.errors.forEach((e) => issues.push({ level: 'erro', msg: e }));
  const ground = !!c.domain?.groundEnabled, moving = ground && c.domain?.groundMoving !== false;
  const is3 = s.mode === '3D';
  const zt = [['inlet', 'velocity-inlet'], ['outlet', 'pressure-outlet'], ['symmetry_top', 'symmetry']];
  if (!ground) zt.push(['symmetry_bottom', 'symmetry']);
  if (is3) zt.push(['symmetry_sides', 'symmetry']);
  const vec = (a) => pyList(a.map(Number));
  const rl = reps.map((r) => `(${py(/^lift/.test(r.field) ? 'lift' : 'drag')}, ${py(r.name)}, ${pyList(r.surfaces, py)}, ${vec(r.vector)})`);
  const totals = reps.filter((r) => r.field === 'lift_total' || r.field === 'drag_total').map((r) => r.name);
  const coupled = /coupled/i.test(String(f.solver || ''));
  const air = Math.abs(f.rho - 1.225) > 1e-9 || Math.abs(f.mu - 1.7894e-5) > 1e-12;
  if (air) issues.push({ level: 'aviso', msg: 'ρ ou μ diferente do ar padrão do Fluent: o journal tenta alterar o material "air" (trecho não testado no VDI).' });
  if (s.turbResolved === 'geko' && !(s.csepResolved > 0)) issues.push({ level: 'erro', msg: 'Csep inválido.' });
  return `# Fluent (journal Python): setup ${s.mode} do pacote ${ascii(pkg.name)} (gerado pelo AERO MULT-MR ELEMENTS)
import codecs
try:
    unicode
except NameError:
    unicode = str
LOGP = ${py(s.files.logFluent)}
DIM = ${is3 ? 3 : 2}
ZONE_TYPES = [${zt.map(([a, b]) => `(${py(a)}, ${py(b)})`).join(', ')}]
TURB = ${py(s.turbResolved)}
CSEP = ${pn(s.csepResolved)}   # explicito: o padrao do Fluent e 1.75
UNAME = ${py(nm.uinf)}
UINF = ${pn(U)}   # m/s
TI = ${pn((Number(s.turbIntensity) || 1) / 100)}
TVR = ${pn(Number(s.viscRatio) || 10)}
GROUND = ${moving ? py('ground') : 'None'}   # parede movel com velocidade = Uinf
GROUND_DIR = ${vec(v.drag)}
REF = {"area": ${pn(ref.Aref)}, "length": ${pn(ref.Lref)}, "velocity": ${pn(U)}, "density": ${pn(f.rho)}, "viscosity": ${pn(f.mu)}, "temperature": ${pn(f.T)}, "depth": ${pn(ref.depth)}}
AIR = ${air ? `(${pn(f.rho)}, ${pn(f.mu)})` : 'None'}
REPORTS = [${rl.join(', ')}]
TOTALS = ${pyList(totals, py)}
COUPLED = ${coupled ? 'True' : 'False'}
RESIDUAL = ${pnum(s.residual)}
ITERS = ${Math.round(Number(s.iterations) || 1500)}
CONV = ${s.conv.enabled ? `(${pnum(s.conv.stop)}, ${Math.round(Number(s.conv.ignore) || 0)}, ${Math.max(1, Math.round(Number(s.conv.use) || 1))})` : 'None'}   # (stop, ignorar antes, usar iteracoes) em lift/drag totais
INIT = ${s.initHybrid ? 'True' : 'False'}
LOG = codecs.open(LOGP, "w", "utf-8")
def log(t):
    LOG.write(unicode(t) + u"\\n"); LOG.flush()
def step(name, fn):
    try:
        fn(); log("ok  " + name)
    except Exception as ex:
        log("ERRO " + name + ": " + unicode(ex))
S = solver.settings if hasattr(solver, "settings") else solver
st = S.setup
bc = st.boundary_conditions
def zones():
    out = {}
    for t in bc.get_active_child_names():
        try:
            for n in getattr(bc, t).get_object_names():
                out[n] = t
        except Exception:
            pass
    return out
Z = zones()
log("zonas: %s" % Z)
for z, t in ZONE_TYPES:
    if z in Z and Z[z] != t.replace("-", "_"):
        step("tipo %s -> %s" % (z, t), lambda z=z, t=t: bc.set_zone_type(zone_list=[z], new_type=t))
def m_visc():
    vm = st.models.viscous
    vm.model = "k-omega"
    vm.k_omega_model = TURB
    if TURB == "geko":
        vm.geko.csep.option = "constant"; vm.geko.csep.value = CSEP
step("viscoso k-omega %s%s" % (TURB, " Csep=%s" % CSEP if TURB == "geko" else ""), m_visc)
def m_air():
    a = st.materials.fluid["air"]
    a.density.option = "constant"; a.density.value = AIR[0]
    a.viscosity.option = "constant"; a.viscosity.value = AIR[1]
if AIR: step("material air (rho, mu)", m_air)
def m_expr():
    ne = st.named_expressions
    if UNAME not in ne.get_object_names():
        ne[UNAME] = {}
    ne[UNAME].definition = "%s [m/s]" % UINF
    ne[UNAME].input_parameter = True
step("named expression %s (input)" % UNAME, m_expr)
def m_inlet():
    vi = bc.velocity_inlet["inlet"]
    try:
        vi.momentum.velocity_magnitude.value = UNAME
    except Exception:
        vi.momentum.velocity_magnitude = UNAME
    vi.turbulence.turbulent_intensity = TI
    vi.turbulence.turbulent_viscosity_ratio = TVR
step("inlet = %s" % UNAME, m_inlet)
def m_ground():
    gw = bc.wall[GROUND]
    gw.momentum.wall_motion = "Moving Wall"
    try: gw.momentum.relative = False
    except Exception as ex: log("  aviso relative: %s" % ex)
    try: gw.momentum.motion_bc = "Translational"
    except Exception as ex: log("  aviso motion_bc: %s" % ex)
    done = False
    for nm in ("vmag", "speed", "velocity_magnitude", "velocity"):
        try:
            getattr(gw.momentum, nm).value = UNAME; done = True; log("  velocidade em %s" % nm); break
        except Exception:
            pass
    for nm in ("direction", "wall_translation"):
        ok = False
        for d in (GROUND_DIR, GROUND_DIR[:DIM]):
            try:
                setattr(gw.momentum, nm, d); ok = True; log("  direcao em %s = %s" % (nm, d)); break
            except Exception:
                pass
        if ok: break
    if not done: raise Exception("velocidade do solo nao definida")
if GROUND: step("ground moving wall = %s" % UNAME, m_ground)
def m_ref():
    rv = st.reference_values
    for k in ("area", "length", "velocity", "density", "viscosity", "temperature", "depth"):
        try: setattr(rv, k, REF[k])
        except Exception as ex: log("  aviso ref %s: %s" % (k, ex))
step("reference values", m_ref)
rd = S.solution.report_definitions
names = []
def add_force(kind, name, zl, vec):
    def f():
        coll = getattr(rd, kind)
        if name not in coll.get_object_names():
            coll[name] = {}
        coll[name].zones = zl
        coll[name].report_output_type = "Lift Force" if kind == "lift" else "Drag Force"
        try:
            coll[name].force_vector = vec
        except Exception:
            coll[name].force_vector = vec[:2]
        names.append(name)
    step("report %s" % name, f)
for kind, name, zl, vec in REPORTS:
    add_force(kind, name, zl, vec)
def m_out():
    op = S.parameters.output_parameters.report_definitions
    for n in names:
        if n + "-op" not in op.get_object_names():
            op.create(name=n)
        op[n + "-op"].report_definition = n
    for k in list(op.get_object_names()):
        if not k.strip():
            del op[k]
step("output parameters (<report>-op)", m_out)
def m_mon():
    S.solution.monitor.report_files["forcas"] = {"report_defs": names, "file_name": "forcas.out"}
    S.solution.monitor.report_plots["lift_drag"] = {"report_defs": [n for n in TOTALS if n in names] or names}
step("monitores", m_mon)
if COUPLED: step("Coupled", lambda: setattr(S.solution.methods.p_v_coupling, "flow_scheme", "Coupled"))
def m_res():
    eq = S.solution.monitor.residual.equations
    for k in eq.get_object_names():
        eq[k].absolute_criteria = RESIDUAL
step("residuos %s" % RESIDUAL, m_res)
def m_conv():
    cc = S.solution.monitor.convergence_conditions
    for n in [x for x in TOTALS if x in names]:
        cc.convergence_reports["conv_" + n] = {"report_defs": n, "stop_criterion": CONV[0], "initial_values_to_ignore": CONV[1], "previous_values_to_consider": CONV[2], "print": True, "active": True}
    cc.condition = "all-conditions-are-met"
    cc.frequency = 1
if CONV: step("convergencia por lift/drag %s" % (CONV,), m_conv)
step("%d iteracoes (maximo)" % ITERS, lambda: setattr(S.solution.run_calculation, "iter_count", ITERS))
def m_init():
    S.solution.initialization.initialization_type = "hybrid"
    S.solution.initialization.hybrid_initialize()
if INIT: step("inicializacao hibrida", m_init)
log("FIM")
LOG.close()`;
}

export function scriptFluent(pkg) {
  const s = wbSettings(pkg), issues = [];
  const inner = fluentInner(pkg, s, issues);
  const L = [...header(pkg, s, 'Etapa 3: setup do Fluent (journal Python)'),
    `# Grava o journal na pasta do projeto, abre o Fluent (${s.precision === 'Double' ? 'dupla precisão' : 'precisão simples'}, ${s.processors} processos) e executa. Log em:`,
    `#    ${s.files.logFluent}`,
    'import os',
    `if not os.path.isdir(${py(`${s.dir}/scripts`)}): os.makedirs(${py(`${s.dir}/scripts`)})`,
    ...writerLines(s.files.fluent, inner),
    sysLine(s),
    'setup = s.GetContainer(ComponentName="Setup")',
    `fls = setup.GetFluentLauncherSettings(); fls.Precision = ${py(s.precision === 'Single' ? 'Single' : 'Double')}`,
    `fls.SetEntityProperties(Properties=Set(RunParallel=True, NumberOfProcessors=${Math.max(1, Math.round(Number(s.processors) || 1))}))`,
    'setup.Edit()',
    `setup.SendCommand(Command='/file/read-journal "${s.files.fluent}"')`,
    '# Confira o log ("FIM"; nenhuma linha "ERRO") e então rode a parte 3b.'];
  const fin = ['# Etapa 3b (depois do "FIM" no log): salva o projeto' + (s.solve ? ' e resolve' : ' (sem resolver)'), sysLine(s), 'Save(Overwrite=True)',
    s.solve ? 's.GetComponent(Name="Solution").Update(AllDependencies=True)' : '# para resolver: s.GetComponent(Name="Solution").Update(AllDependencies=True)',
    s.solve ? 'Save(Overwrite=True)' : null,
    '# Se o parâmetro de entrada da velocidade não aparecer no Workbench, desmarque e marque "Use as Input Parameter" no Expression Manager.'].filter(Boolean);
  return { text: L.join('\n') + '\n', file: `3_fluent_${s.tag}.py`, inner, finish: fin.join('\n') + '\n', issues };
}

// ---------------------------------------------------------------- etapa 4
export function scriptDesignPoints(pkg) {
  const s = wbSettings(pkg), issues = [], d = s.dp;
  const param = String(d.param || '').trim();
  const vals = parseValues(d.values);
  if (!param) issues.push({ level: 'erro', msg: 'Escolha o parâmetro a variar.' });
  if (!vals.length) issues.push({ level: 'erro', msg: 'Informe a lista de valores (separados por ";").' });
  if (vals.some((x) => !Number.isFinite(x))) issues.push({ level: 'erro', msg: 'Há valor inválido na lista.' });
  const ok = vals.filter(Number.isFinite);
  const L = [...header(pkg, s, 'Etapa 4: design points (cria, NÃO resolve) — NÃO TESTADO no VDI'),
    `# Parâmetro: ${param || '(escolha)'}; valores: ${ok.map(pnum).join('; ') || '—'}. Unidade = a do parâmetro no Workbench.`,
    `_n = ${py(param || 'DS_xxx')}`,
    '_c = [x for x in Parameters.GetAllParameters() if x.DisplayText.split("@")[0].strip() == _n] or [x for x in Parameters.GetAllParameters() if _n in x.DisplayText]',
    'p = _c[0]   # IndexError aqui = parâmetro não publicado (veja a etapa 1)'];
  let rest = ok;
  if (d.applyDP0 && ok.length) {
    L.push('dp = Parameters.GetDesignPoint(Name="0")', `dp.SetParameterExpression(Parameter=p, Expression=${py(pnum(ok[0]))})`);
    if (d.retained) L.push('dp.Retained = True');
    rest = ok.slice(1);
  }
  rest.forEach((x) => {
    L.push('dp = Parameters.CreateDesignPoint()', `dp.SetParameterExpression(Parameter=p, Expression=${py(pnum(x))})`);
    if (d.retained) L.push('dp.Retained = True');
  });
  L.push('Save(Overwrite=True)', '# Para resolver: Parameter Set > Update All Design Points (ou UpdateAllDesignPoints()).');
  return { text: L.join('\n') + '\n', file: `4_design_points_${s.tag}.py`, issues };
}

export function allScripts(pkg) {
  return { workbench: scriptWorkbench(pkg), mesh: scriptMesh(pkg), fluent: scriptFluent(pkg), dps: scriptDesignPoints(pkg) };
}
