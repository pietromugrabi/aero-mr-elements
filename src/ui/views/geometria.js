import { h, card, numField, textField, selectField, checkField, msgs, badge, fv, table, pickFile, toast, confirmBox, seg } from '../dom.js';
import * as store from '../store.js';
import { wingOf, needs, swatch, pageHead } from '../common.js';
import { geomPlot } from '../plots.js';
import { setElementCount, syncDependentLists, addSlat } from '../../core/model.js';
import { resolveTopology } from '../../core/assembly.js';
import { pairOf, gurneyConfigured } from '../../core/wing.js';
import { applyReferenceStudy } from '../../core/demo.js';
import { S1223_DAT, NACA23012_DAT } from '../../core/samples-data.js';
import { describeTransform, directions, planeAxes, toPlane } from '../../core/transform.js';
import { pivotLocal } from '../../core/pivots.js';
import { DEG, rotate } from '../../core/geom.js';
import { fmt } from '../../core/num.js';

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
    h('div', { class: 'eq', style: { marginTop: '10px' } }, `${describeTransform(t)}\nEscoamento no sentido ${d.flowLabel} · sustentação positiva no sentido ${d.liftLabel}${t.sy < 0 ? ' (downforce para asa invertida)' : ''}\nA escala pela corda é aplicada uma única vez (o .dat é sempre normalizado antes).`),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { onclick: async () => { if (await confirmBox('Preencher com o estudo de referência', 'Substitui perfis e cotas de referência dos 3 primeiros elementos pelos valores do estudo de referência (S1223, 140/90/60 mm, 3/18/33°...). Continuar?', 'Preencher')) store.update(() => { if (c.elements.length < 3) setElementCount(c, 3); applyReferenceStudy(pkg, S1223_DAT, 'S1223', { gurneyOn: c.elements.some((e) => e.gurney?.enabled) }); }, ['geometria', pkg.name, 'preenchido com estudo de referência']); } }, 'Preencher com valores do estudo de referência'),
      h('small', { class: 'muted' }, 'Valores de exemplo (cotas DS_ do modelo de referência).'),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => store.update(() => { addSlat(c); }, ['geometria', pkg.name, 'slat adicionado', 'sem valores de referência']) }, '+ Adicionar slat')),
    h('p', { class: 'muted', style: { margin: '8px 0 0' } }, 'Slat = elemento a montante do elemento de referência (padrão: o principal). O app não preenche valores para o slat: informe corda, AoA, gap, overlap, pivô e .dat.'));
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

