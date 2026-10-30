// Geradores de arquivos de exportação (texto/CSV/XLSX). Sem DOM.

import { writeDat } from './dat.js';
import { to3D, describeTransform, directions, planeAxes } from './transform.js';
import { toCSV } from './csv.js';
import { makeXlsx } from './xlsx.js';
import { doeVariables, derivedColumns } from './doe.js';
import { computeDP, metricList, flatMetrics, expectedOutputFields } from './outputs.js';
import { referenceValues, reportDefinitions, parameterTable, boundaryConditions, checkReports, dsName, DEFAULT_FLUENT, forceVectors } from './fluent.js';
import { validateNamedSelections } from './namedsel.js';
import { meshSuggestions } from './mesh.js';
import { MESH_METHODS } from './mesh.js';
import { gurneyConfigured } from './wing.js';
import { resolveTopology } from './assembly.js';

const f6 = (v) => (Number.isFinite(v) ? Number(v.toFixed(6)) : '');
const fx = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

/** .dat processado (normalizado, referencial do perfil) de um elemento. */
export function processedDat(proc, name) {
  return writeDat(`${name} (processado: normalizado${proc.te?.ok ? `, BF arredondado r=${(proc.te.r * 100).toFixed(3)}% c` : ''})`, proc.final);
}

/** Coordenadas finais de um elemento montado (mm) no CAD: CSV X;Y;Z. */
export function coordsCSV(planeEl, plane) {
  const [h, v, nrm] = planeAxes(plane);
  const pts = planeEl.pts.concat([planeEl.pts[0]]).map((p) => to3D(p, plane));
  const order = ['X', 'Y', 'Z'];
  return toCSV(['ponto', ...order.map((a) => `${a} [mm]`)], pts.map((p, i) => [i + 1, f6(p[0]), f6(p[1]), f6(p[2])])) + `# plano ${plane}: horizontal=${h}, vertical=${v}, normal=${nrm}\n`;
}

/**
 * Contorno fechado (mm) com pontos extras nos trechos retos junto aos cantos (BF, Gurney).
 * A curva por pontos do CAD é uma spline única que passa por todos os pontos e arredondaria os
 * cantos (o Gurney vira uma "bolha"); com pontos cada vez mais próximos do canto (s0, s0·r, ...,
 * medidos ao longo do contorno até o espaçamento alcançar o dos pontos originais) a spline segue o
 * contorno desenhado no app. Os pontos novos ficam sobre os segmentos originais; o 1º ponto não muda.
 * `at(p)` limita os cantos a uma região (ex.: perto do BF, para não "quinar" um BA com poucos pontos).
 */
export function refineCorners(pts, { angle = 30, s0 = 0.01, ratio = 1.5, at = () => true } = {}) {
  const P = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; }); // sem pontos repetidos
  const n = P.length;
  if (n < 3) return P;
  const cosLim = Math.cos((angle * Math.PI) / 180);
  const seg = (i) => Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
  const C = P.map((p, i) => i).filter((i) => {
    if (!at(P[i])) return false;
    const a = P[(i - 1 + n) % n], p = P[i], b = P[(i + 1) % n];
    const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
    return (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)) < cosLim;
  });
  if (!C.length) return P;
  const S = [0];
  for (let i = 1; i < n; i++) S.push(S[i - 1] + seg(i - 1));
  const T = S[n - 1] + seg(n - 1), mod = (s) => ((s % T) + T) % T;
  const segAt = (s) => { let j = n - 1; while (S[j] > s) j--; return j; };
  const extra = [];
  C.forEach((c, k) => {
    const next = C[(k + 1) % C.length], prev = C[(k - 1 + C.length) % C.length];
    [[1, mod(S[next] - S[c]) || T], [-1, mod(S[c] - S[prev]) || T]].forEach(([dir, span]) => {
      for (let d = s0; d < span / 2; d *= ratio) {
        const s = mod(S[c] + dir * d), j = segAt(s);
        if (d * (ratio - 1) > seg(j)) break; // já tão espaçado quanto os pontos originais
        if (s - S[j] > 1e-6 && S[j] + seg(j) - s > 1e-6) extra.push(s);
      }
    });
  });
  const at2 = (s) => { const j = segAt(s), t = (s - S[j]) / seg(j), q = P[(j + 1) % n]; return [P[j][0] + t * (q[0] - P[j][0]), P[j][1] + t * (q[1] - P[j][1])]; };
  return P.map((p, i) => ({ s: S[i], p })).concat([...new Set(extra)].map((s) => ({ s, p: at2(s) }))).sort((a, b) => a.s - b.s).map((x) => x.p);
}

