// Relatório completo de uma rodada em Excel (.xlsx): resumo, entradas, saídas, relatório por
// Design Point e gráficos nativos do Excel (dispersão com linhas), sem dependências.

import { makeXlsx, XS } from './xlsx.js';
import { inputsTable, outputsTable } from './export.js';
import { doeVariables, derivedColumns } from './doe.js';
import { computeDP } from './outputs.js';
import { referenceValues, reportDefinitions, checkReports, parameterTable, forceVectors, DEFAULT_FLUENT } from './fluent.js';
import { buildWing, topologyOf, gurneyConfigured } from './wing.js';
import { computeDomain } from './domain.js';
import { describeTransform, directions } from './transform.js';
import { varyingInputs, gurneyOn } from './chartdata.js';

const PALETTE = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', 'E87BA4', '008300', '6250D6', 'E34948'];
const r6 = (v) => (Number.isFinite(v) ? Number(v.toPrecision(7)) : '');
const sec = (t) => [{ v: t, s: XS.section }, { v: '', s: XS.section }, { v: '', s: XS.section }, { v: '', s: XS.section }];
const hdr = (...cols) => cols.map((c) => ({ v: c, s: XS.header }));

function unitOf(key) {
  if (/^AoA/.test(key)) return '°';
  if (key === 'Uinf') return 'm/s';
  if (/^gurney_on/.test(key)) return '0/1';
  return 'mm';
}

/** Escolhe o eixo X e o agrupamento dos gráficos a partir das variáveis que variam na rodada. */
export function chartAxes(recs) {
  const vary = varyingInputs(recs).filter((k) => !/^pivot_/.test(k));
  const distinct = (k) => new Set(recs.map((r) => Number(r.inputs[k]))).size;
  const cand = vary.filter((k) => !/^gurney_on/.test(k)).sort((a, b) => distinct(b) - distinct(a));
  const x = cand[0] || null;
  const rest = vary.filter((k) => k !== x);
  const group = rest.find((k) => /^gurney_on/.test(k)) || (rest.length === 1 ? rest[0] : null);
  return { x, group, vary, mixed: rest.length > (group ? 1 : 0) };
}

