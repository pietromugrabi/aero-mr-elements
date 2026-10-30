import { h, card, numField, textField, selectField, checkField, msgs, badge, fv, table, pickFile, toast, confirmBox, seg } from '../dom.js';
import * as store from '../store.js';
import { wingOf, needs, swatch, pageHead } from '../common.js';
import { geomPlot } from '../plots.js';
import { setElementCount, syncDependentLists, addSlat, addUpperflap } from '../../core/model.js';
import { resolveTopology, leToLe } from '../../core/assembly.js';
import { pairOf, gurneyConfigured, isRelGap, gapBaseIndex, pairName, setGapPoint } from '../../core/wing.js';
import { applyReferenceStudy } from '../../core/demo.js';
import { S1223_DAT, NACA23012_DAT, E423_DAT, FX74CL5140_DAT } from '../../core/samples-data.js';
import { describeTransform, directions, planeAxes, toPlane } from '../../core/transform.js';
import { pivotLocal } from '../../core/pivots.js';
import { DEG, rotate } from '../../core/geom.js';
import { fmt } from '../../core/num.js';
import { suggestConfig, suggestGeometry, applySuggestion, levelsText, DEFAULT_SUGGEST, RULE_FIELDS } from '../../core/suggest.js';
import { clone } from '../../core/model.js';
import { conflictVariables, defaultRange, makeGrid, evalCell, summarize, validRuns } from '../../core/conflict.js';
import { wing3D } from '../view3d.js';
import { mathBlock } from '../math.js';

const pt = (p, d = 3) => (p ? `(${fmt(p[0], d)}; ${fmt(p[1], d)})` : '—');

function setEl(pkg, i, field, value, label) {
  store.update(() => { pkg.config.elements[i][field] = value; }, ['geometria', `${pkg.name} / elemento ${i + 1}`, `${label || field} alterado`, String(value)]);
}

// ------------------------------------------------------------------ Aba Elementos
function generalCard(pkg) {
  const c = pkg.config, t = c.transform, d = directions(t);
  return card('Configuração geral',
    h('div', { class: 'fields' },
      selectField({ label: 'Número de elementos', value: String(c.elements.length), options: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [String(i), `${i}`]),
        onChange: (v) => store.update(() => setElementCount(c, Number(v)), ['geometria', pkg.name, 'nº de elementos', v]) }),
      selectField({ label: 'Tipo de análise', value: c.mode, options: [['2D', '2D (superfícies no plano)'], ['3D', '3D (extrusão com envergadura)']], onChange: (v) => store.update(() => { c.mode = v; syncDependentLists(c); }, ['geometria', pkg.name, 'modo', v]) }),
      c.mode === '3D' ? numField({ label: 'Envergadura (span)', unit: 'mm', value: c.span_mm, required: true, hint: 'Obrigatória em 3D — o app nunca estima a envergadura.', key: 'span', onChange: (v) => store.update(() => { c.span_mm = v; }, ['geometria', pkg.name, 'span', String(v)]) }) : null,
      selectField({ label: 'Sinal em X (horizontal)', value: String(t.sx), options: [['-1', 'X = −x_dat·c (padrão)'], ['1', 'X = +x_dat·c']], onChange: (v) => store.update(() => { t.sx = Number(v); }, ['geometria', pkg.name, 'transformação sx', v]) }),
      selectField({ label: 'Sinal em Y (vertical)', value: String(t.sy), options: [['-1', 'Y = −y_dat·c (padrão, asa invertida)'], ['1', 'Y = +y_dat·c']], onChange: (v) => store.update(() => { t.sy = Number(v); }, ['geometria', pkg.name, 'transformação sy', v]) }),
      selectField({ label: 'Plano do esboço', value: t.plane, options: [['XY', 'XY (Plano Frontal)'], ['XZ', 'XZ (Plano Superior)'], ['YZ', 'YZ (Plano Lateral)']], onChange: (v) => store.update(() => { t.plane = v; }, ['geometria', pkg.name, 'plano', v]) }),
    ),
    mathBlock(`${describeTransform(t)}\nEscoamento no sentido ${d.flowLabel} · sustentação positiva no sentido ${d.liftLabel}${t.sy < 0 ? ' (downforce para asa invertida)' : ''}\nA escala pela corda é aplicada uma única vez (o .dat é sempre normalizado antes).`, { style: { marginTop: '10px' } }),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { onclick: async () => { if (await confirmBox('Preencher com o estudo de referência', 'Substitui perfis e cotas de referência dos 3 primeiros elementos pelos valores do estudo de referência (S1223, 140/90/60 mm, 3/18/33°...). Continuar?', 'Preencher')) store.update(() => { if (c.elements.length < 3) setElementCount(c, 3); applyReferenceStudy(pkg, S1223_DAT, 'S1223', { gurneyOn: c.elements.some((e) => e.gurney?.enabled) }); }, ['geometria', pkg.name, 'preenchido com estudo de referência']); } }, 'Preencher com valores do estudo de referência'),
      h('small', { class: 'muted' }, 'Valores de exemplo (cotas DS_ do modelo de referência).'),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => store.update(() => { addSlat(c); }, ['geometria', pkg.name, 'slat adicionado', 'sem valores de referência']) }, '+ Adicionar slat'),
      h('button', { onclick: () => store.update(() => { addUpperflap(c); }, ['geometria', pkg.name, 'upperflap adicionado', 'sem valores de referência']) }, '+ Adicionar upperflap')),
    h('p', { class: 'muted', style: { margin: '8px 0 0' } }, 'Slat = a montante do elemento de referência; upperflap = acima dele (pelo BF ou pelo BA). Os dois usam o principal como referência por padrão e vêm sem valores: informe corda, AoA, gap, overlap/stagger, pivô e .dat.'));
}

function datSummary(proc) {
  if (!proc) return null;
  const p = proc.parsed;
  if (!p.points.length && !p.errors.length) return null;
  return h('div', { style: { marginTop: '6px' } },
    h('div', { class: 'row' },
      badge(`${p.points.length} pontos`, p.errors.length ? 'err' : 'ok'), badge(`formato ${p.format}`), badge(p.closedTE ? 'BF fechado' : `BF aberto (t = ${fv(p.te?.thickness, 3)})`), badge(`entrada: ${p.scaleGuess}`),
      p.stats.duplicatesRemoved ? badge(`${p.stats.duplicatesRemoved} duplicado(s) removido(s)`, 'warn') : null,
      p.stats.skipped ? badge(`${p.stats.skipped} linha(s) ignorada(s)`, 'warn') : null),
    h('div', { class: 'kv', style: { marginTop: '6px' } },
      h('dt', null, 'BA (arquivo)'), h('dd', null, pt(proc.normalized?.leOffset)),
      h('dt', null, 'BF médio (arquivo)'), h('dd', null, pt(p.te?.mid)),
      h('dt', null, 'Corda medida'), h('dd', null, `${fv(proc.normalized?.fileChord, 6)} (unid. do arquivo)`),
      h('dt', null, 'Rotação aplicada'), h('dd', null, `${fv(proc.normalized?.rotationDeg, 4)}°`)),
    msgs([...p.errors.map((m) => ({ level: 'erro', msg: m })), ...p.warnings.slice(0, 6).map((m) => ({ level: 'aviso', msg: m })), ...(p.warnings.length > 6 ? [{ level: 'aviso', msg: `… mais ${p.warnings.length - 6} aviso(s).` }] : []), ...p.info.map((m) => ({ level: 'info', msg: m })), ...(proc.normalized?.warnings || []).map((m) => ({ level: 'aviso', msg: m }))]));
}

function previews(pkg, i, proc, el) {
  if (!proc?.ok) return null;
  const t = pkg.config.transform, c = Number(el.chord_ref) || 1, [hx, vy] = planeAxes(t.plane);
  const orig = proc.original;
  const fin = proc.final.map((p) => toPlane([p[0] * c, p[1] * c], t));
  return h('div', { class: 'grid g2', style: { marginTop: '8px' } },
    h('div', null, h('div', { class: 'lbl' }, 'Original (.dat normalizado, x/c × y/c)'),
      geomPlot(() => ({ elements: [{ pts: orig, label: '' }], axes: ['x/c', 'y/c'] }), { height: 190, show: { pivots: false, chords: false, vectors: false, labels: false }, name: `${el.profileName}_original` })),
    h('div', null, h('div', { class: 'lbl' }, `Transformado (${hx}, ${vy} em mm, corda ${fmt(c, 1)} mm, sem AoA)`),
      geomPlot(() => ({ elements: [{ pts: fin, label: '' }], axes: [hx, vy], flow: [t.sx, 0], lift: [0, t.sy] }), { height: 190, show: { pivots: false, chords: false, labels: false }, name: `${el.profileName}_transformado` })));
}