/** Contorno do elemento montado com os cantos do BF e do Gurney refinados (BA intocado). */
export function curvePoints(planeEl) {
  const g = planeEl.gurney, te = planeEl.te;
  const r = Math.max(0.15 * (planeEl.chord || 0), g ? g.pos + g.t + g.h + 1 : 0);
  return te && r > 0 ? refineCorners(planeEl.pts, { at: (p) => Math.hypot(p[0] - te[0], p[1] - te[1]) <= r }) : planeEl.pts.slice();
}

/** SolidWorks "Curva por pontos XYZ" (.txt, valores em mm, curva fechada repetindo o 1º ponto; cantos refinados). */
export function solidworksCurve(planeEl, plane) {
  const pts = curvePoints(planeEl);
  return pts.concat([pts[0]]).map((p) => to3D(p, plane).map((c) => c.toFixed(6)).join('\t')).join('\r\n') + '\r\n';
}

/** DesignModeler 3D Curve (grupo, id, x, y, z). Fecha repetindo o 1º ponto; cantos refinados. */
export function designModelerCurve(planeEls, plane) {
  const lines = ['# DesignModeler: Concept/3D Curve → arquivo de coordenadas (grupo id X Y Z), mm', '# Cada grupo = um elemento. Curva fechada repetindo o 1º ponto. Confira a sintaxe de fechamento na sua versão do DM.'];
  planeEls.forEach((e, g) => {
    const pts = curvePoints(e);
    pts.concat([pts[0]]).forEach((p, i) => { const q = to3D(p, plane); lines.push(`${g + 1} ${i + 1} ${q[0].toFixed(6)} ${q[1].toFixed(6)} ${q[2].toFixed(6)}`); });
  });
  return lines.join('\r\n') + '\r\n';
}

function inputColumns(pkg, withDS) {
  const cols = [...doeVariables(pkg), ...derivedColumns(pkg)];
  // ordem: por elemento, depois Uinf
  cols.sort((a, b) => (a.element ?? 99) - (b.element ?? 99));
  return cols.map((c) => ({ ...c, header: withDS && dsName(c.key, pkg) ? `${dsName(c.key, pkg)} [${c.unit}]` : `${c.label} [${c.unit}]` }));
}

/** Tabela de entradas (DPs) de uma rodada. */
export function inputsTable(project, pkg, run, { withDS = false } = {}) {
  const cols = inputColumns(pkg, withDS);
  const headers = ['projeto', 'pacote', 'rodada', 'DP', 'status', ...cols.map((c) => c.header)];
  const rows = run.dps.map((d) => [project.name, pkg.name, run.name, d.name, d.status, ...cols.map((c) => { const v = Number(d.inputs[c.key]); return Number.isFinite(v) ? f6(v) : ''; })]);
  return { headers, rows };
}

/** Tabela de saídas: brutas (importadas) e calculadas em colunas separadas. */
export function outputsTable(project, pkg, run, opts = {}) {
  const n = pkg.config.elements.length;
  const rawF = expectedOutputFields(pkg);
  const mets = metricList(n).filter((m) => /^(Cl|Cd|ClCd)/.test(m.key));
  const headers = ['projeto', 'pacote', 'rodada', 'DP', 'exemplo?', 'Uinf [m/s]', 'rho [kg/m3]', 'A_ref [m2]', 'q [Pa]',
    ...rawF.map((f) => `BRUTO ${f} [N]`), ...mets.map((m) => `CALC ${m.label}`), 'avisos'];
  const rows = run.dps.map((d) => {
    const c = computeDP(d, pkg, opts), fm = c.has ? flatMetrics(c) : {};
    return [project.name, pkg.name, run.name, d.name, d.outputs?.isExample ? 'SIM (sintético)' : (d.outputs ? 'não' : ''), f6(c.ref.U), f6(c.ref.rho), f6(c.ref.Aref), f6(c.ref.q),
      ...rawF.map((k) => (d.outputs?.raw && Number.isFinite(d.outputs.raw[k]) ? f6(d.outputs.raw[k]) : '')),
      ...mets.map((m) => (Number.isFinite(fm[m.key]) ? f6(fm[m.key]) : '')), (c.flags || []).join(' | ')];
  });
  return { headers, rows };
}