function summarySheet(project, pkg, run, opts) {
  const c = pkg.config, f = { ...DEFAULT_FLUENT, ...c.fluent };
  const ref = referenceValues(pkg);
  const tp = topologyOf(pkg);
  const vec = forceVectors(pkg), dir = directions(c.transform);
  const w = buildWing(pkg);
  const rows = [];
  rows.push([{ v: `Relatório da rodada — ${run.name}`, s: XS.title }]);
  rows.push([{ v: 'Gerado pelo AERO MULT-MR ELEMENTS (Mauá Racing). Dados de entrada e resultados importados; coeficientes recalculados a partir dos dados brutos.', s: XS.note }]);
  if (run.dps.some((d) => d.outputs?.isExample)) rows.push([{ v: 'ATENÇÃO: esta rodada contém DADOS DE EXEMPLO (sintéticos). Não são resultados de CFD.', s: XS.warn }]);
  rows.push([]);
  const withRes = run.dps.filter((d) => d.outputs?.raw);
  rows.push(sec('Identificação'));
  [['Projeto', project.name], ['Pacote', pkg.name], ['Rodada', run.name], ['Gerado em', new Date().toLocaleString('pt-BR')], ['Status da rodada', run.status],
    ['Método do DOE', { fatorial: 'fatorial completo', oat: 'um fator por vez', manual: 'manual' }[run.doe?.method] || run.doe?.method], ['Níveis', Object.entries(run.doe?.levels || {}).filter(([, v]) => String(v).trim()).map(([k, v]) => `${k} = ${v}`).join(' | ') || '—'],
    ['Design Points', run.dps.length], ['DPs com resultado', withRes.length], ['Notas da rodada', run.notes || '—']].forEach(([k, v]) => rows.push([{ v: k, s: XS.header }, v]));
  rows.push([]);
  rows.push(sec('Valores de referência e escoamento'));
  rows.push(hdr('Grandeza', 'Valor', 'Unidade', 'Observação'));
  [['Uinf (Vel_ref)', f.Uinf, 'm/s', 'valor de referência; cada DP usa o seu Uinf'], ['Densidade ρ', f.rho, 'kg/m³', ''], ['Viscosidade μ', f.mu, 'kg/(m·s)', ''], ['Temperatura', f.T, 'K', ''],
    ['A_ref (referência)', r6(ref.Aref), 'm²', f.arefBasis === 'fixo' ? 'valor fixo' : 'Σ cordas × profundidade (por DP usa as cordas do DP)'], ['L_ref', r6(ref.Lref), 'm', f.lrefMode === 'principal' ? 'corda do elemento 1' : 'Σ cordas'],
    [c.mode === '3D' ? 'Envergadura' : 'Profundidade (2D)', c.mode === '3D' ? c.span_mm : f.depth, c.mode === '3D' ? 'mm' : 'm', ''],
    ['Vetor de sustentação', `(${vec.lift.join('; ')})`, '—', `positivo no sentido ${dir.liftLabel}`], ['Vetor de arrasto', `(${vec.drag.join('; ')})`, '—', `escoamento ${dir.flowLabel}`],
    ['Transformação', describeTransform(c.transform), '—', '']].forEach((r) => rows.push(r));
  rows.push([]);
  rows.push(sec('Elementos (valores de referência)'));
  rows.push(hdr('Elemento', 'Tipo', 'Ref.', 'Perfil', 'chord_ref [mm]', 'AoA_ref [°]', 'Gap_ref [mm]', 'Overlap_ref [mm]', 'pivot_off [mm]', 'pivot_dTE [mm]', 'Raio do BF', 'Gurney'));
  c.elements.forEach((e, i) => rows.push([i + 1, tp.kinds[i], tp.refs[i] != null ? tp.refs[i] + 1 : '—', e.profileName || '—', e.chord_ref, e.aoa_ref, tp.kinds[i] === 'principal' ? '—' : e.gap_ref, tp.kinds[i] === 'principal' ? '—' : e.overlap_ref, e.pivot_off_ref, e.pivot_dTE_ref,
    e.te?.enabled ? `${e.te.value} ${e.te.mode === 'mm' ? 'mm' : '% c'}` : 'agudo',
    gurneyConfigured(e) ? `${e.gurney.enabled ? 'ligado' : 'desligado na ref.'}: h=${e.gurney.h} mm (${r6((100 * e.gurney.h) / e.chord_ref)} % c), t=${e.gurney.t} mm, pos=${e.gurney.pos || 0} mm, lado ${e.gurney.side === 'succao' ? 'sucção' : 'pressão'}` : 'não']));
  rows.push([]);
  rows.push(sec('Convenções de montagem'));
  const cv = c.conventions;
  [['Modo', cv.assemblyMode === 'pivoFixo' ? 'pivô fixo' : 'sequencial (SolidWorks DS_)'], ['Gap/overlap', `${cv.gapDef === 'minimo' ? 'gap = folga mínima' : 'ponto a ponto'}, eixos ${cv.gapAxes === 'corda' ? 'da corda do ref' : 'do escoamento'}`],
    ['Flap', 'BA_flap = BF_ref + (−Overlap, −Gap)'], ['Slat', 'BF_slat = BA_ref + (+Overlap, +Gap)'], ['Pivô', `pivot_dTE ${cv.pivotDTE === 'corda' ? 'ao longo da corda' : 'euclidiano pivô–BF'}, lado ${cv.pivotSide === 'pressao' ? 'pressão' : 'sucção'}`],
    ['Corda', cv.chordDef === 'geometrica' ? 'geométrica (BA → extremo do BF arredondado)' : 'clássica'], ['Pivôs no DOE', run.doe?.pivotScaling !== false ? 'escalados com a corda' : 'fixos (valores de referência)']].forEach(([k, v]) => rows.push([{ v: k, s: XS.header }, v]));
  if (w.plane) {
    const dom = computeDomain(w.bbox, w.plane.map((e) => e.chord), c.domain, c.transform.sx);
    rows.push([]);
    rows.push(sec('Domínio (referência)'));
    [['C', r6(dom.C), 'mm'], ['Montante', r6(dom.dist.upstream), 'mm'], ['Jusante', r6(dom.dist.downstream), 'mm'], ['Acima', r6(dom.dist.above), 'mm'], [c.domain.groundEnabled ? 'Folga ao solo' : 'Abaixo', r6(dom.dist.below), 'mm'], ['Tamanho', `${r6(dom.length)} × ${r6(dom.height)}`, 'mm']].forEach(([k, v, u]) => rows.push([{ v: k, s: XS.header }, v, u]));
  }
  // melhores
  const comp = withRes.map((d) => ({ d, c: computeDP(d, pkg, opts) }));
  const best = (key, low) => comp.filter((x) => Number.isFinite(x.c[key])).sort((a, b) => (low ? a.c[key] - b.c[key] : b.c[key] - a.c[key]))[0];
  rows.push([]);
  rows.push(sec('Melhores Design Points'));
  rows.push(hdr('Critério', 'DP', 'Valor', 'Observação'));
  [['Maior Cl_total', 'Cl', false], ['Maior Cl/Cd', 'ClCd', false], ['Menor Cd_total', 'Cd', true], ['Maior Lift_force [N]', 'L', false]].forEach(([lab, k, low]) => { const b = best(k, low); rows.push([lab, b ? b.d.name : '—', b ? r6(b.c[k]) : '—', b?.d.outputs?.isExample ? 'dado de exemplo' : '']); });
  rows.push([]);
  rows.push(sec('Verificações'));
  const checks = [...(w.plane ? w.asm.checks.map((x) => `[${x.level}] ${x.msg}`) : w.errors.map((m) => `[erro] ${m}`)),
    ...checkReports(reportDefinitions(pkg), c.namedSelections || [], c.elements.length).map((x) => `[${x.level}] Relatórios: ${x.msg}`),
    ...comp.flatMap((x) => x.c.flags.map((m) => `[aviso] ${x.d.name}: ${m}`))];
  if (!checks.length) rows.push([{ v: 'Nenhum problema encontrado na geometria de referência, nos relatórios de força e nos totais.', s: XS.good }]);
  checks.slice(0, 200).forEach((m) => rows.push([{ v: m, s: /^\[erro\]/.test(m) ? XS.warn : 0 }]));
  rows.push([]);
  rows.push(sec('Abas deste arquivo'));
  [['Resumo', 'esta aba'], ['Entradas', 'Design Points com nomes do app (inclui pivôs derivados)'], ['Entradas DS_', 'mesma tabela com os nomes das cotas do SolidWorks'], ['Saidas', 'dados BRUTOS importados + coeficientes calculados (colunas separadas)'],
    ['Relatorio por DP', 'um bloco por simulação: entradas, saídas, coeficientes por elemento e verificações geométricas'], ['Graficos', 'dados dos gráficos e gráficos nativos do Excel'], ['Relatorios de forca', 'mapeamento relatório ↔ superfícies ↔ grandeza'], ['Parametros', 'tabela de parâmetros do Workbench'], ['Named Selections', 'lista de Named Selections e CCs']].forEach(([k, v]) => rows.push([{ v: k, s: XS.header }, v]));
  return { name: 'Resumo', rows, widths: [26, 22, 16, 22, 14, 12, 13, 15, 14, 14, 12, 60], freeze: false };
}