function gurneyBlock(pkg, i, w) {
  const el = pkg.config.elements[i], n = i + 1, g = el.gurney || {};
  const configured = gurneyConfigured(el);
  if (!g.enabled && !configured && !g.editing) {
    return h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'small', onclick: () => store.update(() => { el.gurney = { ...g, editing: true }; }) }, '+ Definir Gurney flap neste elemento'));
  }
  const setG = (k, v, label) => store.update(() => { el.gurney = { ...el.gurney, [k]: v }; syncDependentLists(pkg.config); }, ['geometria', `${pkg.name} / elemento ${n}`, `Gurney: ${label}`, String(v)]);
  const c = Number(el.chord_ref);
  const res = w.asm?.elements?.[i]?.gurney;
  return h('div', { class: 'el-card', style: { background: 'var(--surface-2)', marginTop: '10px', marginBottom: 0 } },
    h('div', { class: 'row' }, h('strong', null, `Gurney flap — elemento ${n}`),
      checkField({ label: 'Ligado na referência', checked: !!g.enabled, onChange: (v) => setG('enabled', v, v ? 'ligado' : 'desligado') }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'small danger', onclick: () => store.update(() => { el.gurney = { enabled: false, h: null, t: null, pos: 0, side: 'pressao', hRef: 'corda' }; syncDependentLists(pkg.config); }, ['geometria', `elemento ${n}`, 'Gurney removido']) }, 'Remover Gurney')),
    h('div', { class: 'fields', style: { marginTop: '8px' } },
      numField({ label: `gurney_h_${n} — altura`, unit: 'mm', value: g.h, required: true, key: `gh${i}`, onChange: (v) => setG('h', v, 'altura'), hint: c > 0 && Number(g.h) > 0 ? `= ${fmt((100 * g.h) / c, 2)} % de chord_ref` : 'normal à corda' }),
      numField({ label: `gurney_h_${n} em % da corda`, unit: '% c', value: c > 0 && Number(g.h) > 0 ? +((100 * g.h) / c).toPrecision(6) : null, key: `ghp${i}`, onChange: (v) => { if (c > 0 && v != null) setG('h', +((v / 100) * c).toPrecision(8), 'altura (% c)'); }, hint: 'convertido para mm com chord_ref' }),
      numField({ label: `gurney_t_${n} — espessura`, unit: 'mm', value: g.t, required: true, key: `gt${i}`, onChange: (v) => setG('t', v, 'espessura'), hint: 'ao longo da corda' }),
      numField({ label: `gurney_pos_${n} — distância ao BF`, unit: 'mm', value: g.pos ?? 0, key: `gp${i}`, onChange: (v) => setG('pos', v ?? 0, 'posição'), hint: '0 = rente ao BF (padrão DS_); > 0 = aba a montante do BF' }),
      selectField({ label: 'Lado', value: g.side || 'pressao', options: [['pressao', 'Pressão (padrão)'], ['succao', 'Sucção']], onChange: (v) => setG('side', v, 'lado') }),
      selectField({ label: 'Altura medida a partir de', value: g.hRef || 'corda', options: [['corda', 'Linha da corda / BF (DS_gurney_h)'], ['superficie', 'Superfície local (face de jusante)']], onChange: (v) => setG('hRef', v, 'referência da altura') })),
    res ? h('div', { class: 'kv', style: { marginTop: '8px' } },
      h('dt', null, 'Sobressai da superfície (face de montante / jusante)'), h('dd', null, `${fv(res.effectiveUp, 4)} / ${fv(res.effectiveDown, 4)} mm`),
      h('dt', null, 'Altura relativa'), h('dd', null, `${fv(res.hPct, 3)} % da corda`)) : null,
    h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Com h e t definidos, o DOE ganha gurney_on_n (0 = sem, 1 = com), gurney_h_n, gurney_t_n e gurney_pos_n, para comparar com × sem Gurney na mesma rodada.'));
}

/** Campos de Gap/Overlap: em mm ou em fração da corda de um elemento base (Gap = Gap/c · chord_base). */
function gapFields(pkg, i, dsOv, gapHint, ovHint) {
  const el = pkg.config.elements[i], n = i + 1, rel = isRelGap(el);
  // nomes pelo par: Gap_k = entre o elemento k e o k+1 (o valor fica guardado no elemento posicionado)
  const asRef = (nm) => nm.replace('_', '_ref_');
  const G = asRef(pairName(pkg, n, 'Gap')), O = asRef(pairName(pkg, n, 'Overlap'));
  const ovName = dsOv === 'stagger' ? `${asRef(pairName(pkg, n, 'Stagger'))} (${pairName(pkg, n, 'Overlap')})` : O;
  const b = gapBaseIndex(pkg, i), cb = Number(pkg.config.elements[b]?.chord_ref);
  const unitSel = selectField({ label: 'Gap / Overlap em', value: rel ? 'corda' : 'mm', options: [['mm', 'mm'], ['corda', 'Fração da corda (x/c)']],
    onChange: (v) => store.update(() => {
      if (v === 'corda') {
        el.gapUnit = 'corda';
        const c = Number(pkg.config.elements[gapBaseIndex(pkg, i)]?.chord_ref);
        const f = (mm) => (c > 0 && Number.isFinite(Number(mm)) && mm !== null ? +(Number(mm) / c).toPrecision(6) : null);
        el.gapc_ref = f(el.gap_ref); el.overlapc_ref = f(el.overlap_ref);
      } else el.gapUnit = 'mm';
    }, ['geometria', `${pkg.name} / elemento ${n}`, 'unidade de gap/overlap', v]) });
  if (!rel) {
    return [unitSel,
      numField({ label: G, unit: 'mm', value: el.gap_ref, required: true, key: `g${i}`, onChange: (v) => setEl(pkg, i, 'gap_ref', v, G), hint: gapHint }),
      numField({ label: ovName, unit: 'mm', value: el.overlap_ref, required: true, key: `o${i}`, onChange: (v) => setEl(pkg, i, 'overlap_ref', v, O), hint: ovHint })];
  }
  const tp = resolveTopology(pkg.config.elements), r = tp.refs[i], p = Math.max(0, tp.kinds.indexOf('principal'));
  const mmHint = (f, base) => (cb > 0 && Number.isFinite(Number(f)) && f !== null ? `= ${fmt(f * cb, 3)} mm (${fmt(100 * f, 3)} % de chord_${b + 1} = ${fmt(cb, 1)} mm). ${base}` : base);
  return [unitSel,
    selectField({ label: 'Corda de referência', value: el.gapBase || 'ref', options: [['ref', `chord_${r + 1} (elemento de referência)`], ['proprio', `chord_${n} (este elemento)`], ['principal', `chord_${p + 1} (principal)`]], onChange: (v) => setEl(pkg, i, 'gapBase', v, 'corda base do gap/overlap') }),
    numField({ label: `${G} / chord_${b + 1}`, unit: 'x/c', value: el.gapc_ref, required: true, key: `gc${i}`, onChange: (v) => setEl(pkg, i, 'gapc_ref', v, `${G}/c`), hint: mmHint(el.gapc_ref, gapHint) }),
    numField({ label: `${ovName} / chord_${b + 1}`, unit: 'x/c', value: el.overlapc_ref, required: true, key: `oc${i}`, onChange: (v) => setEl(pkg, i, 'overlapc_ref', v, `${O}/c`), hint: mmHint(el.overlapc_ref, ovHint) })];
}

