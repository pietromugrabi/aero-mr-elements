import { h, card, msgs, badge, checkField, selectField, seg, fv, exampleBanner } from '../dom.js';
import { needs, pageHead } from '../common.js';
import { collectRecords, ranking, valueOf, varyingInputs } from '../../core/chartdata.js';
import { metricList } from '../../core/outputs.js';
import { fmt } from '../../core/num.js';
import { resolveTopology } from '../../core/assembly.js';
import { pairOf, gurneyConfigured } from '../../core/wing.js';

export default function comparacao(ctx) {
  const miss = needs(['project'], ctx); if (miss) return miss;
  const prj = ctx.project, ui = ctx.ui;
  ui.mode = ui.mode || 'rodada';
  ui.metric = ui.metric || 'ClCd';
  ui.sel = ui.sel || [];
  const all = collectRecords(prj, {});
  const items = ui.mode === 'pacote'
    ? prj.packages.map((k) => ({ id: k.id, name: k.name, pkg: k, runs: k.runs, recs: all.filter((r) => r.pkgId === k.id) }))
    : prj.packages.flatMap((k) => k.runs.map((r) => ({ id: r.id, name: `${k.name} / ${r.name}`, pkg: k, runs: [r], recs: all.filter((x) => x.runId === r.id) })));
  ui.sel = ui.sel.filter((id) => items.some((i) => i.id === id)); // seleção de outro projeto não vale aqui
  if (!ui.sel.length && !ui.cleared) ui.sel = items.slice(0, Math.min(3, items.length)).map((i) => i.id);
  const chosen = items.filter((i) => ui.sel.includes(i.id));
  const mets = metricList(Math.max(1, ...prj.packages.map((k) => k.config.elements.length)));
  const met = mets.find((m) => m.key === ui.metric);
  const rr = () => ctx.rerender();

  const selector = card('O que comparar',
    h('div', { class: 'row', style: { marginBottom: '8px' } }, seg([['rodada', 'Rodadas'], ['pacote', 'Pacotes']], ui.mode, (v) => { ui.mode = v; ui.sel = []; rr(); }),
      selectField({ label: null, value: ui.metric, options: mets.map((m) => [m.key, `Melhor por: ${m.label}`]), onChange: (v) => { ui.metric = v; rr(); } })),
    h('div', { class: 'grid g3' }, items.map((i) => checkField({ label: `${i.name} (${i.recs.filter((r) => r.hasResult).length} c/ resultado)`, checked: ui.sel.includes(i.id), onChange: (v) => { ui.sel = v ? [...ui.sel, i.id] : ui.sel.filter((x) => x !== i.id); ui.cleared = !ui.sel.length; rr(); } }))));
  if (!chosen.length) return h('div', null, pageHead('Comparação'), selector, h('div', { class: 'empty' }, 'Selecione ao menos um item.'));

  const els = (k, f) => k.config.elements.map(f).join(' / ');
  const uSet = (it) => [...new Set(it.runs.flatMap((r) => r.dps.map((d) => Number(d.inputs.Uinf))))].sort((a, b) => a - b);
  const lowerBetter = /^(Cd|D)(_\d+)?$/.test(ui.metric);
  const best = (it) => ranking(it.recs.filter((r) => r.hasResult), ui.metric, { limit: 1, desc: !lowerBetter })[0] || null;
  const rows = [
    ['Perfis', (it) => els(it.pkg, (e) => e.profileName || '?')],
    ['Nº de elementos / modo', (it) => `${it.pkg.config.elements.length} / ${it.pkg.config.mode}${it.pkg.config.mode === '3D' ? ` (span ${it.pkg.config.span_mm ?? '—'} mm)` : ''}`],
    ['Cordas ref. [mm]', (it) => els(it.pkg, (e) => fmt(Number(e.chord_ref), 1))],
    ['AoA ref. [°]', (it) => els(it.pkg, (e) => fmt(Number(e.aoa_ref), 1))],
    ['Tipos (ref.)', (it) => { const tp = resolveTopology(it.pkg.config.elements); return tp.kinds.map((k, i) => `${i + 1}: ${k}${tp.refs[i] != null ? ` → ${tp.refs[i] + 1}` : ''}`).join(' · '); }],
    ['Gap / Overlap ref. [mm]', (it) => it.pkg.config.elements.map((e, i) => (pairOf(it.pkg, i + 1) ? `el. ${i + 1}: ${fmt(Number(e.gap_ref), 2)} / ${fmt(Number(e.overlap_ref), 2)}` : null)).filter(Boolean).join(' · ') || '—'],
    ['Gurney', (it) => it.pkg.config.elements.map((e, i) => (e.gurney?.enabled || gurneyConfigured(e) ? `el. ${i + 1}: ${e.gurney.enabled ? 'ligado' : 'desligado na ref.'}, h=${e.gurney.h} t=${e.gurney.t} pos=${e.gurney.pos ?? 0} mm, ${e.gurney.side === 'succao' ? 'sucção' : 'pressão'}` : null)).filter(Boolean).join('; ') || 'não'],
    ['Raio do BF', (it) => els(it.pkg, (e) => (e.te?.enabled ? `${e.te.value} ${e.te.mode === 'mm' ? 'mm' : '% c'}` : 'agudo'))],
    ['Convenção de montagem', (it) => `${it.pkg.config.conventions.assemblyMode}, gap ${it.pkg.config.conventions.gapDef}/${it.pkg.config.conventions.gapAxes}`],
    ['Domínio', (it) => { const d = it.pkg.config.domain; return `${d.upstream}/${d.downstream}/${d.above}·C${d.groundEnabled ? `, solo h = ${d.groundClearance ?? '—'} mm${d.groundMoving ? ' (móvel)' : ''}` : `, abaixo ${d.below}·C`}`; }],
    ['ρ [kg/m³] / A_ref', (it) => `${it.pkg.config.fluent.rho} / ${it.pkg.config.fluent.arefBasis === 'fixo' ? `fixo ${it.pkg.config.fluent.arefFixed} m²` : 'Σ cordas do DP'}`],
    ['Uinf nos DPs [m/s]', (it) => uSet(it).map((u) => fmt(u, 1)).join('; ') || '—'],
    ['DPs (com resultado)', (it) => `${it.recs.length} (${it.recs.filter((r) => r.hasResult).length})`],
    ['Variáveis do DOE', (it) => varyingInputs(it.recs).join(', ') || '—'],
    [`Melhor ${met.label}`, (it) => { const b = best(it); return b ? `${fv(b.v, 5)} — ${b.rec.dpName}` : '—'; }],
    ['Entradas do melhor DP', (it) => { const b = best(it); return b ? varyingInputs(it.recs).map((k) => `${k} = ${fv(Number(b.rec.inputs[k]), 4)}`).join(', ') || '(ponto único)' : '—'; }],
    ...['Cl', 'Cd', 'ClCd', 'L', 'D'].map((k) => [`${mets.find((m) => m.key === k).label} (mín … máx)`, (it) => { const v = it.recs.map((r) => valueOf(r, k)).filter(Number.isFinite); return v.length ? `${fv(Math.min(...v), 4)} … ${fv(Math.max(...v), 4)}` : '—'; }]),
  ];
  const bests = chosen.map(best);
  const winner = bests.reduce((w, b, i) => (b && (!w || (lowerBetter ? b.v < w.b.v : b.v > w.b.v)) ? { b, i } : w), null);

  // avisos de condições
  const warn = [];
  const uniq = (f) => new Set(chosen.map(f)).size > 1;
  if (uniq((it) => uSet(it).join(','))) warn.push('Os itens têm conjuntos de Uinf diferentes: compare com o mesmo Uinf (filtre nos Gráficos).');
  if (uniq((it) => it.pkg.config.fluent.rho)) warn.push('Densidades diferentes.');
  if (uniq((it) => `${it.pkg.config.fluent.arefBasis}|${it.pkg.config.fluent.arefFixed}|${it.pkg.config.fluent.arefMode}`)) warn.push('Convenções de A_ref diferentes: os coeficientes não usam a mesma área.');
  if (uniq((it) => it.pkg.config.mode)) warn.push('Mistura de 2D e 3D.');
  if (uniq((it) => JSON.stringify(it.pkg.config.domain))) warn.push('Domínios diferentes (distâncias ou solo).');
  if (uniq((it) => it.pkg.config.conventions.chordDef)) warn.push('Definições de corda diferentes.');
  if (chosen.some((it) => it.recs.some((r) => r.isExample))) warn.push('Há DADOS DE EXEMPLO (sintéticos) entre os itens comparados.');
  if (chosen.some((it) => !it.recs.some((r) => r.hasResult))) warn.push('Algum item não tem resultados.');

  return h('div', null,
    pageHead('Comparação', 'Pacotes ou rodadas lado a lado, com o melhor resultado pela métrica escolhida.'),
    chosen.some((it) => it.recs.some((r) => r.isExample)) ? exampleBanner() : null,
    selector,
    warn.length ? card('Condições diferentes entre os itens', msgs(warn.map((m) => ({ level: 'aviso', msg: m })))) : null,
    card(winner ? `Melhor por ${met.label}: ${chosen[winner.i].name} (${fv(winner.b.v, 5)}, ${winner.b.rec.dpName})` : 'Comparação',
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, ''), chosen.map((it, i) => h('th', null, it.name, winner && winner.i === i ? h('span', null, ' ', badge('melhor', 'ok')) : null)))),
        h('tbody', null, rows.map(([label, f]) => h('tr', null, h('th', { style: { position: 'static' } }, label), chosen.map((it) => h('td', null, f(it))))))))));
}