function perDpSheet(pkg, run, opts) {
  const tp = topologyOf(pkg);
  const vars = [...doeVariables(pkg), ...derivedColumns(pkg)].sort((a, b) => (a.element ?? 99) - (b.element ?? 99));
  const rows = [[{ v: `Relatório por Design Point — ${run.name}`, s: XS.title }], [{ v: 'Cada bloco é uma simulação (DP). Coeficientes: q = ½ρU², C = F/(q·A_ref); Cl/Cd só com Cd ≠ 0; totais nunca são médias.', s: XS.note }], []];
  run.dps.forEach((dp) => {
    const c = computeDP(dp, pkg, opts);
    const w = buildWing(pkg, dp.inputs);
    rows.push([{ v: `${dp.name}`, s: XS.section }, { v: dp.outputs?.isExample ? 'DADOS DE EXEMPLO (sintéticos)' : dp.outputs?.raw ? 'resultado importado' : 'sem resultado', s: XS.section }, { v: `status: ${dp.status}`, s: XS.section }, { v: gurneyOn(pkg, dp.inputs) ? 'com Gurney' : 'sem Gurney', s: XS.section }, { v: '', s: XS.section }, { v: '', s: XS.section }, { v: '', s: XS.section }, { v: '', s: XS.section }]);
    rows.push(hdr('Entrada', 'Valor', 'Unidade', 'Nota'));
    vars.forEach((v) => { const x = Number(dp.inputs[v.key]); if (Number.isFinite(x)) rows.push([v.label, r6(x), v.unit, v.derived ? 'derivado da corda' : v.note || '']); });
    if (c.has) {
      rows.push(hdr('Saída total', 'Valor', 'Unidade', 'Origem'));
      [['Lift_force', c.L, 'N'], ['Drag_force', c.D, 'N'], ['Cl_total', c.Cl, '—'], ['Cd_total', c.Cd, '—'], ['Cl/Cd', c.ClCd, '—'], ['q = ½ρU²', c.ref.q, 'Pa'], ['A_ref', c.ref.Aref, 'm²'], ['Uinf', c.ref.U, 'm/s']]
        .forEach(([k, v, u], j) => rows.push([k, r6(v), u, j < 2 ? 'bruto (Fluent)' : j < 5 ? 'calculado' : 'referência']));
      rows.push(hdr('Elemento', 'Tipo', 'Lift [N]', 'Drag [N]', 'Cl', 'Cd', 'Cl/Cd', '% do Lift'));
      c.perEl.forEach((e, i) => rows.push([i + 1, tp.kinds[i], r6(e.L), r6(e.D), r6(e.Cl), r6(e.Cd), r6(e.ClCd), e.share == null ? '' : r6(100 * e.share)]));
      c.flags.forEach((m) => rows.push([{ v: `Aviso: ${m}`, s: XS.warn }]));
    } else rows.push([{ v: 'Sem resultados importados para este DP.', s: XS.note }]);
    if (w.plane) {
      rows.push(hdr('Geometria', 'Valor', 'Unidade', 'Nota'));
      w.asm.slots.forEach((s) => rows.push([`Folga real da fenda ${s.pair[0]}–${s.pair[1]}${s.kind === 'slat' ? ' (slat)' : ''}`, r6(s.clearance), 'mm', s.clearance === 0 ? 'INTERSEÇÃO' : '']));
      w.asm.elements.forEach((e, i) => { if (e.gurney) rows.push([`Gurney do elemento ${i + 1}: sobressai`, r6(e.gurney.effective), 'mm', `h = ${r6(e.gurney.hPct)} % da corda`]); });
      w.asm.checks.forEach((x) => rows.push([{ v: `${x.level === 'erro' ? 'ERRO' : 'Aviso'}: ${x.msg}`, s: x.level === 'erro' ? XS.warn : 0 }]));
      if (!w.asm.checks.length) rows.push([{ v: 'Geometria sem interseções e com cotas válidas.', s: XS.good }]);
    } else rows.push([{ v: `Geometria não montada: ${w.errors.join(' ')}`, s: XS.warn }]);
    rows.push([]);
  });
  return { name: 'Relatorio por DP', rows, widths: [34, 18, 12, 18, 12, 12, 12, 12], freeze: false };
}