function elementCard(pkg, i, w) {
  const el = pkg.config.elements[i], n = i + 1, proc = w.procs?.[i];
  const tp = resolveTopology(pkg.config.elements), kind = tp.kinds[i];
  const pr = pairOf(pkg, n);
  const loadDat = (text, name) => store.update(() => { el.datText = text; el.datFileName = name; if (!el.profileName) el.profileName = name.replace(/\.\w+$/, ''); }, ['geometria', `${pkg.name} / elemento ${n}`, '.dat importado', name]);
  const piv = Number(el.chord_ref) > 0 && Number(el.pivot_dTE_ref) > 0 ? pivotLocal(Number(el.chord_ref), Number(el.pivot_off_ref), Number(el.pivot_dTE_ref), pkg.config.conventions) : null;
  const refOpts = pkg.config.elements.map((_, j) => [String(j), `Elemento ${j + 1} (${tp.kinds[j]})`]).filter(([j]) => Number(j) !== i);
  const dsOv = pr && pr.kind === 'upperflap' && pr.anchor === 'ba' ? 'stagger' : 'overlap';
  const gapHint = !pr ? '' : pr.kind === 'slat'
    ? `BF do slat → BA do elemento ${pr.b}: Gap > 0 = lado de sucção (DS_gap${pr.a}${pr.b})`
    : pr.kind === 'upperflap'
      ? `${pr.anchor === 'ba' ? 'BA' : 'BF'} do elemento ${pr.a} → BA deste: Gap > 0 = acima (lado de pressão) (DS_gap${pr.a}${pr.b})`
      : `${pr.anchor === 'ba' ? 'BA' : 'BF'} do elemento ${pr.a} → BA deste: Gap > 0 = lado de pressão (DS_gap${pr.a}${pr.b})`;
  const ovHint = !pr ? '' : pr.kind === 'slat'
    ? `Overlap > 0 = BF do slat a jusante do BA do ref (DS_overlap${pr.a}${pr.b})`
    : pr.kind === 'upperflap' && pr.anchor === 'ba'
      ? `Stagger: > 0 = BA deste a jusante do BA do ref (DS_stagger${pr.a}${pr.b})`
      : pr.anchor === 'ba'
        ? `Overlap: distância horizontal entre os BAs; > 0 = BA deste a jusante do BA do ref (DS_overlap${pr.a}${pr.b})`
        : `Overlap > 0 = BA a montante do BF do ref (DS_overlap${pr.a}${pr.b})`;
  const removable = kind === 'slat' || kind === 'upperflap';
  return h('div', { class: 'el-card' },
    h('h3', null, swatch(i), `Elemento ${n}`, ' ', badge(kind, kind === 'slat' || kind === 'upperflap' ? 'info' : kind === 'principal' ? 'ok' : ''), el.profileName ? h('span', { class: 'muted' }, ` — ${el.profileName}`) : null,
      removable ? h('span', { style: { marginLeft: 'auto' } }, h('button', { class: 'small danger', onclick: async () => { if (await confirmBox(`Remover ${kind}`, `Remover o elemento ${n} (${kind})? Elementos que o usam como referência passam a usar o principal.`, 'Remover', true)) store.update(() => { pkg.config.elements.splice(i, 1); pkg.config.elements.forEach((e) => { if (Number.isInteger(e.ref)) e.ref = e.ref === i ? null : e.ref > i ? e.ref - 1 : e.ref; }); pkg.config.nElements = pkg.config.elements.length; syncDependentLists(pkg.config); }, ['geometria', pkg.name, `${kind} (elemento ${n}) removido`]); } }, `Remover ${kind}`)) : null),
    h('div', { class: 'fields' },
      selectField({ label: 'Tipo de elemento', value: kind, options: [['principal', 'Principal (ancorado)'], ['flap', 'Flap (a jusante do ref)'], ['slat', 'Slat (a montante do ref)'], ['upperflap', 'Upperflap (acima do ref)']], onChange: (v) => store.update(() => { if (v === 'principal') pkg.config.elements.forEach((e, j) => { if (j !== i && e.type === 'principal') e.type = 'flap'; }); el.type = v; el.ref = null; syncDependentLists(pkg.config); }, ['geometria', `${pkg.name} / elemento ${n}`, 'tipo', v]) }),
      kind !== 'principal' ? selectField({ label: 'Posicionado em relação a', value: String(tp.refs[i]), options: refOpts, onChange: (v) => setEl(pkg, i, 'ref', Number(v), 'referência') }) : null,
      kind === 'upperflap' && leToLe(pkg.config.conventions) ? h('div', { class: 'field' }, h('label', null, 'Ponto de referência do upperflap'), h('span', { class: 'muted' }, 'BA do elemento de referência (Convenções: Gap/Overlap medidos entre os bordos de ataque)')) : null,
      kind === 'upperflap' && !leToLe(pkg.config.conventions) ? selectField({ label: 'Ponto de referência do upperflap', value: el.upAnchor === 'ba' ? 'ba' : 'bf', options: [['bf', 'BF do elemento de referência (Gap + Overlap)'], ['ba', 'BA do elemento de referência (Gap + Stagger)']], onChange: (v) => setEl(pkg, i, 'upAnchor', v, 'referência do upperflap') }) : null,
      textField({ label: 'Nome do perfil', value: el.profileName, key: `pn${i}`, onChange: (v) => setEl(pkg, i, 'profileName', v, 'nome do perfil') }),
      selectField({ label: 'Coordenadas do .dat', value: el.inputMode, options: [['normalizado', 'Normalizadas (x/c)'], ['físico', 'Físicas (mm)']], onChange: (v) => setEl(pkg, i, 'inputMode', v, 'modo de entrada') }),
      numField({ label: `chord_ref_${n}`, unit: 'mm', value: el.chord_ref, required: true, key: `c${i}`, onChange: (v) => setEl(pkg, i, 'chord_ref', v, `chord_ref_${n}`), hint: el.inputMode === 'físico' && proc?.normalized ? `corda no arquivo: ${fv(proc.normalized.fileChord, 5)} mm` : null }),
      numField({ label: `AoA_ref_${n}`, unit: '°', value: el.aoa_ref, required: true, key: `a${i}`, onChange: (v) => setEl(pkg, i, 'aoa_ref', v, `AoA_ref_${n}`), hint: 'absoluto, em relação ao escoamento' }),
      ...(pr ? gapFields(pkg, i, dsOv, gapHint, ovHint) : []),
      numField({ label: `pivot_off_ref_${n}`, unit: 'mm', value: el.pivot_off_ref, required: true, key: `po${i}`, onChange: (v) => setEl(pkg, i, 'pivot_off_ref', v, `pivot_off_ref_${n}`), hint: 'distância perpendicular à corda' }),
      numField({ label: `pivot_dTE_ref_${n}`, unit: 'mm', value: el.pivot_dTE_ref, required: true, key: `pd${i}`, onChange: (v) => setEl(pkg, i, 'pivot_dTE_ref', v, `pivot_dTE_ref_${n}`), hint: piv?.ok ? `pivô a ${fmt(100 * piv.fractionFromLE, 1)} % da corda a partir do BA` : piv ? piv.error : 'distância pivô–BF' }),
    ),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { onclick: async () => { const f = await pickFile('.dat,.txt,.csv'); if (f) loadDat(f.text, f.name); } }, 'Carregar .dat…'),
      h('button', { class: 'small', onclick: () => loadDat(S1223_DAT, 'S1223.dat') }, 'Amostra S1223'),
      h('button', { class: 'small', onclick: () => loadDat(NACA23012_DAT, 'NACA23012.dat') }, 'Amostra NACA 23012'),
      h('button', { class: 'small', onclick: () => loadDat(E423_DAT, 'E423.dat') }, 'Amostra E423'),
      h('button', { class: 'small', onclick: () => loadDat(FX74CL5140_DAT, 'FX74_CL5_140.dat') }, 'Amostra FX 74-CL5-140'),
      el.datFileName ? h('span', { class: 'muted' }, `arquivo: ${el.datFileName}`) : badge('sem .dat', 'warn'),
      h('span', { class: 'spacer' }),
      checkField({ label: 'Alinhar corda BA–BF ao eixo x', checked: el.alignChord !== false, onChange: (v) => setEl(pkg, i, 'alignChord', v, 'alinhar corda') })),
    gurneyBlock(pkg, i, w),
    datSummary(proc), previews(pkg, i, proc, el));
}

// ------------------------------------------------------------------ Aba BF
function teCard(pkg, i, w) {
  const el = pkg.config.elements[i], n = i + 1, proc = w.procs?.[i], te = el.te;
  const r = proc?.te;
  const c = Number(el.chord_ref) || 1;
  const body = [h('div', { class: 'fields' },
    checkField({ label: 'Arredondar o bordo de fuga', checked: te.enabled, onChange: (v) => store.update(() => { te.enabled = v; }, ['geometria', `elemento ${n}`, v ? 'BF arredondado' : 'BF revertido ao original']) }),
    selectField({ label: 'Raio em', value: te.mode, options: [['pct', '% da corda'], ['mm', 'mm']], onChange: (v) => store.update(() => { if (v !== te.mode && Number(te.value) > 0 && c > 0) te.value = v === 'mm' ? +(te.value / 100 * c).toPrecision(6) : +(te.value / c * 100).toPrecision(6); te.mode = v; }) }),
    numField({ label: 'Raio do BF', unit: te.mode === 'mm' ? 'mm' : '% c', value: te.value, key: `te${i}`, onChange: (v) => store.update(() => { te.value = v; }, ['geometria', `elemento ${n}`, 'raio do BF', `${v} ${te.mode}`]), hint: te.mode === 'mm' ? `= ${fv(te.value / c * 100, 4)} % de chord_ref (escala com a corda nos DPs)` : `= ${fv(te.value / 100 * c, 4)} mm com chord_ref` }),
    numField({ label: 'Pontos no arco', unit: 'pts', value: te.arcPoints, key: `ta${i}`, onChange: (v) => store.update(() => { te.arcPoints = Math.max(4, Math.round(v || 16)); }) }))];
  if (te.enabled && r) {
    body.push(r.ok ? h('div', { class: 'kv', style: { marginTop: '10px' } },
      h('dt', null, 'Centro do círculo (x/c, y/c)'), h('dd', null, pt(r.center, 6)),
      h('dt', null, 'Tangência extradorso / intradorso'), h('dd', null, `${pt(r.tu, 6)} / ${pt(r.tl, 6)}`),
      h('dt', null, 'Pontos originais substituídos'), h('dd', null, `${r.replaced.upper} (extradorso) + ${r.replaced.lower} (intradorso); ${r.transitionPoints} ponto(s) de transição inseridos sobre a curva`),
      h('dt', null, 'Região modificada'), h('dd', null, `x/c ≥ ${fv(r.xMinModified, 5)} (só o BF)`),
      h('dt', null, 'Corda geométrica (BA → extremo do BF)'), h('dd', null, `${fv(proc.chordInfo.ratio, 6)} da corda original, girada ${fv(proc.chordInfo.angleDeg, 4)}°`),
      h('dt', null, 'Espessura no BF'), h('dd', null, `${fv(2 * r.r * 100, 4)} % c = ${fv(2 * r.r * c, 4)} mm`)) : null,
    msgs([...(r.errors || []).map((m) => ({ level: 'erro', msg: m })), ...(r.messages || []).map((m) => ({ level: 'aviso', msg: m })), ...(r.ok && !r.messages.length ? [{ level: 'ok', msg: 'Arredondamento válido: arco tangente às duas superfícies, sem auto-interseção, só a região do BF alterada.' }] : [])]));
  }
  if (proc?.ok) {
    const orig = proc.original, fin = te.enabled && r?.ok ? r.pts : null;
    const zoomPts = orig.filter((p) => p[0] > 0.95);
    body.push(h('div', { style: { marginTop: '10px' } }, h('div', { class: 'lbl' }, 'Detalhe do BF — original (cinza tracejado) × arredondado (cor). O original é sempre mantido: desmarcar a opção reverte.'),
      geomPlot(() => ({ elements: fin ? [{ pts: fin, label: '' }] : [], overlays: [{ pts: orig, dash: '4 3', color: '#898781' }, ...(r?.ok ? [{ pts: circle(r.center, r.r), dash: '1 3', color: '#898781' }] : [])], fitPts: zoomPts.length ? zoomPts : orig, axes: ['x/c', 'y/c'] }), { height: 260, show: { pivots: false, chords: false, vectors: false, labels: false }, name: `BF_elemento_${n}` })));
  }
  return h('div', { class: 'el-card' }, h('h3', null, swatch(i), `Elemento ${n} — ${el.profileName || 'sem perfil'}`), body);
}
const circle = (c, r) => Array.from({ length: 48 }, (_, k) => [c[0] + r * Math.cos((k / 48) * 2 * Math.PI), c[1] + r * Math.sin((k / 48) * 2 * Math.PI)]);

