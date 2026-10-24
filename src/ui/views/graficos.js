import { h, card, msgs, badge, checkField, selectField, promptBox, download, safeName, fv, exampleBanner, table } from '../dom.js';
import * as store from '../store.js';
import { needs, pageHead } from '../common.js';
import { xyChart, barChart, heatmapChart } from '../plots.js';
import { collectRecords, filterRecords, buildSeries, heatmapGrid, fitResponseSurface, ranking, valueOf, refWarnings, varyingInputs } from '../../core/chartdata.js';
import { metricList } from '../../core/outputs.js';
import { toCSV } from '../../core/csv.js';
import { parseNum } from '../../core/num.js';
import { uid, clone } from '../../core/model.js';

const TYPES = [['xy', 'Curvas XY'], ['scatter', 'Dispersão'], ['heatmap', 'Mapa de calor'], ['surface', 'Superfície de resposta'], ['ranking', 'Ranking'], ['matrix', 'Matriz de comparação']];

function defaults() { return { type: 'xy', x: null, ys: ['Cl'], groupBy: '', perElement: false, includeTotal: true, z: 'Cl', y2: null, metric: 'Cl', desc: true, filters: { packages: [], runs: [], ranges: {} } }; }

function varsOf(recs, project) {
  const keys = new Set();
  (project.packages || []).forEach((k) => k.runs.forEach((r) => r.dps.forEach((d) => Object.keys(d.inputs || {}).forEach((x) => { if (!/^pivot_/.test(x)) keys.add(x); }))));
  const order = (k) => { const m = k.match(/_(\d+)$/); return (m ? Number(m[1]) * 10 : 900) + ['chord', 'AoA', 'Gap', 'Overlap', 'gurney_h', 'gurney_t'].findIndex((p) => k.startsWith(p)); };
  return [...keys].sort((a, b) => order(a) - order(b));
}

const unitOf = (k, mets) => { const m = mets.find((x) => x.key === k); if (m) return m.unit === '—' ? '' : ` [${m.unit}]`; if (/^AoA/.test(k)) return ' [°]'; if (k === 'Uinf') return ' [m/s]'; return k ? ' [mm]' : ''; };
const labelOf = (k, mets) => (mets.find((x) => x.key === k)?.label || k) + unitOf(k, mets);

function preset(cfg, name, vars, recs) {
  const vary = varyingInputs(recs);
  const firstVar = (re) => vary.find((v) => re.test(v)) || vars.find((v) => re.test(v));
  const aoa = firstVar(/^AoA_/);
  const p = {
    'Lift/Drag × AoA': { type: 'xy', x: aoa, ys: ['L', 'D'], perElement: false },
    'Lift/Drag × Uinf': { type: 'xy', x: 'Uinf', ys: ['L', 'D'], perElement: false },
    'Cl/Cd × AoA': { type: 'xy', x: aoa, ys: ['ClCd'], perElement: false },
    'Curvas por elemento': { type: 'xy', x: aoa, ys: ['Cl'], perElement: true },
    'Estudo de gap': { type: 'xy', x: firstVar(/^Gap_/), ys: ['Cl', 'ClCd'], groupBy: firstVar(/^Overlap_/) || '' },
    'Estudo de overlap': { type: 'xy', x: firstVar(/^Overlap_/), ys: ['Cl', 'ClCd'], groupBy: firstVar(/^Gap_/) || '' },
    'Estudo de corda': { type: 'xy', x: firstVar(/^chord_/), ys: ['Cl', 'L'] },
    'Gurney × sem Gurney': { type: 'xy', x: aoa, ys: ['Cl', 'Cd'], groupBy: 'gurney' },
    'Polar (Cl × Cd)': { type: 'scatter', x: 'Cd', ys: ['Cl'], groupBy: 'rodada' },
  }[name];
  Object.assign(cfg, { groupBy: '', perElement: false }, p);
  // Se exatamente uma outra variável varia nos dados filtrados, agrupa por ela (evita misturar condições).
  if (!cfg.groupBy && cfg.type === 'xy') {
    const others = varyingInputs(recs, [cfg.x]);
    if (others.length === 1) cfg.groupBy = others[0];
  }
}