function chartsSheet(pkg, run, opts) {
  const n = pkg.config.elements.length;
  const recs = run.dps.map((dp, i) => ({ dp, idx: i, inputs: dp.inputs, c: computeDP(dp, pkg, opts) })).filter((r) => r.c.has);
  const name = 'Graficos';
  if (!recs.length) return { name, rows: [[{ v: 'Gráficos', s: XS.title }], [{ v: 'Sem resultados importados nesta rodada: nenhum gráfico gerado.', s: XS.note }]], freeze: false };
  const ax = chartAxes(recs);
  const xKey = ax.x, gKey = ax.group;
  const xLab = xKey ? `${xKey} [${unitOf(xKey)}]` : 'nº do DP';
  const xv = (r) => (xKey ? Number(r.inputs[xKey]) : r.idx);
  const gv = (r) => (gKey ? Number(r.inputs[gKey]) : 0);
  const gName = (g) => (!gKey ? 'todos os DPs' : /^gurney_on/.test(gKey) ? (g >= 0.5 ? 'com Gurney' : 'sem Gurney') : `${gKey} = ${g}`);
  recs.sort((a, b) => gv(a) - gv(b) || xv(a) - xv(b));
  const headers = ['DP', 'nº', xLab, gKey ? `grupo (${gKey})` : 'grupo', 'Lift_force [N]', 'Drag_force [N]', 'Cl_total', 'Cd_total', 'Cl/Cd', ...Array.from({ length: n }, (_, i) => `Cl_el${i + 1}`), ...Array.from({ length: n }, (_, i) => `Cd_el${i + 1}`), 'exemplo?'];
  const rows = recs.map((r) => [r.dp.name, r.idx, r6(xv(r)), gName(gv(r)), r6(r.c.L), r6(r.c.D), r6(r.c.Cl), r6(r.c.Cd), r6(r.c.ClCd), ...r.c.perEl.map((e) => r6(e.Cl)), ...r.c.perEl.map((e) => r6(e.Cd)), r.dp.outputs?.isExample ? 'SIM (sintético)' : 'não']);
  // faixas por grupo (linhas 1..N da planilha, pois a linha 0 é o cabeçalho)
  const groups = [];
  recs.forEach((r, i) => { const g = gName(gv(r)); if (!groups.length || groups[groups.length - 1].name !== g) groups.push({ name: g, r0: i + 1, r1: i + 1 }); else groups[groups.length - 1].r1 = i + 1; });
  const col = { x: 2, L: 4, D: 5, Cl: 6, Cd: 7, ClCd: 8, idx: 1 };
  const colVals = (cIdx, g) => rows.slice(g.r0 - 1, g.r1).map((row) => (row[cIdx] === '' ? NaN : Number(row[cIdx])));
  const grouped = (yCol) => groups.map((g, k) => ({ name: g.name, color: PALETTE[k % 8], x: [col.x, g.r0, g.r1], y: [yCol, g.r0, g.r1], xs: colVals(col.x, g), ys: colVals(yCol, g) }));
  const anchorCol = headers.length + 1;
  const charts = [];
  const add = (ch) => { const k = charts.length; ch.anchor = { col: anchorCol + (k % 2) * 9, row: Math.floor(k / 2) * 20, cols: 9, rows: 19 }; charts.push(ch); };
  const ex = recs.some((r) => r.dp.outputs?.isExample) ? ' — DADOS DE EXEMPLO' : '';
  add({ title: `Cl_total × ${xKey || 'DP'}${ex}`, xTitle: xLab, yTitle: 'Cl_total', series: grouped(col.Cl) });
  add({ title: `Cd_total × ${xKey || 'DP'}${ex}`, xTitle: xLab, yTitle: 'Cd_total', series: grouped(col.Cd) });
  add({ title: `Cl/Cd × ${xKey || 'DP'}${ex}`, xTitle: xLab, yTitle: 'Cl/Cd', series: grouped(col.ClCd) });
  add({ title: `Lift_force × ${xKey || 'DP'}${ex}`, xTitle: xLab, yTitle: 'Lift_force [N]', series: grouped(col.L) });
  add({ title: `Drag_force × ${xKey || 'DP'}${ex}`, xTitle: xLab, yTitle: 'Drag_force [N]', series: grouped(col.D) });
  add({ title: `Polar Cl × Cd${ex}`, xTitle: 'Cd_total', yTitle: 'Cl_total', lines: false, series: groups.map((g, k) => ({ name: g.name, color: PALETTE[k % 8], x: [col.Cd, g.r0, g.r1], y: [col.Cl, g.r0, g.r1], xs: colVals(col.Cd, g), ys: colVals(col.Cl, g) })) });
  const all = { r0: 1, r1: rows.length };
  add({ title: `Cl por elemento × nº do DP${ex}`, xTitle: 'nº do DP', yTitle: 'Cl do elemento', lines: false, series: Array.from({ length: n }, (_, i) => ({ name: `elemento ${i + 1} (${topologyOf(pkg).kinds[i]})`, color: PALETTE[i % 8], x: [col.idx, all.r0, all.r1], y: [9 + i, all.r0, all.r1], xs: colVals(col.idx, all), ys: colVals(9 + i, all) })) });
  const note = ax.mixed ? `Atenção: além de ${xKey}${gKey ? ` e ${gKey}` : ''}, também variam ${ax.vary.filter((k) => k !== xKey && k !== gKey).join(', ')} — as curvas misturam condições.` : '';
  if (note) rows.push([], [{ v: note, s: XS.warn }]);
  return { name, headers, rows, charts };
}