// ------------------------------------------------------------------ Aba Montagem
function assemblyScene(pkg, w) {
  const t = pkg.config.transform, d = directions(t), gapDef = pkg.config.conventions?.gapDef || 'ponto';
  // gap pela tangente: reta horizontal tangente ao elemento e cota vertical do gap (no plano do CAD)
  const tanOf = (s) => {
    const c = gapDef === 'tangente' ? s.tanBF : gapDef === 'tangenteLivre' ? s.tanFree : null;
    return c && { value: c.value, tangent: toPlane(c.tangent, t), from: toPlane(c.from, t), foot: toPlane(c.foot, t), line: c.line.map((p) => toPlane(p, t)) };
  };
  return {
    elements: w.plane.map((e, i) => ({ ...e, label: `Elemento ${i + 1}${e.kind !== 'flap' ? ` (${e.kind})` : ''}` })), slots: w.asm.slots.map((s) => ({ ...s, from: toPlane(s.from, t), to: toPlane(s.to, t), pa: s.pa && toPlane(s.pa, t), pb: s.pb && toPlane(s.pb, t), tan: tanOf(s) })),
    flow: [t.sx, 0], lift: [0, t.sy], liftLabel: t.sy < 0 ? `sustentação (${d.liftLabel}, downforce)` : `sustentação (${d.liftLabel})`, axes: planeAxes(t.plane),
  };
}

/** Valor de gap; a medida que comanda a montagem aparece em destaque. */
const gapCell = (txt, active) => (active ? h('strong', { title: 'Definição de gap usada na montagem' }, txt, ' ', badge('usado', 'info')) : txt);

function measurements(pkg, w) {
  const t = pkg.config.transform, cv = { gapDef: 'ponto', ...pkg.config.conventions };
  return h('div', null,
    table([
      { label: 'Elem.', get: (e, i) => h('span', null, swatch(i), ` ${i + 1}`) },
      { label: 'Tipo', get: (e) => `${e.kind}${e.ref != null ? ` (ref. ${e.ref + 1})` : ''}` },
      { label: 'Corda', unit: 'mm', num: true, get: (e) => fmt(e.chord, 2) },
      { label: 'AoA', unit: '°', num: true, get: (e) => fmt(e.aoa, 2) },
      { label: 'Deflexão rel.', unit: '°', num: true, get: (e) => (e.relDeflection == null ? '—' : fmt(e.relDeflection, 2)) },
      { label: 'BA (LE)', unit: 'mm', get: (e) => pt(e.le) }, { label: 'BF (TE)', unit: 'mm', get: (e) => pt(e.te) }, { label: 'Pivô', unit: 'mm', get: (e) => pt(e.pivot) },
      { label: 'Pivô no perfil', get: (e, i) => (w.asm.elements[i].pivotInside ? badge(`dentro (${fmt(w.asm.elements[i].pivotClearance, 2)} mm)`, 'ok') : badge(`fora (${fmt(w.asm.elements[i].pivotClearance, 2)} mm)`, 'warn')) },
    ], w.plane),
    w.asm.slots.length ? h('div', { style: { marginTop: '10px' } }, table([
      { label: 'Par', get: (s) => `${s.pair[0]}–${s.pair[1]}${s.kind === 'slat' ? ' (slat)' : ''}` },
      { label: 'Gap ponto a ponto', unit: 'mm', num: true, get: (s) => gapCell(fmt(s.gapFlow, 3), cv.gapDef === 'ponto' && cv.gapAxes !== 'corda') },
      { label: 'Gap tangente', unit: 'mm', num: true, get: (s) => (s.gapTangent == null ? h('span', { class: 'muted', title: 'Não se aplica ao slat' }, '—') : gapCell(fmt(s.gapTangent, 3), cv.gapDef === 'tangente' && s.kind !== 'slat')) },
      { label: 'Gap tangente livre', unit: 'mm', num: true, get: (s) => (s.gapTangentClear == null ? h('span', { class: 'muted', title: 'Não se aplica ao slat' }, '—') : gapCell(fmt(s.gapTangentClear, 3), cv.gapDef === 'tangenteLivre' && s.kind !== 'slat')) },
      { label: 'Folga real', unit: 'mm', num: true, get: (s) => (s.clearance === 0 ? badge('INTERSEÇÃO', 'err') : gapCell(fmt(s.clearance, 3), cv.gapDef === 'minimo')) },
      { label: 'Overlap escoam.', unit: 'mm', num: true, get: (s) => fmt(s.overlapFlow, 3) },
      { label: 'Gap eixos do ref', unit: 'mm', num: true, get: (s) => gapCell(fmt(s.gapChord, 3), cv.gapDef === 'ponto' && cv.gapAxes === 'corda') }, { label: 'Overlap eixos do ref', unit: 'mm', num: true, get: (s) => fmt(s.overlapChord, 3) },
    ], w.asm.slots), h('p', { class: 'muted', style: { margin: '6px 0 0' } }, `Medidas do gap: ponto a ponto (${leToLe(cv) ? 'BA do ref → BA do elemento, na vertical; overlap = distância horizontal entre os BAs' : 'BF do ref → BA do elemento, na vertical'}), tangente (BF do ref → reta horizontal tangente ao extradorso do flap), tangente livre (ponto mais baixo do ref sobre o flap → mesma tangente; > 0 garante que não há interseção) e folga real (menor distância entre os contornos). Em destaque, a que está comandando a montagem (Convenções → Definição do gap).`)) : null,
    h('h3', null, 'Verificações'),
    w.asm.checks.length ? msgs(w.asm.checks) : msgs([{ level: 'ok', msg: 'Sem interseções, pivôs dentro dos perfis e cotas válidas para o SolidWorks.' }]),
    h('p', { class: 'muted' }, `Coordenadas no plano ${t.plane} do CAD. Vista: roda do mouse = zoom, arrastar = mover. Linha vermelha = folga mínima da fenda.`));
}