export const csvOf = (t, decimalComma = false) => toCSV(t.headers, t.rows, { decimalComma });
export const xlsxOf = (sheets) => makeXlsx(sheets);

/** Relatório do domínio (Markdown). */
export function domainReport(pkg, wing, dom) {
  const d = directions(pkg.config.transform);
  const [h, v] = planeAxes(pkg.config.transform.plane);
  const s = dom.settings;
  return `# Domínio computacional — ${pkg.name}

Escoamento: ${d.flowLabel} · Sustentação positiva: ${d.liftLabel} · ${describeTransform(pkg.config.transform)}

C = ${s.chordBasis === 'principal' ? 'corda do elemento 1' : 'Σ cordas (C_soma)'} = **${fx(dom.C, 2)} mm**

| Fronteira | Distância a partir do extremo da montagem | Coordenada |
|---|---|---|
| inlet (montante) | ${s.upstream}·C = ${fx(dom.dist.upstream, 1)} mm | ${h} = ${fx(dom.inletX, 2)} mm |
| outlet (jusante) | ${s.downstream}·C = ${fx(dom.dist.downstream, 1)} mm | ${h} = ${fx(dom.outletX, 2)} mm |
| symmetry_top (acima) | ${s.above}·C = ${fx(dom.dist.above, 1)} mm | ${v} = ${fx(dom.topY, 2)} mm |
| ${s.groundEnabled ? 'ground (solo)' : 'inferior'} | ${s.groundEnabled ? `folga h = ${fx(dom.dist.below, 2)} mm` : `${s.below}·C = ${fx(dom.dist.below, 1)} mm`} | ${v} = ${fx(dom.bottomY, 2)} mm |

Extremos da montagem: ${h} ∈ [${fx(dom.assembly.xmin, 2)}; ${fx(dom.assembly.xmax, 2)}] mm, ${v} ∈ [${fx(dom.assembly.ymin, 2)}; ${fx(dom.assembly.ymax, 2)}] mm

Tamanho do domínio: ${fx(dom.length, 1)} × ${fx(dom.height, 1)} mm (${fx(dom.length / dom.C, 2)}·C × ${fx(dom.height / dom.C, 2)}·C)

${dom.errors.length ? '## Erros\n' + dom.errors.map((e) => `- ${e}`).join('\n') + '\n' : ''}${dom.warnings.length ? '## Avisos\n' + dom.warnings.map((e) => `- ${e}`).join('\n') + '\n' : ''}${dom.recommendations.length ? '## Recomendações\n' + dom.recommendations.map((e) => `- ${e}`).join('\n') + '\n' : ''}
> No DesignModeler: crie o retângulo (Sketch no plano ${pkg.config.transform.plane}) com estas coordenadas, gere a superfície e subtraia os elementos (Boolean → Subtract, mantendo as ferramentas desmarcado).
`;
}

export function namedSelectionsCSV(pkg) {
  return toCSV(['nome', 'tipo', 'entidades', 'descrição', 'condição de contorno', 'notas'], (pkg.config.namedSelections || []).map((s) => [s.name, s.type, s.entities, s.description, s.bc, s.notes]));
}