export default function graficos(ctx) {
  const miss = needs(['project'], ctx); if (miss) return miss;
  const prj = ctx.project, ui = ctx.ui;
  ui.cfg = ui.cfg || defaults();
  const cfg = ui.cfg;
  const nMax = Math.max(1, ...prj.packages.map((k) => k.config.elements.length));
  const mets = metricList(nMax);
  const all = collectRecords(prj, {});
  const vars = varsOf(all, prj);
  if (!cfg.x) cfg.x = vars.find((v) => /^AoA_2/.test(v)) || vars[0];
  const recs = filterRecords(all, cfg.filters);
  const rr = () => ctx.rerender();
  const opts = (list) => list.map((k) => [k, labelOf(k, mets)]);
  const xOpts = [...opts(vars), ...mets.map((m) => [m.key, `${m.label}${m.unit !== '—' ? ` [${m.unit}]` : ''}`])];
  const yOpts = mets.filter((m) => !cfg.perElement || !m.el).map((m) => [m.key, `${m.label}${m.unit !== '—' ? ` [${m.unit}]` : ''}`]);
  const grpOpts = [['', '— sem agrupamento —'], ['pacote', 'pacote'], ['rodada', 'rodada'], ['gurney', 'com/sem Gurney'], ...opts(vars)];

  // ---- painel de configuração
  const f = cfg.filters;
  const togg = (arr, id, on) => { const i = arr.indexOf(id); if (on && i < 0) arr.push(id); if (!on && i >= 0) arr.splice(i, 1); rr(); };
  const rangeInput = (k) => {
    const r = f.ranges[k] || [null, null];
    const mk = (j, ph) => { const i = h('input', { type: 'text', placeholder: ph, value: r[j] ?? '', style: { width: '70px' }, dataset: { k: `rg_${k}_${j}` } }); i.addEventListener('change', () => { const v = i.value.trim() ? parseNum(i.value) : null; f.ranges[k] = f.ranges[k] || [null, null]; f.ranges[k][j] = Number.isFinite(v) ? v : null; rr(); }); return i; };
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('code', { style: { width: '92px' } }, k), mk(0, 'mín'), mk(1, 'máx'));
  };
  const filterVars = vars.filter((v) => /^(AoA|Gap|Overlap)_|^Uinf$|^chord_/.test(v));
  const yList = cfg.type === 'heatmap' || cfg.type === 'surface' ? null : cfg.type === 'ranking' || cfg.type === 'matrix' ? null : h('div', { class: 'field' }, h('label', null, 'Y (um gráfico por métrica — nunca dois eixos)'),
    h('div', { class: 'row' }, yOpts.map(([k, l]) => checkField({ label: l.replace(/ \[.*\]/, ''), checked: cfg.ys.includes(k), onChange: (v) => { cfg.ys = v ? [...cfg.ys, k] : cfg.ys.filter((x) => x !== k); rr(); } }))));
  const panel = card('Configuração',
    h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: 'lbl' }, 'Atalhos:'),
      ['Lift/Drag × AoA', 'Lift/Drag × Uinf', 'Cl/Cd × AoA', 'Curvas por elemento', 'Estudo de gap', 'Estudo de overlap', 'Estudo de corda', 'Gurney × sem Gurney', 'Polar (Cl × Cd)'].map((n) => h('button', { class: 'small', onclick: () => { preset(cfg, n, vars, recs); rr(); } }, n)),
      h('button', { class: 'small', onclick: () => { Object.assign(cfg, { type: 'heatmap', x: vars.find((v) => /^AoA_2/.test(v)) || vars[0], y2: vars.find((v) => /^AoA_3/.test(v)) || vars[1], z: 'Cl' }); rr(); } }, 'Mapa AoA × AoA'),
      h('button', { class: 'small', onclick: () => { Object.assign(cfg, { type: 'ranking', metric: 'ClCd', desc: true }); rr(); } }, 'Ranking Cl/Cd')),
    h('div', { class: 'fields' },
      selectField({ label: 'Tipo', value: cfg.type, options: TYPES, onChange: (v) => { cfg.type = v; rr(); } }),
      ['xy', 'scatter', 'heatmap', 'surface'].includes(cfg.type) ? selectField({ label: 'Eixo X', value: cfg.x, options: xOpts, onChange: (v) => { cfg.x = v; rr(); } }) : null,
      ['heatmap', 'surface'].includes(cfg.type) ? selectField({ label: 'Eixo Y', value: cfg.y2 || vars[1], options: opts(vars), onChange: (v) => { cfg.y2 = v; rr(); } }) : null,
      ['heatmap', 'surface'].includes(cfg.type) ? selectField({ label: 'Cor (métrica)', value: cfg.z, options: mets.map((m) => [m.key, m.label]), onChange: (v) => { cfg.z = v; rr(); } }) : null,
      ['ranking', 'matrix'].includes(cfg.type) ? selectField({ label: 'Métrica', value: cfg.metric, options: mets.map((m) => [m.key, m.label]), onChange: (v) => { cfg.metric = v; rr(); } }) : null,
      cfg.type === 'ranking' ? selectField({ label: 'Ordem', value: cfg.desc ? 'desc' : 'asc', options: [['desc', 'maior primeiro'], ['asc', 'menor primeiro']], onChange: (v) => { cfg.desc = v === 'desc'; rr(); } }) : null,
      ['xy', 'scatter'].includes(cfg.type) ? selectField({ label: 'Agrupar séries por', value: cfg.groupBy, options: grpOpts, onChange: (v) => { cfg.groupBy = v; rr(); } }) : null,
      cfg.type === 'matrix' ? selectField({ label: 'Linhas', value: cfg.groupBy || 'rodada', options: [['rodada', 'rodadas'], ['pacote', 'pacotes']], onChange: (v) => { cfg.groupBy = v; rr(); } }) : null),
    ['xy', 'scatter'].includes(cfg.type) ? h('div', { class: 'row', style: { marginTop: '8px' } }, checkField({ label: 'Curvas por elemento (uma série por elemento)', checked: cfg.perElement, onChange: (v) => { cfg.perElement = v; if (v) cfg.ys = cfg.ys.filter((y) => !/_\d+$/.test(y)); rr(); } }),
      cfg.perElement ? checkField({ label: 'incluir total', checked: cfg.includeTotal, onChange: (v) => { cfg.includeTotal = v; rr(); } }) : null) : null,
    yList,
    h('details', { open: ui.filtersOpen || null, ontoggle: (e) => { ui.filtersOpen = e.target.open; } }, h('summary', null, `Filtros (${recs.length} de ${all.filter((r) => r.hasResult).length} DPs com resultado)`),
      h('div', { class: 'grid g3', style: { marginTop: '8px' } },
        h('div', null, h('div', { class: 'lbl' }, 'Pacotes'), prj.packages.map((k) => h('div', null, checkField({ label: k.name, checked: f.packages.includes(k.id), onChange: (v) => togg(f.packages, k.id, v) })))),
        h('div', null, h('div', { class: 'lbl' }, 'Rodadas'), prj.packages.flatMap((k) => k.runs.map((r) => h('div', null, checkField({ label: `${k.name} / ${r.name}`, checked: f.runs.includes(r.id), onChange: (v) => togg(f.runs, r.id, v) }))))),
        h('div', null, h('div', { class: 'lbl' }, 'Faixas (AoA, gap, overlap, corda, velocidade)'), filterVars.map(rangeInput))),
      h('button', { class: 'small', onclick: () => { cfg.filters = { packages: [], runs: [], ranges: {} }; rr(); } }, 'Limpar filtros')),
    h('hr'),
    h('div', { class: 'row' },
      h('button', { onclick: async () => { const n = await promptBox('Salvar configuração', 'Nome', `${TYPES.find((t) => t[0] === cfg.type)[1]} — ${cfg.x || cfg.metric}`); if (n) store.update(() => { prj.chartConfigs.push({ id: uid('chart'), name: n, cfg: clone(cfg) }); }, ['gráfico', n, 'configuração salva']); } }, 'Salvar configuração'),
      prj.chartConfigs.length ? h('span', { class: 'lbl' }, 'Salvas:') : null,
      prj.chartConfigs.map((c) => h('span', { class: 'row', style: { gap: '2px' } }, h('button', { class: 'small', onclick: () => { ui.cfg = clone(c.cfg); rr(); } }, c.name), h('button', { class: 'small ghost', title: 'Excluir', onclick: () => store.update(() => { prj.chartConfigs = prj.chartConfigs.filter((x) => x !== c); }) }, '×')))));

  // ---- gráfico(s)
  const out = [];
  const warn = [];
  const isEx = recs.some((r) => r.isExample);
  const badgeTxt = isEx ? 'DADOS DE EXEMPLO' : null;
  const csvRows = [];
  if (!recs.length) out.push(h('div', { class: 'empty' }, 'Nenhum DP com resultado para os filtros escolhidos. Importe resultados em Outputs.'));
  else if (cfg.type === 'xy' || cfg.type === 'scatter') {
    if (!cfg.ys.length) out.push(h('div', { class: 'empty' }, 'Escolha ao menos uma métrica Y.'));
    cfg.ys.forEach((y) => {
      const { series, warnings } = buildSeries(recs, { x: cfg.x, y, groupBy: cfg.groupBy || null, perElement: cfg.perElement, includeTotal: cfg.includeTotal });
      warnings.forEach((w) => { if (!warn.includes(w)) warn.push(w); });
      if (series.length > 8) warn.push(`${series.length} séries: só as 8 primeiras têm cor própria (as demais em cinza). Filtre ou agrupe de outra forma.`);
      series.forEach((s) => s.points.forEach((p) => { p.label = `${p.rec.dpName} — ${p.rec.pkgName} / ${p.rec.runName}`; csvRows.push([s.name, cfg.x, p.x, s.yKey, p.y, p.rec.dpName, p.rec.pkgName, p.rec.runName, p.rec.isExample ? 'exemplo' : '']); }));
      out.push(h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, `${labelOf(y, mets)} × ${labelOf(cfg.x, mets)}`), xyChart(series, { xLabel: labelOf(cfg.x, mets), yLabel: labelOf(y, mets), lines: cfg.type === 'xy', name: `${y}_vs_${cfg.x}`, badge: badgeTxt })));
    });
  } else if (cfg.type === 'heatmap' || cfg.type === 'surface') {
    const yk = cfg.y2 || vars[1];
    if (cfg.type === 'heatmap') {
      const g = heatmapGrid(recs, { x: cfg.x, y: yk, z: cfg.z });
      warn.push(...g.warnings, ...refWarnings(recs));
      g.grid.forEach((row, iy) => row.forEach((c, ix) => { if (c) { c.label = c.recs.map((r) => r.dpName).join(', '); csvRows.push([cfg.x, g.xs[ix], yk, g.ys[iy], cfg.z, c.z, c.n, c.label]); } }));
      out.push(card(`${labelOf(cfg.z, mets)} — ${labelOf(cfg.x, mets)} × ${labelOf(yk, mets)}`, heatmapChart(g, { xLabel: labelOf(cfg.x, mets), yLabel: labelOf(yk, mets), zLabel: mets.find((m) => m.key === cfg.z)?.label, name: `mapa_${cfg.z}` })));
    } else {
      const pts = recs.map((r) => ({ x: valueOf(r, cfg.x), y: valueOf(r, yk), z: valueOf(r, cfg.z), label: r.dpName })).filter((p) => [p.x, p.y, p.z].every(Number.isFinite));
      const fit = fitResponseSurface(pts);
      const vary = varyingInputs(recs, [cfg.x, yk]);
      if (vary.length) warn.push(`Os DPs também diferem em ${vary.join(', ')}: a superfície mistura condições. Filtre essas variáveis.`);
      warn.push(...refWarnings(recs));
      if (!fit.ok) out.push(card('Superfície de resposta', msgs([{ level: 'aviso', msg: `Dados insuficientes: ${fit.reason}` }])));
      else {
        const N = 30, xs = Array.from({ length: N }, (_, i) => fit.range.xmin + ((fit.range.xmax - fit.range.xmin) * i) / (N - 1)), ys = Array.from({ length: N }, (_, i) => fit.range.ymin + ((fit.range.ymax - fit.range.ymin) * i) / (N - 1));
        const grid = ys.map((y) => xs.map((x) => ({ z: fit.predict(x, y), n: 1 })));
        let best = null; grid.forEach((row, iy) => row.forEach((c, ix) => { if (!best || c.z > best.z) best = { z: c.z, x: xs[ix], y: ys[iy] }; }));
        pts.forEach((p) => csvRows.push([cfg.x, p.x, yk, p.y, cfg.z, p.z, fit.predict(p.x, p.y), p.label]));
        out.push(card(`Superfície de resposta quadrática — ${labelOf(cfg.z, mets)}`,
          h('p', null, `Ajuste por mínimos quadrados com ${fit.n} DPs: R² = ${fv(fit.r2, 4)}. Máximo do ajuste no domínio amostrado: ${fv(best.z, 4)} em ${cfg.x} = ${fv(best.x, 4)}, ${yk} = ${fv(best.y, 4)}. `, badge('modelo interpolado — não é CFD', 'warn')),
          heatmapChart({ xs, ys, grid, points: pts }, { xLabel: labelOf(cfg.x, mets), yLabel: labelOf(yk, mets), zLabel: `${mets.find((m) => m.key === cfg.z)?.label} (ajuste)`, noLabels: true, name: `superficie_${cfg.z}` })));
      }
    }
  } else if (cfg.type === 'ranking') {
    const rk = ranking(recs, cfg.metric, { desc: cfg.desc, limit: 25 });
    warn.push(...refWarnings(recs));
    rk.forEach((e) => csvRows.push([e.rec.dpName, e.rec.pkgName, e.rec.runName, cfg.metric, e.v]));
    out.push(card(`Ranking — ${mets.find((m) => m.key === cfg.metric)?.label}`, barChart(rk.map((e) => ({ label: `${e.rec.dpName} · ${e.rec.runName}`, value: e.v, detail: `${e.rec.pkgName}${e.rec.isExample ? ' (exemplo)' : ''}` })), { metric: cfg.metric, name: `ranking_${cfg.metric}` }),
      table([{ label: '#', get: (_, i) => i + 1 }, { label: 'DP', get: (e) => e.rec.dpName }, { label: 'Pacote / rodada', get: (e) => `${e.rec.pkgName} / ${e.rec.runName}` }, { label: 'Valor', num: true, get: (e) => fv(e.v, 5) }, { label: 'Entradas', get: (e) => varyingInputs(recs).map((k) => `${k}=${fv(Number(e.rec.inputs[k]), 4)}`).join(', ') }], rk.slice(0, 10))));
  } else if (cfg.type === 'matrix') {
    const by = cfg.groupBy === 'pacote' ? 'pkgName' : 'runName';
    const groups = [...new Set(recs.map((r) => (by === 'runName' ? `${r.pkgName} / ${r.runName}` : r.pkgName)))];
    const cols = [['Cl', 'máx'], ['ClCd', 'máx'], ['Cd', 'mín'], ['L', 'máx'], ['D', 'mín']];
    const cellVals = groups.map((g) => { const rs = recs.filter((r) => (by === 'runName' ? `${r.pkgName} / ${r.runName}` : r.pkgName) === g); return { g, n: rs.length, vals: cols.map(([k, mode]) => { const vs = rs.map((r) => valueOf(r, k)).filter(Number.isFinite); return vs.length ? (mode === 'máx' ? Math.max(...vs) : Math.min(...vs)) : null; }) }; });
    const best = cols.map((c, j) => { const vs = cellVals.map((r) => r.vals[j]).filter(Number.isFinite); return c[1] === 'máx' ? Math.max(...vs) : Math.min(...vs); });
    cellVals.forEach((r) => csvRows.push([r.g, r.n, ...r.vals]));
    warn.push(...refWarnings(recs));
    out.push(card('Matriz de comparação (melhor valor por grupo; destaque = melhor da coluna)', h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, by === 'runName' ? 'Pacote / rodada' : 'Pacote'), h('th', { class: 'num' }, 'DPs'), cols.map(([k, m]) => h('th', { class: 'num' }, `${mets.find((x) => x.key === k).label} (${m})`)))),
      h('tbody', null, cellVals.map((r) => h('tr', null, h('td', null, r.g), h('td', { class: 'num' }, r.n), r.vals.map((v, j) => h('td', { class: 'num', style: v === best[j] ? { fontWeight: 700, background: 'var(--ok-soft)' } : null }, fv(v, 4))))))))));
  }
  const csvHeaders = { xy: ['série', 'x', 'valor x', 'y', 'valor y', 'DP', 'pacote', 'rodada', 'exemplo'], scatter: ['série', 'x', 'valor x', 'y', 'valor y', 'DP', 'pacote', 'rodada', 'exemplo'], heatmap: ['x', 'valor x', 'y', 'valor y', 'métrica', 'valor', 'nº DPs', 'DPs'], surface: ['x', 'valor x', 'y', 'valor y', 'métrica', 'CFD', 'ajuste', 'DP'], ranking: ['DP', 'pacote', 'rodada', 'métrica', 'valor'], matrix: ['grupo', 'DPs', 'Cl máx', 'Cl/Cd máx', 'Cd mín', 'L máx', 'D mín'] }[cfg.type];
  return h('div', null,
    pageHead('Gráficos', 'Escolha X/Y, filtros e agrupamentos. Cada métrica tem seu próprio gráfico (sem eixo duplo). Passe o mouse para ver o DP.',
      h('button', { disabled: !csvRows.length || null, onclick: () => download(`${safeName(`grafico_${cfg.type}`)}.csv`, toCSV(csvHeaders, csvRows), 'text/csv') }, 'Exportar dados (CSV)')),
    isEx ? exampleBanner() : null,
    panel,
    warn.length ? card('Condições incompatíveis / avisos', msgs(warn.map((m) => ({ level: 'aviso', msg: m })))) : null,
    out);
}