function liveControls(pkg, plotBox, measBox, plot) {
  const c = pkg.config;
  const rows = c.elements.map((el, i) => {
    const n = i + 1;
    const mk = (field, label, min, max, step, unit) => {
      const v = Number(el[field]), dec = step < 0.01 ? 3 : 2;
      if (el[field] == null || !Number.isFinite(v)) return null;
      const out = h('span', { class: 'tnum', style: { width: '84px', display: 'inline-block', textAlign: 'right' } }, `${fmt(v, dec)} ${unit}`);
      const r = h('input', { type: 'range', min, max, step, value: v, style: { flex: 1 } });
      r.addEventListener('input', () => {
        const nv = Number(r.value);
        store.update(() => { el[field] = nv; }, null, { silent: true });
        out.textContent = `${fmt(nv, dec)} ${unit}`;
        const w = wingOf(pkg);
        if (w.plane) { plot.redraw(); measBox.replaceChildren(measurements(pkg, w)); }
      });
      r.addEventListener('change', () => store.update(() => { }, ['geometria', `${pkg.name} / elemento ${n}`, `${label} (controle deslizante)`, r.value]));
      return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { style: { width: '90px' } }, label), r, out);
    };
    // flap medido entre os BAs: Overlap ~ corda do ref, Gap ~ c·sen(AoA_ref) + folga
    const pr = pairOf(pkg, n), ba = pr?.kind === 'flap' && pr.anchor === 'ba';
    const cb = Number(c.elements[isRelGap(el) ? gapBaseIndex(pkg, i) : pr ? pr.a - 1 : i]?.chord_ref) || 100, f = isRelGap(el) ? 1 : cb;
    const rg = (a, b, step) => [+(a * f).toPrecision(3), +(b * f).toPrecision(3), isRelGap(el) ? 0.001 : step];
    return h('div', { class: 'el-card' }, h('h3', null, swatch(i), `Elemento ${n}`),
      mk('aoa_ref', `AoA_${n}`, -45, 60, 0.5, '°'),
      pr ? (isRelGap(el) ? mk('gapc_ref', `${pairName(pkg, n, 'Gap')}/c`, ...(ba ? rg(0.001, 0.5) : [0.001, 0.15, 0.001]), 'x/c') : mk('gap_ref', pairName(pkg, n, 'Gap'), ...(ba ? rg(0.001, 0.5, 0.1) : [0.1, 25, 0.1]), 'mm')) : null,
      pr ? (isRelGap(el) ? mk('overlapc_ref', `${pairName(pkg, n, 'Overlap')}/c`, ...(ba ? rg(0.5, 1.2) : [0.001, 0.15, 0.001]), 'x/c') : mk('overlap_ref', pairName(pkg, n, 'Overlap'), ...(ba ? rg(0.5, 1.2, 0.1) : [0.1, 20, 0.1]), 'mm')) : null,
      mk('chord_ref', `chord_${n}`, 10, 400, 1, 'mm'));
  });
  void plotBox;
  return h('div', null, h('p', { class: 'muted' }, 'Ajuste ao vivo dos valores de referência (recalcula a montagem enquanto arrasta).'), rows);
}

function assemblyTab(pkg, w, ctx) {
  if (!w.plane) return card('Montagem', msgs(w.errors.map((m) => ({ level: 'erro', msg: m }))), h('p', null, 'Complete os dados dos elementos (aba Elementos e .dat).'));
  const ui = ctx.ui;
  ui.show = ui.show || { pivots: true, chords: true, gaps: true, vectors: true, labels: true, clearance: true };
  let plot;
  const scene = () => assemblyScene(pkg, wingOf(pkg));
  plot = geomPlot(scene, { height: 460, show: ui.show, name: `montagem_${pkg.name}` });
  const meas = h('div', null, measurements(pkg, w));
  const toggles = h('div', { class: 'row' }, [['pivots', 'Pivôs'], ['chords', 'Cordas'], ['gaps', 'Gap/overlap'], ['clearance', 'Folga mínima'], ['vectors', 'Vetores'], ['labels', 'Rótulos']].map(([k, l]) => checkField({ label: l, checked: ui.show[k], onChange: (v) => { ui.show[k] = v; plot.redraw(); } })));
  return h('div', null,
    card('Montagem 2D', toggles, h('div', { style: { height: '8px' } }), plot),
    h('div', { class: 'grid g-side' }, card('Ajuste ao vivo', liveControls(pkg, null, meas, plot)), card('Medições e verificações', meas)),
    view3dCard(pkg, w, ctx));
}

/** Vista 3D (Three.js), aberta sob demanda para não carregar a biblioteca sem necessidade. */
function view3dCard(pkg, w, ctx) {
  const ui = ctx.ui;
  const c = pkg.config, is3D = c.mode === '3D' && Number(c.span_mm) > 0;
  const depth = is3D ? Number(c.span_mm) : Math.round(1.5 * Math.max(...w.plane.map((e) => e.chord)));
  const note = is3D ? `Extrusão pela envergadura do pacote: ${fmt(depth, 0)} mm.` : `Estudo 2D: a profundidade de ${fmt(depth, 0)} mm é só para visualização (1,5 × a maior corda), não é a envergadura.`;
  if (!ui.show3d) return card('Vista 3D', h('p', { class: 'muted', style: { marginTop: 0 } }, note), h('button', { onclick: () => { ui.show3d = true; ctx.rerender(); } }, 'Abrir vista 3D'));
  const view = wing3D(w, depth, { height: 440 });
  return card('Vista 3D', h('p', { class: 'muted', style: { marginTop: 0 } }, `${note} Arraste para girar, roda do mouse para zoom, botão direito para mover.`), view,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'small', onclick: () => view.reset?.() }, 'Restaurar vista'),
      h('button', { class: 'small', onclick: () => { const u = view.png?.(); if (u) { const a = document.createElement('a'); a.href = u; a.download = `${pkg.name}_3D.png`; a.click(); } } }, 'Salvar PNG'),
      h('button', { class: 'small', onclick: () => { ui.show3d = false; ctx.rerender(); } }, 'Fechar vista 3D')));
}

// ------------------------------------------------------------------ Aba Sugestões
function suggestTab(pkg, ctx) {
  const s = suggestConfig(pkg), tp = resolveTopology(pkg.config.elements);
  const setS = (fn, label, v) => store.update(fn, ['geometria', pkg.name, `sugestões: ${label}`, String(v)]);
  const types = [['flap', 'Flap'], ['slat', 'Slat'], ['upperflap', 'Upperflap']];
  const ruleTable = h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null,
      h('tr', { class: 'grp' }, h('th', null, ''), types.map(([, l]) => h('th', { colspan: 3 }, l))),
      h('tr', null, h('th', null, 'Faixa'), types.flatMap(() => ['mín', 'centro', 'máx'].map((t) => h('th', { class: 'num' }, t))))),
    h('tbody', null, RULE_FIELDS.map(([f, label, unit]) => h('tr', null, h('td', null, h('code', null, label), h('span', { class: 'th-unit' }, ` [${unit}]`)),
      types.flatMap(([k]) => ['min', 'mid', 'max'].map((m) => h('td', null, numField({ value: s.rules[k][f][m], key: `sg_${k}_${f}_${m}`, onChange: (v) => setS(() => { s.rules[k][f][m] = v; }, `${k} ${f} ${m}`, v) })))))))));
  const sug = suggestGeometry(pkg);
  const rng = (r, unit, d = 2) => (!r ? h('span', { class: 'muted' }, '—') : h('span', null, h('strong', null, `${fmt(r.mid, d)}`), r.min != null && r.max != null ? h('small', { class: 'muted' }, ` (${fmt(r.min, d)} a ${fmt(r.max, d)})`) : null, ` ${unit}`));
  const cur = (v, unit, d = 2) => (v == null || v === '' ? '—' : `${fmt(Number(v), d)} ${unit}`);
  const run = ctx.run;
  const toDOE = (i) => {
    const n = i + 1, o = sug[i], el = pkg.config.elements[i];
    const lv = {};
    if (o.aoa?.min != null) lv[`AoA_${n}`] = levelsText(o.aoa);
    ['gap', 'overlap'].forEach((k) => {
      if (!o[k] || o[k].min == null) return;
      const K = k === 'gap' ? 'Gap' : 'Overlap';
      if (isRelGap(el)) {
        const cb = Number(pkg.config.elements[gapBaseIndex(pkg, i)]?.chord_ref);
        if (cb > 0) lv[`${K}_${n}_c`] = levelsText({ min: o[k].min / cb, mid: o[k].mid / cb, max: o[k].max / cb });
      } else lv[`${K}_${n}`] = levelsText(o[k]);
    });
    store.update(() => { Object.assign(run.doe.levels = run.doe.levels || {}, lv); }, ['DOE', run.name, `níveis sugeridos do elemento ${n}`, Object.keys(lv).join(', ')]);
    toast(`Níveis de ${Object.keys(lv).join(', ')} colocados na rodada "${run.name}" (Inputs / Design Points).`);
  };
  const rows = sug.map((o, i) => {
    const el = pkg.config.elements[i], n = i + 1;
    return h('tr', null,
      h('td', null, swatch(i), ` ${n}`), h('td', null, `${o.kind}${o.ref != null ? ` (ref. ${o.ref + 1})` : ''}`),
      h('td', null, rng(o.chord, 'mm', 1), h('br'), h('small', { class: 'muted' }, `atual: ${cur(el.chord_ref, 'mm', 1)}`)),
      h('td', null, rng(o.aoa, '°', 1), h('br'), h('small', { class: 'muted' }, `atual: ${cur(el.aoa_ref, '°', 1)}`)),
      h('td', null, o.kind === 'principal' ? '—' : [rng(o.gap, 'mm'), h('br'), h('small', { class: 'muted' }, `atual: ${cur(el.gap_ref, 'mm')}`)]),
      h('td', null, o.kind === 'principal' ? '—' : [rng(o.overlap, 'mm'), h('br'), h('small', { class: 'muted' }, `atual: ${cur(el.overlap_ref, 'mm')}`)]),
      h('td', null, run && o.kind !== 'principal' && (o.aoa?.min != null || o.gap?.min != null) ? h('button', { class: 'small', onclick: () => toDOE(i) }, 'Níveis no DOE') : null));
  });
  const allMsgs = sug.flatMap((o, i) => o.msgs.map((m) => ({ level: 'aviso', msg: `Elemento ${i + 1}: ${m}` })));
  return h('div', null,
    card('Configuração das sugestões',
      h('div', { class: 'fields' },
        numField({ label: 'Corda total disponível (soma das cordas)', unit: 'mm', value: s.totalChord, key: 'sg_tot', onChange: (v) => setS(() => { s.totalChord = v; }, 'corda total', v), hint: 'opcional: divide entre os elementos pelas razões de corda; vazio = parte do chord_ref do principal' }),
        numField({ label: 'AoA do principal', unit: '°', value: s.mainAoA, key: 'sg_aoa', onChange: (v) => setS(() => { s.mainAoA = v; }, 'AoA do principal', v), hint: 'vazio = usa AoA_ref do principal' })),
      h('div', { style: { height: '10px' } }), ruleTable,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'small', onclick: async () => { if (await confirmBox('Restaurar faixas', 'Voltar todas as faixas para os valores padrão?', 'Restaurar')) setS(() => { pkg.config.suggest = clone(DEFAULT_SUGGEST); }, 'faixas restauradas', 'padrão'); } }, 'Restaurar faixas padrão')),
      h('p', { class: 'muted', style: { margin: '8px 0 0' } }, 'As faixas são relativas ao elemento de referência de cada elemento (o que está em "Posicionado em relação a"): chord_n = razão × chord_ref, AoA_n = AoA_ref + ΔAoA, Gap/Overlap = fração × chord_ref. Os padrões são faixas típicas de partida para flaps e slats de asas multielemento (literatura de alta sustentação e asas de FSAE), não valores otimizados. O upperflap vem vazio porque não há faixa típica de referência: preencha com os seus dados.')),
    card('Sugestão por elemento',
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Elem.', 'Tipo', 'chord', 'AoA', 'Gap', 'Overlap / stagger', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows))),
      allMsgs.length ? msgs(allMsgs) : null,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'primary', onclick: async () => {
          if (!(await confirmBox('Aplicar sugestão', 'Substituir chord_ref, AoA_ref, Gap_ref e Overlap_ref pelos valores centrais sugeridos? Os pivôs são escalados junto com a corda. O histórico registra a alteração, mas não a desfaz automaticamente.', 'Aplicar'))) return;
          let k = 0;
          store.update(() => { k = applySuggestion(pkg, suggestGeometry(pkg), { gapBaseIndexOf: (i) => gapBaseIndex(pkg, i) }); }, ['geometria', pkg.name, 'sugestão aplicada', 'valores centrais']);
          toast(`${k} valor(es) atualizado(s). Confira a montagem e as verificações.`);
        } }, 'Aplicar valores centrais na geometria'),
        h('small', { class: 'muted' }, run ? `"Níveis no DOE" coloca mín; centro; máx de AoA, Gap e Overlap do elemento na rodada "${run.name}".` : 'Selecione uma rodada para enviar as faixas como níveis do DOE.')),
      h('p', { class: 'muted', style: { margin: '8px 0 0' } }, 'Sugestão é ponto de partida: confira a folga real e as interseções na aba Montagem e escolha o melhor valor pelo DOE/CFD.')));
}