export function meshPlanMD(pkg, sugg) {
  const m = pkg.config.mesh;
  const meth = (MESH_METHODS.find((x) => x[0] === m.method) || [, m.method])[1];
  const val = (v, u = 'mm') => (v == null || v === '' ? '_(a definir)_' : `${String(v).replace('.', ',')} ${u}`);
  let s = `# Plano de malha — ${pkg.name}

> **Plano** para aplicar no ANSYS Meshing. Este aplicativo **não gera malha**. Valores marcados como "sugestão" são heurísticos.

- Método: **${meth}**
- Tamanho do elemento (Element Size; Malha → Padrões → Tamanho do Elemento): ${val(m.globalMax)}${sugg ? ` (sugestão: ${fx(sugg.globalMax, 1)} mm)` : ''}
- Taxa de crescimento global (Malha → Dimensionamento → Taxa de Crescimento; a da inflation está na tabela de inflation): ${val(m.growthRate, '')}
- y+ alvo: ${m.yplusTarget}

## Edge sizing
| Alvo | Tipo | Valor | Bias |
|---|---|---|---|
${m.edgeSizing.map((e) => `| ${e.target} | ${e.type === 'divisoes' ? 'nº de divisões' : 'tamanho'} | ${e.value ?? '_(a definir)_'} | ${e.bias ?? '—'} |`).join('\n')}

## Refinamentos
| Região | Ativo | Tamanho |
|---|---|---|
${Object.values(m.refinements).map((r) => `| ${r.label} | ${r.enabled ? 'sim' : 'não'} | ${val(r.size)} |`).join('\n')}

## Inflation (por superfície)
| Superfície | Ativo | Camadas | Crescimento | 1ª camada |
|---|---|---|---|---|
${m.inflation.map((e) => `| ${e.surface} | ${e.enabled ? 'sim' : 'não'} | ${e.layers ?? '_(a definir)_'} | ${e.growth ?? '—'} | ${val(e.firstLayer)} |`).join('\n')}
`;
  if (sugg) {
    s += `\n## Sugestões calculadas (heurísticas)\n${sugg.note}\n\n| Superfície | Re (corda) | 1ª camada (y+=${m.yplusTarget}) | camadas | espessura total | δ estimada |\n|---|---|---|---|---|---|\n`;
    s += sugg.perElement.map((e) => `| ${e.surface} | ${e.Re.toExponential(2)} | ${e.y1.toExponential(3)} mm | ${e.layers} | ${fx(e.total, 2)} mm | ${fx(e.delta, 2)} mm |`).join('\n') + '\n';
  }
  if (m.notes) s += `\n## Notas\n${m.notes}\n`;
  return s;
}

export function fluentSetupMD(pkg, inputKeys) {
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const ref = referenceValues(pkg);
  const v = forceVectors(pkg);
  const reps = reportDefinitions(pkg);
  const issues = checkReports(reps, pkg.config.namedSelections || [], pkg.config.elements.length);
  const vec = (a) => `(${a.map((x) => String(x).replace('.', ',')).join('; ')})`;
  return `# Setup do Fluent e valores de referência — ${pkg.name}

> Instruções para configurar manualmente. Não há integração automática com o ANSYS.

## Modelo
- Solver: ${f.solver} · Turbulência: ${f.viscous} · Modo: ${pkg.config.mode}${pkg.config.mode === '3D' ? ` (envergadura ${pkg.config.span_mm ?? '—'} mm)` : ''}

## Condições de contorno
| Named Selection | Tipo | Detalhe |
|---|---|---|
${boundaryConditions(pkg).map((b) => `| ${b.name} | ${b.bc} | ${b.detail} |`).join('\n')}

## Reference Values (Fluent → Setup → Reference Values)
| Grandeza | Valor | Unidade |
|---|---|---|
| Velocity (Vel_ref → parâmetro ${f.names.uinf}) | ${ref.U ?? '—'} | m/s |
| Density ρ | ${ref.rho} | kg/m³ |
| Area A_ref (${f.arefBasis === 'fixo' ? 'valor fixo' : 'Σ cordas × profundidade'}) | ${fx(ref.Aref, 6)} | m² |
| Length L_ref (${f.lrefMode === 'principal' ? 'corda do elemento 1' : 'Σ cordas'}) | ${fx(ref.Lref, 6)} | m |
| Temperature | ${ref.T} | K |
| Viscosity μ | ${ref.mu} | kg/(m·s) |
| Depth (2D) | ${ref.depth} | m |
${ref.notes.map((n) => `\n> ${n}`).join('')}

## Vetores de força
- Sustentação ${vec(v.lift)} → valores positivos no sentido ${v.labels.liftLabel}${v.auto ? ' (automático pela transformação)' : ''}
- Arrasto ${vec(v.drag)} → sentido do escoamento ${v.labels.flowLabel}

## Report Definitions (Solution → Report Definitions → New → Force Report)
| Relatório | Grandeza | Vetor | Superfícies (Zones) | Output parameter |
|---|---|---|---|---|
${reps.map((r) => `| ${r.name} | ${r.quantity} | ${vec(r.vector)} | ${r.surfaces.join(', ')} | sim |`).join('\n')}

Passos para cada relatório: New → Force Report → Lift (ou Drag) → nome exato acima → Force Vector conforme a tabela → selecione **apenas** as zonas listadas (nunca \`ground\`) → marque **Create → Report File/Plot** se desejar e **Create Output Parameter** → OK.

## Tabela de parâmetros do Workbench
| Parâmetro | Nome | Tipo | Unidade | Origem |
|---|---|---|---|---|
${parameterTable(pkg, inputKeys).map((p) => `| ${p.param} | ${p.name} | ${p.kind} | ${p.unit} | ${p.source}${p.note ? ` — ${p.note}` : ''} |`).join('\n')}

> A numeração P1…Pn real é atribuída pelo Workbench na ordem em que os parâmetros forem criados; use os **nomes** para associar.

${issues.length ? '## Verificações\n' + issues.map((i) => `- **${i.level}**: ${i.msg}`).join('\n') : '## Verificações\n- Nenhum problema de dupla contagem encontrado.'}
`;
}