/** Planilhas do relatório completo de uma rodada. */
export function runReportSheets(project, pkg, run, opts = run.outputOpts || {}) {
  const keys = (() => { const lv = run.doe?.levels || {}; const v = doeVariables(pkg).filter((x) => String(lv[x.key] || '').trim()).map((x) => x.key); return [...v, 'Uinf']; })();
  return [
    summarySheet(project, pkg, run, opts),
    { name: 'Entradas', ...inputsTable(project, pkg, run) },
    { name: 'Entradas DS_', ...inputsTable(project, pkg, run, { withDS: true }) },
    { name: 'Saidas', ...outputsTable(project, pkg, run, opts) },
    perDpSheet(pkg, run, opts),
    chartsSheet(pkg, run, opts),
    { name: 'Relatorios de forca', headers: ['relatório', 'grandeza', 'vetor', 'superfícies', 'campo', 'unidade'], rows: reportDefinitions(pkg).map((r) => [r.name, r.quantity, `(${r.vector.join('; ')})`, r.surfaces.join(' + '), r.field, r.unit]) },
    { name: 'Parametros', headers: ['P', 'nome', 'chave', 'tipo', 'unidade', 'origem', 'nota'], rows: parameterTable(pkg, keys).map((p) => [p.param, p.name, p.appKey, p.kind, p.unit, p.source, p.note]) },
    { name: 'Named Selections', headers: ['nome', 'tipo', 'entidades', 'descrição', 'CC', 'notas'], rows: (pkg.config.namedSelections || []).map((s) => [s.name, s.type, s.entities, s.description, s.bc, s.notes]) },
  ];
}

export const runReportXlsx = (project, pkg, run, opts) => makeXlsx(runReportSheets(project, pkg, run, opts));