// ------------------------------------------------------------------ Aba Mapa de conflito
const CM_COLORS = { ok: 'var(--ok)', aviso: 'var(--warn)', regra: '#8c8c9c', erro: 'var(--err)' };
const CM_LABEL = { ok: 'OK', aviso: 'aviso (folga baixa, pivô fora...)', regra: 'regra do DOE (corda/AoA)', erro: 'erro (se atravessam / cota inválida)' };

/** Grava um valor de variável do DOE no _ref correspondente do elemento. */
function setRefFromKey(pkg, key, v) {
  const m = key.match(/^(chord|AoA|Gap|Overlap|gurney_h|gurney_t|gurney_pos)_(\d+)(_c)?$/);
  if (!m) return false;
  const el = pkg.config.elements[Number(m[2]) - 1];
  if (!el) return false;
  const f = { chord: 'chord_ref', AoA: 'aoa_ref', Gap: m[3] ? 'gapc_ref' : 'gap_ref', Overlap: m[3] ? 'overlapc_ref' : 'overlap_ref' }[m[1]];
  if (f) { el[f] = v; return true; }
  el.gurney = { ...el.gurney, [m[1].slice(7)]: v };
  return true;
}

function conflictTab(pkg, ctx) {
  const vars = conflictVariables(pkg);
  if (vars.length < 2) return card('Mapa de conflito', msgs([{ level: 'aviso', msg: 'São necessárias pelo menos 2 variáveis (ex.: Gap_1 e Overlap_1, entre os elementos 1 e 2): adicione um flap com valores de referência.' }]));
  const ui = ctx.ui, byKey = Object.fromEntries(vars.map((v) => [v.key, v]));
  const firstPair = vars.find((v) => /^Gap_/.test(v.key));
  const cm = (ui.cm = ui.cm || {});
  if (!byKey[cm.x]) { cm.x = firstPair?.key || vars[0].key; Object.assign(cm, { xMin: null, xMax: null }); }
  if (!byKey[cm.y] || cm.y === cm.x) { cm.y = (vars.find((v) => /^Overlap_/.test(v.key) && v.key !== cm.x) || vars.find((v) => v.key !== cm.x)).key; Object.assign(cm, { yMin: null, yMax: null }); }
  const X = byKey[cm.x], Y = byKey[cm.y];
  if (cm.xMin == null && cm.xMax == null) Object.assign(cm, { xMin: defaultRange(X).min, xMax: defaultRange(X).max });
  if (cm.yMin == null && cm.yMax == null) Object.assign(cm, { yMin: defaultRange(Y).min, yMax: defaultRange(Y).max });
  cm.n = cm.n || 25;
  const opts = vars.map((v) => [v.key, `${v.label} [${v.unit}] — ${v.group}`]);
  const progress = h('span', { class: 'muted', dataset: { cmProgress: '1' } }, cm.running ? 'calculando…' : '');
  const pivotScaling = ctx.run?.doe?.pivotScaling !== false;

  const run = () => {
    const bad = [cm.xMin, cm.xMax, cm.yMin, cm.yMax].some((v) => v == null || !Number.isFinite(Number(v)));
    if (bad || !(cm.xMax > cm.xMin) || !(cm.yMax > cm.yMin)) { toast('Informe mín < máx nos dois eixos.', true); return; }
    const grid = makeGrid(pkg, { x: { key: cm.x, min: cm.xMin, max: cm.xMax }, y: { key: cm.y, min: cm.yMin, max: cm.yMax }, nx: cm.n, ny: cm.n, base: ctx.run?.doe?.base });
    grid.at = new Date(); grid.labels = { x: X, y: Y };
    cm.grid = grid; cm.sel = null; cm.running = true;
    const total = grid.xs.length * grid.ys.length, t0 = performance.now();
    let k = 0;
    const step = () => {
      if (cm.grid !== grid) return; // outro cálculo começou
      const end = Math.min(total, k + 30);
      for (; k < end; k++) evalCell(pkg, grid, k % grid.xs.length, Math.floor(k / grid.xs.length), pivotScaling);
      const pe = document.querySelector('[data-cm-progress]');
      if (pe) pe.textContent = `calculando… ${Math.round((100 * k) / total)} %`;
      if (k < total) setTimeout(step, 0);
      else { cm.running = false; grid.ms = performance.now() - t0; ctx.rerender(); }
    };
    ctx.rerender();
    setTimeout(step, 0);
  };

  const setup = card('Mapa de conflito — configuração',
    h('div', { class: 'fields' },
      selectField({ label: 'Eixo X', value: cm.x, options: opts, onChange: (v) => { Object.assign(cm, { x: v, xMin: null, xMax: null }); ctx.rerender(); } }),
      numField({ label: `${X.label} mín`, unit: X.unit, value: cm.xMin, key: `cm_xmin_${cm.x}`, onChange: (v) => { cm.xMin = v; } }),
      numField({ label: `${X.label} máx`, unit: X.unit, value: cm.xMax, key: `cm_xmax_${cm.x}`, onChange: (v) => { cm.xMax = v; } }),
      selectField({ label: 'Eixo Y', value: cm.y, options: opts.filter(([k]) => k !== cm.x), onChange: (v) => { Object.assign(cm, { y: v, yMin: null, yMax: null }); ctx.rerender(); } }),
      numField({ label: `${Y.label} mín`, unit: Y.unit, value: cm.yMin, key: `cm_ymin_${cm.y}`, onChange: (v) => { cm.yMin = v; } }),
      numField({ label: `${Y.label} máx`, unit: Y.unit, value: cm.yMax, key: `cm_ymax_${cm.y}`, onChange: (v) => { cm.yMax = v; } }),
      selectField({ label: 'Resolução', value: String(cm.n), options: [['15', '15 × 15 (rápido)'], ['25', '25 × 25'], ['40', '40 × 40 (detalhado)']], onChange: (v) => { cm.n = Number(v); } })),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'primary', disabled: cm.running || null, onclick: run }, 'Calcular mapa'), progress),
    h('p', { class: 'muted', style: { margin: '8px 0 0' } }, `Cada ponto da grade monta a asa com os dois valores e as demais variáveis no valor de referência, e verifica interseção entre os contornos, folga real da fenda (mínimo de ${pkg.config.conventions.clearanceMin ?? 1} mm, em Convenções), cotas do SolidWorks e as regras do DOE. É geometria 2D do próprio app, sem ANSYS.`));

  const g = cm.grid;
  if (!g || g.xKey !== cm.x || g.yKey !== cm.y) return setup;
  return h('div', null, setup, conflictResult(pkg, ctx, g));
}