export function workbenchParamsCSV(pkg, inputKeys) {
  return toCSV(['parametro', 'nome', 'chave_app', 'tipo', 'unidade', 'origem', 'nota'], parameterTable(pkg, inputKeys).map((p) => [p.param, p.name, p.appKey, p.kind, p.unit, p.source, p.note]));
}

/** O que ainda precisa ser feito fora do aplicativo. */
export function todoMD(pkg) {
  const gur = pkg.config.elements.some((e) => e.gurney?.enabled || gurneyConfigured(e));
  const slat = resolveTopology(pkg.config.elements).kinds.includes('slat');
  return `# O que ainda precisa ser feito fora deste aplicativo — ${pkg.name}

Este aplicativo prepara, organiza e analisa. **Nada abaixo é executado por ele.**

## SolidWorks
- [ ] Atualizar as cotas DS_ do esboço de referência (cordas, AoA, gap, overlap, pivôs${gur ? ', Gurney' : ''}) ou importar as curvas exportadas (Curva por pontos XYZ, mm).
${pkg.config.conventions?.gapPoint === 'ba' ? '- [ ] Gap/Overlap estão medidos entre os bordos de ataque: cotar DS_gap/DS_overlap do BA do elemento de referência ao BA do flap (vertical e horizontal), não a partir do BF.\n' : ''}- [ ] Conferir que todas as cotas dirigentes têm o prefixo DS (Parameter Key = DS no Workbench).
- [ ] Verificar visualmente interseções: o SolidWorks não as detecta.
${slat ? '- [ ] Slat: criar as cotas de posição do BF do slat em relação ao BA do elemento de referência (DS_gap/DS_overlap do par slat → ref, com a convenção do app) e o pivô do slat.\n' : ''}${gur ? '- [ ] Gurney: cotas DS_gurney_h/t/pos; ligar/desligar Gurney NÃO é cota — use configurações/peças separadas (com e sem Gurney) se o DOE variar gurney_on.\n' : ''}

## DesignModeler / SpaceClaim
- [ ] Geometry → Properties → Analysis Type = ${pkg.config.mode}.
- [ ] Criar o domínio com as coordenadas do relatório de domínio e subtrair os elementos.
- [ ] Criar as Named Selections exatamente com os nomes da lista exportada${gur ? ' (incluir as arestas do Gurney na parede do elemento correspondente)' : ''}.

## Meshing
- [ ] Aplicar o plano de malha (método, sizing, refinamentos, inflation).
- [ ] Verificar qualidade (skewness, orthogonal quality, aspect ratio) e y+ após a solução.
- [ ] Fazer estudo de independência de malha.

## Fluent
- [ ] Modelo, materiais (ρ, μ), condições de contorno e Reference Values conforme o relatório de setup.
- [ ] Criar os relatórios de força com os nomes exatos e marcar "Create Output Parameter".
- [ ] Definir Uinf como parâmetro de entrada (velocidade do inlet${pkg.config.domain.groundEnabled && pkg.config.domain.groundMoving ? ' e do solo móvel' : ''}).
- [ ] Critérios de convergência e monitoramento das forças.

## Workbench
- [ ] Conferir a tabela de parâmetros (entradas DS_ + Uinf; saídas de força).
- [ ] Colar/importar a tabela de Design Points e executar (Update All Design Points).
- [ ] Exportar a tabela de parâmetros (CSV) e importar na seção **Outputs** deste aplicativo.
`;
}