function elementCard(pkg, i, w) {
  const el = pkg.config.elements[i], n = i + 1, proc = w.procs?.[i];
  const tp = resolveTopology(pkg.config.elements), kind = tp.kinds[i];
  const pr = pairOf(pkg, n);
  const loadDat = (text, name) => store.update(() => { el.datText = text; el.datFileName = name; if (!el.profileName) el.profileName = name.replace(/\.\w+$/, ''); }, ['geometria', `${pkg.name} / elemento ${n}`, '.dat importado', name]);
  const piv = Number(el.chord_ref) > 0 && Number(el.pivot_dTE_ref) > 0 ? pivotLocal(Number(el.chord_ref), Number(el.pivot_off_ref), Number(el.pivot_dTE_ref), pkg.config.conventions) : null;
  const refOpts = pkg.config.elements.map((_, j) => [String(j), `Elemento ${j + 1} (${tp.kinds[j]})`]).filter(([j]) => Number(j) !== i);
  const gapHint = pr ? (pr.kind === 'slat'
    ? `BF do slat → BA do elemento ${pr.b}: Gap > 0 = lado de sucção (DS_gap${pr.a}${pr.b})`
    : `BF do elemento ${pr.a} → BA deste: Gap > 0 = lado de pressão (DS_gap${pr.a}${pr.b})`) : '';
  const ovHint = pr ? (pr.kind === 'slat'
    ? `Overlap > 0 = BF do slat a jusante do BA do ref (DS_overlap${pr.a}${pr.b})`
    : `Overlap > 0 = BA a montante do BF do ref (DS_overlap${pr.a}${pr.b})`) : '';
  return h('div', { class: 'el-card' },
    h('h3', null, swatch(i), `Elemento ${n}`, ' ', badge(kind, kind === 'slat' ? 'info' : kind === 'principal' ? 'ok' : ''), el.profileName ? h('span', { class: 'muted' }, ` — ${el.profileName}`) : null,
      kind === 'slat' ? h('span', { style: { marginLeft: 'auto' } }, h('button', { class: 'small danger', onclick: async () => { if (await confirmBox('Remover slat', `Remover o elemento ${n} (slat)? Elementos que o usam como referência passam a usar o principal.`, 'Remover', true)) store.update(() => { pkg.config.elements.splice(i, 1); pkg.config.elements.forEach((e) => { if (Number.isInteger(e.ref)) e.ref = e.ref === i ? null : e.ref > i ? e.ref - 1 : e.ref; }); pkg.config.nElements = pkg.config.elements.length; syncDependentLists(pkg.config); }, ['geometria', pkg.name, `slat (elemento ${n}) removido`]); } }, 'Remover slat')) : null),
    h('div', { class: 'fields' },
      selectField({ label: 'Tipo de elemento', value: kind, options: [['principal', 'Principal (ancorado)'], ['flap', 'Flap (a jusante do ref)'], ['slat', 'Slat (a montante do ref)']], onChange: (v) => store.update(() => { if (v === 'principal') pkg.config.elements.forEach((e, j) => { if (j !== i && e.type === 'principal') e.type = 'flap'; }); el.type = v; el.ref = null; syncDependentLists(pkg.config); }, ['geometria', `${pkg.name} / elemento ${n}`, 'tipo', v]) }),
      kind !== 'principal' ? selectField({ label: 'Posicionado em relação a', value: String(tp.refs[i]), options: refOpts, onChange: (v) => setEl(pkg, i, 'ref', Number(v), 'referência') }) : null,
      textField({ label: 'Nome do perfil', value: el.profileName, key: `pn${i}`, onChange: (v) => setEl(pkg, i, 'profileName', v, 'nome do perfil') }),
      selectField({ label: 'Coordenadas do .dat', value: el.inputMode, options: [['normalizado', 'Normalizadas (x/c)'], ['físico', 'Físicas (mm)']], onChange: (v) => setEl(pkg, i, 'inputMode', v, 'modo de entrada') }),
      numField({ label: `chord_ref_${n}`, unit: 'mm', value: el.chord_ref, required: true, key: `c${i}`, onChange: (v) => setEl(pkg, i, 'chord_ref', v, `chord_ref_${n}`), hint: el.inputMode === 'físico' && proc?.normalized ? `corda no arquivo: ${fv(proc.normalized.fileChord, 5)} mm` : null }),
      numField({ label: `AoA_ref_${n}`, unit: '°', value: el.aoa_ref, required: true, key: `a${i}`, onChange: (v) => setEl(pkg, i, 'aoa_ref', v, `AoA_ref_${n}`), hint: 'absoluto, em relação ao escoamento' }),
      pr ? numField({ label: `Gap_ref_${n}`, unit: 'mm', value: el.gap_ref, required: true, key: `g${i}`, onChange: (v) => setEl(pkg, i, 'gap_ref', v, `Gap_ref_${n}`), hint: gapHint }) : null,
      pr ? numField({ label: `Overlap_ref_${n}`, unit: 'mm', value: el.overlap_ref, required: true, key: `o${i}`, onChange: (v) => setEl(pkg, i, 'overlap_ref', v, `Overlap_ref_${n}`), hint: ovHint }) : null,
      numField({ label: `pivot_off_ref_${n}`, unit: 'mm', value: el.pivot_off_ref, required: true, key: `po${i}`, onChange: (v) => setEl(pkg, i, 'pivot_off_ref', v, `pivot_off_ref_${n}`), hint: 'distância perpendicular à corda' }),
      numField({ label: `pivot_dTE_ref_${n}`, unit: 'mm', value: el.pivot_dTE_ref, required: true, key: `pd${i}`, onChange: (v) => setEl(pkg, i, 'pivot_dTE_ref', v, `pivot_dTE_ref_${n}`), hint: piv?.ok ? `pivô a ${fmt(100 * piv.fractionFromLE, 1)} % da corda a partir do BA` : piv ? piv.error : 'distância pivô–BF' }),
    ),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { onclick: async () => { const f = await pickFile('.dat,.txt,.csv'); if (f) loadDat(f.text, f.name); } }, 'Carregar .dat…'),
      h('button', { class: 'small', onclick: () => loadDat(S1223_DAT, 'S1223.dat') }, 'Amostra S1223'),
      h('button', { class: 'small', onclick: () => loadDat(NACA23012_DAT, 'NACA23012.dat') }, 'Amostra NACA 23012'),
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
  const t = pkg.config.transform, d = directions(t);
  return {
    elements: w.plane.map((e, i) => ({ ...e, label: `Elemento ${i + 1}${e.kind !== 'flap' ? ` (${e.kind})` : ''}` })), slots: w.asm.slots.map((s) => ({ ...s, from: toPlane(s.from, t), to: toPlane(s.to, t), pa: s.pa && toPlane(s.pa, t), pb: s.pb && toPlane(s.pb, t) })),
    flow: [t.sx, 0], lift: [0, t.sy], liftLabel: t.sy < 0 ? `sustentação (${d.liftLabel}, downforce)` : `sustentação (${d.liftLabel})`, axes: planeAxes(t.plane),
  };
}