function conflictResult(pkg, ctx, g) {
  const cm = ctx.ui.cm, X = g.labels.x, Y = g.labels.y;
  const W = 640, H = 440, m = { l: 64, r: 16, t: 14, b: 50 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, nx = g.xs.length, ny = g.ys.length;
  const cw = pw / nx, ch = ph / ny;
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((c) => e.append(c)); return e; };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: 'max-width:760px;display:block' });
  g.cells.forEach((row, j) => row.forEach((c, i) => {
    const r = s('rect', { x: m.l + i * cw, y: m.t + (ny - 1 - j) * ch, width: cw + 0.5, height: ch + 0.5, fill: c ? CM_COLORS[c.status] : 'transparent', 'fill-opacity': c ? (c.status === 'ok' ? 0.55 : 0.8) : 0, style: 'cursor:pointer' });
    r.append(s('title', null, `${X.label} = ${fmt(g.xs[i], 3)} ${X.unit}, ${Y.label} = ${fmt(g.ys[j], 3)} ${Y.unit}\n${c ? CM_LABEL[c.status] : 'pendente'}${c?.clearance != null ? `\nfolga mínima: ${fmt(c.clearance, 2)} mm` : ''}${c?.msgs?.length ? `\n${c.msgs[0]}` : ''}`));
    r.addEventListener('click', () => { cm.sel = { i, j }; ctx.rerender(); });
    svg.append(r);
  }));
  // eixos
  const ax = 'var(--text-2, #999)';
  svg.append(s('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'none', stroke: ax, 'stroke-opacity': 0.5 }));
  for (let t = 0; t <= 4; t++) {
    const fx = t / 4, xv = g.xs[0] + (g.xs[nx - 1] - g.xs[0]) * fx, yv = g.ys[0] + (g.ys[ny - 1] - g.ys[0]) * fx;
    const px = m.l + cw / 2 + fx * (pw - cw), py = m.t + ph - ch / 2 - fx * (ph - ch);
    svg.append(s('text', { x: px, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: ax }, fmt(xv, 3)));
    svg.append(s('text', { x: m.l - 6, y: py + 4, 'text-anchor': 'end', 'font-size': 11, fill: ax }, fmt(yv, 3)));
  }
  svg.append(s('text', { x: m.l + pw / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 12, fill: ax }, `${X.label} [${X.unit}]`));
  svg.append(s('text', { x: 14, y: m.t + ph / 2, 'text-anchor': 'middle', 'font-size': 12, fill: ax, transform: `rotate(-90 14 ${m.t + ph / 2})` }, `${Y.label} [${Y.unit}]`));
  // posição de referência e ponto selecionado
  const toPx = (xv, yv) => [m.l + cw / 2 + ((xv - g.xs[0]) / (g.xs[nx - 1] - g.xs[0])) * (pw - cw), m.t + ph - ch / 2 - ((yv - g.ys[0]) / (g.ys[ny - 1] - g.ys[0])) * (ph - ch)];
  const rx = Number(g.base[g.xKey]), ry = Number(g.base[g.yKey]);
  const inRange = rx >= g.xs[0] && rx <= g.xs[nx - 1] && ry >= g.ys[0] && ry <= g.ys[ny - 1];
  if (inRange) { const [px, py] = toPx(rx, ry); svg.append(s('circle', { cx: px, cy: py, r: 6, fill: 'none', stroke: 'var(--text, #fff)', 'stroke-width': 2 }, s('title', null, 'valores de referência atuais'))); }
  if (cm.sel) { const { i, j } = cm.sel; svg.append(s('rect', { x: m.l + i * cw, y: m.t + (ny - 1 - j) * ch, width: cw, height: ch, fill: 'none', stroke: 'var(--text, #fff)', 'stroke-width': 2 })); }

  const cnt = summarize(g), total = nx * ny;
  const legend = h('div', { class: 'row', style: { marginTop: '8px' } }, ['ok', 'aviso', 'regra', 'erro'].map((k) => h('span', { class: 'row', style: { gap: '6px' } }, h('span', { style: { width: '14px', height: '14px', borderRadius: '3px', display: 'inline-block', background: CM_COLORS[k], opacity: k === 'ok' ? 0.7 : 0.9 } }), `${CM_LABEL[k]}: ${cnt[k]} (${fmt((100 * cnt[k]) / total, 0)} %)`)),
    inRange ? h('span', { class: 'muted' }, '○ = referência atual') : null);

  // faixas válidas na linha e na coluna mais próximas da referência
  const near = (arr, v) => arr.reduce((b, x, k) => (Math.abs(x - v) < Math.abs(arr[b] - v) ? k : b), 0);
  const fr = (runs, unit) => (runs.length ? runs.map((r) => (r.from === r.to ? `${fmt(r.from, 3)}` : `${fmt(r.from, 3)} a ${fmt(r.to, 3)}`)).join(' e ') + ` ${unit}` : 'nenhuma');
  const jRef = near(g.ys, ry), iRef = near(g.xs, rx);
  const rowSeq = g.xs.map((v, i) => ({ v, status: g.cells[jRef][i]?.status }));
  const colSeq = g.ys.map((v, j) => ({ v, status: g.cells[j][iRef]?.status }));
  const ranges = Number.isFinite(rx) && Number.isFinite(ry) ? h('div', { class: 'kv', style: { marginTop: '10px' } },
    h('dt', null, `${X.label} sem erro, com ${Y.label} = ${fmt(g.ys[jRef], 3)} ${Y.unit}`), h('dd', null, fr(validRuns(rowSeq), X.unit)),
    h('dt', null, `${Y.label} sem erro, com ${X.label} = ${fmt(g.xs[iRef], 3)} ${X.unit}`), h('dd', null, fr(validRuns(colSeq), Y.unit)),
    h('dt', null, '  … e também sem aviso'), h('dd', null, `${X.label}: ${fr(validRuns(rowSeq, ['ok']), X.unit)} · ${Y.label}: ${fr(validRuns(colSeq, ['ok']), Y.unit)}`)) : null;

  let detail = null;
  if (cm.sel) {
    const { i, j } = cm.sel, c = g.cells[j][i], xv = g.xs[i], yv = g.ys[j];
    detail = h('div', { class: 'el-card', style: { marginTop: '10px', marginBottom: 0 } },
      h('h3', null, `Ponto selecionado: ${X.label} = ${fmt(xv, 4)} ${X.unit}, ${Y.label} = ${fmt(yv, 4)} ${Y.unit}`),
      c ? h('div', null, badge(CM_LABEL[c.status], c.status === 'ok' ? 'ok' : c.status === 'aviso' ? 'warn' : 'err'), c.clearance != null ? h('span', { class: 'muted' }, ` folga mínima das fendas: ${fmt(c.clearance, 3)} mm`) : null,
        c.msgs.length ? msgs(c.msgs.slice(0, 6).map((msg) => ({ level: /^regra|folga|pivô/i.test(msg) ? 'aviso' : 'erro', msg }))) : null) : h('span', { class: 'muted' }, 'pendente'),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'small', onclick: async () => {
          if (!(await confirmBox('Usar como referência', `Gravar ${X.label} = ${fmt(xv, 4)} e ${Y.label} = ${fmt(yv, 4)} como valores de referência (_ref) do pacote?`, 'Gravar'))) return;
          store.update(() => { setRefFromKey(pkg, g.xKey, xv); setRefFromKey(pkg, g.yKey, yv); }, ['geometria', pkg.name, 'referência pelo mapa de conflito', `${X.label}=${xv}; ${Y.label}=${yv}`]);
          toast('Valores de referência atualizados. O mapa mostra os valores antigos até ser recalculado.');
        } }, 'Usar estes valores como referência'),
        h('button', { class: 'small', onclick: () => { ctx.ui.tab = 'montagem'; ctx.rerender(); } }, 'Ver a montagem')));
  }

  return card(`Mapa: ${X.label} × ${Y.label}`,
    svg, legend, ranges, detail,
    h('p', { class: 'muted', style: { margin: '8px 0 0' } }, `${total} pontos calculados em ${fmt((g.ms || 0) / 1000, 1)} s (${g.at.toLocaleTimeString('pt-BR')}). Clique numa célula para ver o motivo; passe o mouse para os valores. Se mudar a geometria, recalcule.`));
}

// ------------------------------------------------------------------ Aba Convenções
function conventionsTab(pkg) {
  const cv = pkg.config.conventions;
  const set = (k, v, label) => store.update(() => { cv[k] = v; }, ['geometria', pkg.name, `convenção ${label}`, String(v)]);
  return h('div', null,
    card('Convenções de montagem (explícitas e configuráveis)',
      h('div', { class: 'fields' },
        selectField({ label: 'Modo de montagem', value: cv.assemblyMode, options: [['sequencial', 'Sequencial: BA_(n+1) posicionado pelo BF_n (SolidWorks DS_)'], ['pivoFixo', 'Pivô fixo: monta com AoA = 0 e gira cada elemento no pivô']], onChange: (v) => set('assemblyMode', v, 'modo') }),
        selectField({ label: 'Origem', value: cv.anchor, options: [['pivo1', 'Pivô do elemento 1 na origem (DS_)'], ['ba1', 'BA do elemento 1 na origem']], onChange: (v) => set('anchor', v, 'origem') }),
        selectField({ label: 'Eixos de gap/overlap', value: cv.gapAxes, options: [['escoamento', 'Eixos do escoamento (horizontal/vertical, DS_)'], ['corda', 'Eixos da corda do elemento n (o de cima do par)']], onChange: (v) => set('gapAxes', v, 'eixos gap/overlap') }),
        selectField({ label: 'Gap/Overlap medidos a partir de', value: cv.gapPoint === 'ba' ? 'ba' : 'bf', options: [['bf', 'BF_n → BA_(n+1) (DS_)'], ['ba', 'BA_n → BA_(n+1): distância entre os bordos de ataque']], onChange: async (v) => {
          const keep = await confirmBox('Medir Gap/Overlap ' + (v === 'ba' ? 'entre os bordos de ataque' : 'a partir do BF'), 'Converter os valores de referência (Gap/Overlap _ref) para manter a geometria atual? Os níveis já digitados nas rodadas não são convertidos. Cancelar = só trocar a convenção (os mesmos números passam a ser medidos do novo ponto).', 'Converter');
          store.update(() => { setGapPoint(pkg, v, keep); }, ['geometria', pkg.name, 'convenção ponto de gap/overlap', `${v}${keep ? ' (valores _ref convertidos)' : ''}`]);
        } }),
        selectField({ label: 'Definição do gap', value: cv.gapDef, options: [['ponto', `Ponto a ponto: ${leToLe(cv) ? 'BA_n' : 'BF_n'} → BA_(n+1)${leToLe(cv) ? '' : ' (DS_)'}`], ['minimo', 'Folga mínima entre contornos (largura da fenda)'], ['tangente', `Vertical: ${leToLe(cv) ? 'BA_n' : 'BF_n'} → tangente horizontal ao extradorso do elemento n+1`], ['tangenteLivre', 'Vertical livre: ponto mais baixo do elemento n → tangente ao extradorso do elemento n+1 (Gap > 0 = sem interseção)']], onChange: (v) => set('gapDef', v, 'definição do gap') }),
        selectField({ label: 'Lado do pivot_off', value: cv.pivotSide, options: [['succao', 'Lado de sucção (DS_)'], ['pressao', 'Lado de pressão']], onChange: (v) => set('pivotSide', v, 'lado do pivô') }),
        selectField({ label: 'pivot_dTE medido', value: cv.pivotDTE, options: [['euclidiana', 'Distância pivô–BF (euclidiana, DS_)'], ['corda', 'Ao longo da corda a partir do BF']], onChange: (v) => set('pivotDTE', v, 'pivot_dTE') }),
        selectField({ label: 'Sinal do AoA', value: String(cv.aoaSign), options: [['1', '+ aumenta a sustentação (BF para cima na asa invertida, DS_)'], ['-1', '+ diminui a sustentação']], onChange: (v) => set('aoaSign', Number(v), 'sinal do AoA') }),
        selectField({ label: 'Corda de referência', value: cv.chordDef, options: [['geometrica', 'Geométrica: BA → extremo do BF arredondado (DS_chordN)'], ['classica', 'Clássica (antes do arredondamento)']], onChange: (v) => set('chordDef', v, 'corda') }),
        numField({ label: 'Folga mínima aceitável na fenda', unit: 'mm', value: cv.clearanceMin, key: 'clmin', onChange: (v) => set('clearanceMin', v ?? 1, 'folga mínima') }),
        h('div', { class: 'field' }, h('label', null, 'Regras de cotas do SolidWorks'), checkField({ label: 'Validar (sem cota 0/negativa, AoA ≥ 0, dTE > off)', checked: cv.swRules, onChange: (v) => set('swRules', v, 'regras SolidWorks') })))),
    card('Equações (referencial do perfil: x = escoamento, y = sustentação/sucção, mm)',
      mathBlock(`Pivô local (BA=(0,0), BF=(c,0)):
  s = √(pivot_dTE² − pivot_off²)   (euclidiana)   |   s = pivot_dTE   (ao longo da corda)
  P_local = (c − s, ±pivot_off)     (+ sucção, − pressão)

Rotação (AoA absoluto, θ = −σ·AoA):
  p' = T + R(θ)·(p − P_local),   R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]

Elemento 1:  T = 0 (pivô 1 na origem)  ou  T = R(θ)·P_local (BA 1 na origem)
Gap_n e Overlap_n: entre o elemento n e o elemento n+1 (ex.: Gap_1 = entre os elementos 1 e 2)
${leToLe(cv) ? `Elemento n+1 (sequencial, medido entre os BAs):  BA_(n+1) = BA_n + (+Overlap_n, −Gap_n)
  (eixos do escoamento; nos eixos da corda n o vetor é girado por θ_n)
  ⇒ Overlap > 0: BA_(n+1) a jusante do BA_n;  Gap > 0: BA_(n+1) do lado de pressão do BA_n
  (slat: BF_slat = BA_ref + (+Overlap, +Gap), sem mudança)` : `Elemento n+1 (sequencial):  BA_(n+1) = BF_n + (−Overlap_n, −Gap_n)
  (eixos do escoamento; nos eixos da corda n o vetor é girado por θ_n)
  ⇒ Overlap > 0: BA_(n+1) a montante do BF_n;  Gap > 0: BA_(n+1) do lado de pressão do BF_n`}
Pivô fixo: monta com AoA = 0 e depois gira cada elemento em torno do próprio pivô.
Gap como folga mínima: desloca BA_(n+1) na direção normal até min dist(contorno n, contorno n+1) = Gap_n (bissecção).
Gap pela tangente: Gap_n = y(BF_n) − max y(extradorso_(n+1))  (desloca o elemento n+1 só na vertical; o overlap não muda).
Gap pela tangente livre: Gap_n = min y(contorno_n sobre o elemento n+1) − max y(extradorso_(n+1))  (Gap > 0 ⇒ sem interseção).

Escalonamento do pivô no DOE:  pivot_off_n = pivot_off_ref_n/chord_ref_n · chord_n ;  pivot_dTE_n = pivot_dTE_ref_n/chord_ref_n · chord_n

CAD:  X = sx·x ,  Y = sy·y  (padrão sx = sy = −1)  →  plano ${pkg.config.transform.plane}`),
      h('p', { class: 'muted' }, 'Com os padrões, as posições de BA, BF e pivô conferem com o modelo SolidWorks de referência (teste automatizado: diferença < 0,001 mm).')));
}

export default function geometria(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, ui = ctx.ui;
  ui.tab = ui.tab || 'elementos';
  const w = wingOf(pkg);
  const tabs = [['elementos', 'Elementos e .dat'], ['bf', 'Bordo de fuga'], ['montagem', 'Montagem'], ['conflito', 'Mapa de conflito'], ['sugestoes', 'Sugestões'], ['convencoes', 'Convenções e equações']];
  let body;
  if (ui.tab === 'elementos') body = [generalCard(pkg), ...pkg.config.elements.map((_, i) => elementCard(pkg, i, w))];
  else if (ui.tab === 'bf') body = pkg.config.elements.map((_, i) => teCard(pkg, i, w));
  else if (ui.tab === 'montagem') body = [assemblyTab(pkg, w, ctx)];
  else if (ui.tab === 'sugestoes') body = [suggestTab(pkg, ctx)];
  else if (ui.tab === 'conflito') body = [conflictTab(pkg, ctx)];
  else body = [conventionsTab(pkg)];
  const errs = w.plane ? w.asm.checks.filter((c) => c.level === 'erro').length : w.errors.length;
  return h('div', null,
    pageHead(`Geometria — ${pkg.name}`, `${pkg.config.elements.length} elemento(s), ${pkg.config.mode}. Valores de referência (_ref) do pacote; os DPs variam a partir deles.`, errs ? badge(`${errs} erro(s)`, 'err') : badge('geometria OK', 'ok')),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: ui.tab === k ? 'on' : '', onclick: () => { ui.tab = k; ctx.rerender(); } }, l))),
    body);
}
void seg; void toast; void DEG; void rotate;