function measurements(pkg, w) {
  const t = pkg.config.transform;
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
      { label: 'Gap escoam.', unit: 'mm', num: true, get: (s) => fmt(s.gapFlow, 3) }, { label: 'Overlap escoam.', unit: 'mm', num: true, get: (s) => fmt(s.overlapFlow, 3) },
      { label: 'Gap eixos do ref', unit: 'mm', num: true, get: (s) => fmt(s.gapChord, 3) }, { label: 'Overlap eixos do ref', unit: 'mm', num: true, get: (s) => fmt(s.overlapChord, 3) },
      { label: 'Folga real', unit: 'mm', num: true, get: (s) => (s.clearance === 0 ? badge('INTERSEÇÃO', 'err') : fmt(s.clearance, 3)) },
    ], w.asm.slots)) : null,
    h('h3', null, 'Verificações'),
    w.asm.checks.length ? msgs(w.asm.checks) : msgs([{ level: 'ok', msg: 'Sem interseções, pivôs dentro dos perfis e cotas válidas para o SolidWorks.' }]),
    h('p', { class: 'muted' }, `Coordenadas no plano ${t.plane} do CAD. Vista: roda do mouse = zoom, arrastar = mover. Linha vermelha = folga mínima da fenda.`));
}

function liveControls(pkg, plotBox, measBox, plot) {
  const c = pkg.config;
  const rows = c.elements.map((el, i) => {
    const n = i + 1;
    const mk = (field, label, min, max, step, unit) => {
      const v = Number(el[field]);
      if (!Number.isFinite(v)) return null;
      const out = h('span', { class: 'tnum', style: { width: '84px', display: 'inline-block', textAlign: 'right' } }, `${fmt(v, 2)} ${unit}`);
      const r = h('input', { type: 'range', min, max, step, value: v, style: { flex: 1 } });
      r.addEventListener('input', () => {
        const nv = Number(r.value);
        store.update(() => { el[field] = nv; }, null, { silent: true });
        out.textContent = `${fmt(nv, 2)} ${unit}`;
        const w = wingOf(pkg);
        if (w.plane) { plot.redraw(); measBox.replaceChildren(measurements(pkg, w)); }
      });
      r.addEventListener('change', () => store.update(() => { }, ['geometria', `${pkg.name} / elemento ${n}`, `${label} (controle deslizante)`, r.value]));
      return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { style: { width: '90px' } }, label), r, out);
    };
    return h('div', { class: 'el-card' }, h('h3', null, swatch(i), `Elemento ${n}`),
      mk('aoa_ref', `AoA_${n}`, -45, 60, 0.5, '°'),
      pairOf(pkg, n) ? mk('gap_ref', `Gap_${n}`, 0.1, 25, 0.1, 'mm') : null,
      pairOf(pkg, n) ? mk('overlap_ref', `Overlap_${n}`, 0.1, 20, 0.1, 'mm') : null,
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
    h('div', { class: 'grid g-side' }, card('Ajuste ao vivo', liveControls(pkg, null, meas, plot)), card('Medições e verificações', meas)));
}

// ------------------------------------------------------------------ Aba Convenções
function conventionsTab(pkg) {
  const cv = pkg.config.conventions;
  const set = (k, v, label) => store.update(() => { cv[k] = v; }, ['geometria', pkg.name, `convenção ${label}`, String(v)]);
  return h('div', null,
    card('Convenções de montagem (explícitas e configuráveis)',
      h('div', { class: 'fields' },
        selectField({ label: 'Modo de montagem', value: cv.assemblyMode, options: [['sequencial', 'Sequencial: BA_n posicionado pelo BF_(n−1) (SolidWorks DS_)'], ['pivoFixo', 'Pivô fixo: monta com AoA = 0 e gira cada elemento no pivô']], onChange: (v) => set('assemblyMode', v, 'modo') }),
        selectField({ label: 'Origem', value: cv.anchor, options: [['pivo1', 'Pivô do elemento 1 na origem (DS_)'], ['ba1', 'BA do elemento 1 na origem']], onChange: (v) => set('anchor', v, 'origem') }),
        selectField({ label: 'Eixos de gap/overlap', value: cv.gapAxes, options: [['escoamento', 'Eixos do escoamento (horizontal/vertical, DS_)'], ['corda', 'Eixos da corda do elemento n−1']], onChange: (v) => set('gapAxes', v, 'eixos gap/overlap') }),
        selectField({ label: 'Definição do gap', value: cv.gapDef, options: [['ponto', 'Ponto a ponto: BF_(n−1) → BA_n (DS_)'], ['minimo', 'Folga mínima entre contornos (largura da fenda)']], onChange: (v) => set('gapDef', v, 'definição do gap') }),
        selectField({ label: 'Lado do pivot_off', value: cv.pivotSide, options: [['succao', 'Lado de sucção (DS_)'], ['pressao', 'Lado de pressão']], onChange: (v) => set('pivotSide', v, 'lado do pivô') }),
        selectField({ label: 'pivot_dTE medido', value: cv.pivotDTE, options: [['euclidiana', 'Distância pivô–BF (euclidiana, DS_)'], ['corda', 'Ao longo da corda a partir do BF']], onChange: (v) => set('pivotDTE', v, 'pivot_dTE') }),
        selectField({ label: 'Sinal do AoA', value: String(cv.aoaSign), options: [['1', '+ aumenta a sustentação (BF para cima na asa invertida, DS_)'], ['-1', '+ diminui a sustentação']], onChange: (v) => set('aoaSign', Number(v), 'sinal do AoA') }),
        selectField({ label: 'Corda de referência', value: cv.chordDef, options: [['geometrica', 'Geométrica: BA → extremo do BF arredondado (DS_chordN)'], ['classica', 'Clássica (antes do arredondamento)']], onChange: (v) => set('chordDef', v, 'corda') }),
        numField({ label: 'Folga mínima aceitável na fenda', unit: 'mm', value: cv.clearanceMin, key: 'clmin', onChange: (v) => set('clearanceMin', v ?? 1, 'folga mínima') }),
        h('div', { class: 'field' }, h('label', null, 'Regras de cotas do SolidWorks'), checkField({ label: 'Validar (sem cota 0/negativa, AoA ≥ 0, dTE > off)', checked: cv.swRules, onChange: (v) => set('swRules', v, 'regras SolidWorks') })))),
    card('Equações (referencial do perfil: x = escoamento, y = sustentação/sucção, mm)',
      h('div', { class: 'eq' }, `Pivô local (BA=(0,0), BF=(c,0)):
  s = √(pivot_dTE² − pivot_off²)   (euclidiana)   |   s = pivot_dTE   (ao longo da corda)
  P_local = (c − s, ±pivot_off)     (+ sucção, − pressão)

Rotação (AoA absoluto, θ = −σ·AoA):
  p' = T + R(θ)·(p − P_local),   R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]

Elemento 1:  T = 0 (pivô 1 na origem)  ou  T = R(θ)·P_local (BA 1 na origem)
Elemento n ≥ 2 (sequencial):  BA_n = BF_(n−1) + (−Overlap_n, −Gap_n)
  (eixos do escoamento; nos eixos da corda n−1 o vetor é girado por θ_(n−1))
  ⇒ Overlap > 0: BA_n a montante do BF_(n−1);  Gap > 0: BA_n do lado de pressão do BF_(n−1)
Pivô fixo: monta com AoA = 0 e depois gira cada elemento em torno do próprio pivô.
Gap como folga mínima: desloca BA_n na direção normal até min dist(contorno n−1, contorno n) = Gap_n (bissecção).

Escalonamento do pivô no DOE:  pivot_off_n = pivot_off_ref_n/chord_ref_n · chord_n ;  pivot_dTE_n = pivot_dTE_ref_n/chord_ref_n · chord_n

CAD:  X = sx·x ,  Y = sy·y  (padrão sx = sy = −1)  →  plano ${pkg.config.transform.plane}`),
      h('p', { class: 'muted' }, 'Com os padrões, as posições de BA, BF e pivô conferem com o modelo SolidWorks de referência (teste automatizado: diferença < 0,001 mm).')));
}

export default function geometria(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, ui = ctx.ui;
  ui.tab = ui.tab || 'elementos';
  const w = wingOf(pkg);
  const tabs = [['elementos', 'Elementos e .dat'], ['bf', 'Bordo de fuga'], ['montagem', 'Montagem'], ['convencoes', 'Convenções e equações']];
  let body;
  if (ui.tab === 'elementos') body = [generalCard(pkg), ...pkg.config.elements.map((_, i) => elementCard(pkg, i, w))];
  else if (ui.tab === 'bf') body = pkg.config.elements.map((_, i) => teCard(pkg, i, w));
  else if (ui.tab === 'montagem') body = [assemblyTab(pkg, w, ctx)];
  else body = [conventionsTab(pkg)];
  const errs = w.plane ? w.asm.checks.filter((c) => c.level === 'erro').length : w.errors.length;
  return h('div', null,
    pageHead(`Geometria — ${pkg.name}`, `${pkg.config.elements.length} elemento(s), ${pkg.config.mode}. Valores de referência (_ref) do pacote; os DPs variam a partir deles.`, errs ? badge(`${errs} erro(s)`, 'err') : badge('geometria OK', 'ok')),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: ui.tab === k ? 'on' : '', onclick: () => { ui.tab = k; ctx.rerender(); } }, l))),
    body);
}
void seg; void toast; void DEG; void rotate;
