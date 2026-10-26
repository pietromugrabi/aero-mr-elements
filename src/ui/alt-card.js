// Cartão "Otimização alternada" da aba Inputs / Design Points (como a planilha): cada rodada varia
// 2 parâmetros; mostra a grade do critério, o melhor DP e a região de valores vizinhos, e cria a
// próxima rodada variando outro par com os valores fixos no centro da região (ou no DP).

import { h, card, msgs, badge, selectField, numField, textField, confirmBox, toast, fv } from './dom.js';
import * as store from './store.js';
import { metricList } from '../core/outputs.js';
import { doeVariables, parseLevels, LIMITS } from '../core/doe.js';
import { uid } from '../core/model.js';
import { altConfig, CRITERIA, rankRun, edges, fixedFor, grid2D, goodRegion, chainOf, suggestedBlocks, nextBlockIndex, proposeLevels, improvement, buildNextRun, variedVars } from '../core/alternada.js';

const r6 = (v) => +Number(v).toPrecision(6);
const FIX_OPTS = [['regiao', 'Centro da região vizinha'], ['dp', 'Valores exatos de um DP']];

/** Grade 2D do critério, como as tabelas da planilha: melhor em destaque, região vizinha em verde. */
function gridTable(G, reg, met) {
  const style = (c) => (!c ? null : c === G.best ? { background: 'var(--accent-soft)', fontWeight: '700', outline: '1px solid var(--accent)' } : reg?.ids.has(c.dp.id) ? { background: 'var(--ok-soft)' } : null);
  return h('div', null,
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, `${G.Y.label} ↓ / ${G.X.label} →`), G.X.levels.map((x) => h('th', { class: 'num' }, `${fv(x, 4)} ${G.X.unit}`)))),
      h('tbody', null, G.Y.levels.map((y, j) => h('tr', null, h('th', { style: { position: 'static' } }, `${fv(y, 4)} ${G.Y.unit}`),
        G.X.levels.map((_, i) => { const c = G.cells[j][i]; return h('td', { class: 'num', style: style(c), title: c ? `${c.dp.name}: ${met.label} = ${c.v}` : 'sem resultado' }, c ? fv(c.v, 5) : '–'); })))))),
    h('small', { class: 'muted' }, 'Destaque vermelho = melhor DP; verde = região vizinha (até a faixa % do melhor, em níveis vizinhos); "–" = sem resultado.'));
}

export function altCard(ctx, pkg, run) {
  const ui = ctx.ui, cfg = altConfig(pkg);
  const met = metricList(pkg.config.elements.length).find((m) => m.key === cfg.metric);
  const crit = CRITERIA.find(([k]) => k === cfg.metric)[1];
  const setCfg = (k, v) => store.update(() => { pkg.config.altOpt = { ...altConfig(pkg), [k]: v }; ui.altLevels = null; }, ['otimização alternada', pkg.name, k, String(v)]);
  const R = rankRun(pkg, run, cfg);
  const chain = chainOf(pkg, run);

  const criteria = h('div', { class: 'fields' },
    selectField({ label: 'Melhor configuração (pacote)', value: cfg.metric, options: CRITERIA, onChange: (v) => setCfg('metric', v), hint: 'em módulo: downforce sai negativa no Fluent' }),
    numField({ label: 'Faixa da região vizinha', unit: '% do melhor', value: cfg.band, key: 'alt_band', onChange: (v) => setCfg('band', Math.max(0, v ?? 2)), hint: 'DPs vizinhos com |critério| a até esta % do melhor formam o intervalo dos melhores valores' }),
    numField({ label: 'Tolerância de parada', unit: '%', value: cfg.tol, key: 'alt_tol', onChange: (v) => setCfg('tol', v ?? 1), hint: 'melhora menor que isto, depois de percorrer todos os pares = convergiu' }),
    numField({ label: 'Níveis de parâmetro novo', unit: 'nív.', value: cfg.nLevels, key: 'alt_nl', onChange: (v) => setCfg('nLevels', Math.max(2, Math.round(v || 5))), hint: 'parâmetros já variados na cadeia usam refino entre os vizinhos (3 níveis, metade do passo)' }));

  const chainRow = chain.length > 1 ? h('div', { class: 'row', style: { margin: '8px 0', flexWrap: 'wrap' } }, h('span', { class: 'lbl' }, 'Cadeia:'),
    chain.flatMap((r, i) => {
      const b = rankRun(pkg, r, cfg).best;
      const el = h('button', { class: 'small' + (r === run ? ' primary' : ''), onclick: () => store.setActive({ runId: r.id }) }, `${r.name}${b ? ` (${fv(b.v, 4)})` : ''}`);
      return i ? [h('span', { class: 'muted' }, '→'), el] : [el];
    })) : null;

  const intro = h('p', { class: 'muted' }, 'Como a planilha: cada rodada varia 2 parâmetros (ex.: AoA_1 × AoA_2) com os demais fixos. Acha-se a melhor configuração e o intervalo de valores vizinhos quase tão bons; o valor intermediário desse intervalo fica fixo na próxima rodada, que varia outro par (ex.: Gap_1 × Overlap_1). Depois de percorrer todos os pares, repita com passo menor até a melhora ficar abaixo da tolerância.');

  if (!R.best) {
    return card('Otimização alternada', intro, criteria, chainRow,
      msgs([{ level: 'info', msg: run.dps.length ? `Nenhum DP desta rodada tem resultado de ${met.label}. Importe os resultados do Fluent (aba Outputs) para achar a melhor configuração e gerar a próxima rodada.` : 'Gere os DPs desta rodada (2 parâmetros com níveis), rode no Fluent e importe os resultados para continuar a otimização.' }]));
  }

  // estado local: reinicia quando muda a rodada
  if (ui.altFor !== run.id) { ui.altFor = run.id; ui.altDpId = null; ui.altBlock = null; ui.altKeys = null; ui.altLevels = null; ui.altName = null; }
  const chosen = (cfg.fix === 'dp' && R.ranked.find((x) => x.dp.id === ui.altDpId)) || R.best;
  const ed = edges(pkg, run, chosen.dp);
  const reg = goodRegion(pkg, run, cfg);
  const G = grid2D(pkg, run, cfg);
  const fixed = fixedFor(pkg, run, chosen.dp, cfg);
  const vars = doeVariables(pkg), byKey = new Map(vars.map((v) => [v.key, v]));
  const current = variedVars(pkg, run).map((v) => v.key);
  const imp = improvement(pkg, run, cfg);

  const notes = [];
  if (current.length !== 2) notes.push({ level: 'aviso', msg: `Esta rodada varia ${current.length} parâmetro(s) (${current.map((k) => byKey.get(k)?.label || k).join(', ') || 'nenhum'}). O método da planilha usa 2 por rodada; a próxima rodada já sai com 2.` });
  if (R.nResults < R.nTotal) notes.push({ level: 'info', msg: `${R.nResults} de ${R.nTotal} DP(s) têm resultado; os demais (sem resultado ou "falhou") não entram na escolha.` });
  if (chosen.example) notes.push({ level: 'aviso', msg: 'O DP escolhido tem DADOS DE EXEMPLO (sintéticos), não resultado de CFD.' });
  if (chosen.stale) notes.push({ level: 'aviso', msg: 'As entradas do DP escolhido foram alteradas depois da importação: o resultado pode não corresponder.' });
  if (reg && cfg.fix === 'regiao') {
    notes.push({ level: 'info', msg: `Melhores valores (até ${fv(cfg.band, 3)} % do melhor, ${reg.good.length > 1 ? `melhor + ${reg.good.length - 1} DP(s) vizinho(s)` : 'só o melhor DP: nenhum vizinho dentro da faixa'}): ${Object.values(reg.ranges).map((r) => `${r.label} de ${fv(r.min, 4)} a ${fv(r.max, 4)} ${r.unit} → ${fv(r.center, 4)}`).join('; ')}. Esses valores intermediários ficam fixos na próxima rodada.` });
    const off = Object.values(reg.ranges).filter((r) => r.center !== r6(chosen.dp.inputs[r.key]));
    if (off.length) notes.push({ level: 'aviso', msg: `O ponto intermediário (${off.map((r) => `${r.label} = ${fv(r.center, 4)}`).join(', ')}) não foi simulado nesta rodada; ele entra como valor fixo da próxima (como na planilha). Para fixar exatamente o melhor DP, use "Valores exatos de um DP".` });
  }
  ed.filter((e) => e.edge).forEach((e) => notes.push({ level: 'aviso', msg: `O melhor ${e.label} (${fv(e.value, 4)} ${e.unit}) ficou na borda (${e.edge === 'min' ? 'mínimo' : 'máximo'}) da faixa testada: o ótimo pode estar fora dela. Considere repetir este par (a proposta recentra a faixa) antes de passar ao próximo.` }));
  if (imp) notes.push(imp.pct < cfg.tol ? { level: 'ok', msg: `Melhora de ${fv(imp.pct, 3)} % em relação a "${imp.from.name}" (${fv(imp.prev.v, 5)} → ${fv(imp.cur.v, 5)}), abaixo da tolerância de ${fv(cfg.tol, 3)} %. Se a passada já percorreu todos os pares, a otimização convergiu.` } : { level: 'info', msg: `Melhora de ${fv(imp.pct, 3)} % em relação a "${imp.from.name}" (${fv(imp.prev.v, 5)} → ${fv(imp.cur.v, 5)}).` });

  const bestBox = h('div', null,
    h('p', null, h('strong', null, `Melhor: ${R.best.dp.name}`), ` — ${met.label} = ${fv(R.best.v, 5)}`),
    G ? gridTable(G, reg, met) : null,
    h('div', { class: 'fields', style: { marginTop: '10px' } },
      selectField({ label: 'Valores fixos na próxima rodada', value: cfg.fix, options: FIX_OPTS, onChange: (v) => setCfg('fix', v), hint: cfg.fix === 'regiao' ? 'valor intermediário do intervalo dos melhores, como na planilha' : null }),
      cfg.fix === 'dp' ? selectField({ label: 'DP', value: chosen.dp.id, options: R.ranked.slice(0, 15).map((x, i) => [x.dp.id, `${i === 0 ? '★ ' : ''}${x.dp.name} — ${met.label} = ${fv(x.v, 5)}`]), onChange: (v) => { ui.altDpId = v; ui.altLevels = null; ctx.rerender(); }, hint: 'o primeiro é o melhor pelo critério' }) : null),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Parâmetro', `No ${chosen.dp.name}`, 'Fixo na próxima rodada', 'Níveis testados nesta rodada', ''].map((t) => h('th', null, t)))),
      h('tbody', null, vars.filter((v) => fixed[v.key] != null).map((v) => {
        const e = ed.find((x) => x.key === v.key);
        return h('tr', null, h('td', null, h('code', null, v.label)), h('td', { class: 'num' }, `${fv(chosen.dp.inputs[v.key], 5)} ${v.unit}`), h('td', { class: 'num' }, h('strong', null, `${fv(fixed[v.key], 5)} ${v.unit}`)),
          h('td', null, e ? e.levels.map((x) => fv(x, 4)).join('; ') : h('span', { class: 'muted' }, 'fixo')),
          h('td', null, e ? (e.edge ? badge(`borda (${e.edge === 'min' ? 'mín.' : 'máx.'})`, 'warn') : badge('interior', 'ok')) : ''));
      })))),
    msgs(notes));

  // próximo par
  const blocks = suggestedBlocks(pkg);
  const opts = [...blocks.map((b, i) => [String(i), b.label]), ...(current.length === 2 ? [['repetir', `Repetir este par (${current.map((k) => byKey.get(k)?.label || k).join(' × ')}) com os valores vizinhos`]] : []), ['custom', 'Outro par (escolher)']];
  // ótimo na borda → padrão é repetir o par com a faixa recentrada; senão, o próximo par da passada
  const blk = ui.altBlock ?? (current.length === 2 && ed.some((e) => e.edge) ? 'repetir' : String(Math.max(0, nextBlockIndex(pkg, run))));
  const cand = vars.filter((v) => fixed[v.key] != null && v.key !== 'Uinf' && !/^gurney_on_/.test(v.key));
  const free = cand.filter((v) => !current.includes(v.key) && !/^chord_/.test(v.key)); // padrão do par personalizado: 2 parâmetros (não corda) não variados nesta rodada
  const pick = ui.altKeys || [(free[0] || cand[0])?.key, (free[1] || cand[1])?.key];
  const keysNext = blk === 'custom' ? pick.filter(Boolean) : blk === 'repetir' ? current : (blocks[Number(blk)]?.keys || []);
  ui.altLevels = ui.altLevels || {};
  const levelOf = (k) => ui.altLevels[k] ?? proposeLevels(pkg, chain, k, fixed[k], cfg).values.map((x) => String(x).replace('.', ',')).join('; ');
  const parsed = keysNext.map((k) => parseLevels(levelOf(k)));
  const count = parsed.reduce((p, x) => p * Math.max(1, x.values.length), keysNext.length ? 1 : 0);
  const step = (run.alt?.step || 1) + 1;
  const defName = `Alternada ${step} — ${keysNext.map((k) => byKey.get(k)?.label || k).join(' × ') || '?'}`;
  const twoOk = keysNext.length === 2 && keysNext[0] !== keysNext[1];

  const custom = blk === 'custom' ? h('div', { class: 'fields' }, [0, 1].map((n) => selectField({ label: `Parâmetro ${n ? 'B' : 'A'}`, value: pick[n], options: cand.map((v) => [v.key, `${v.label} — ${v.group}`]), onChange: (v) => { const p = [...pick]; p[n] = v; ui.altKeys = p; ui.altLevels = null; ctx.rerender(); } }))) : null;

  const levelRows = keysNext.map((k, i) => {
    const v = byKey.get(k), p = proposeLevels(pkg, chain, k, fixed[k], cfg);
    const inp = h('input', { type: 'text', value: levelOf(k), style: { width: '100%' }, dataset: { k: `alt_lv_${k}` } });
    inp.addEventListener('change', () => { ui.altLevels[k] = inp.value; ctx.rerender(); });
    return h('tr', null, h('td', null, h('code', null, v?.label || k)), h('td', { class: 'num' }, `${fv(fixed[k], 5)} ${v?.unit || ''}`), h('td', { style: { minWidth: '220px' } }, inp),
      h('td', null, parsed[i].error ? badge(parsed[i].error, 'err') : h('small', { class: 'muted' }, `${parsed[i].values.length} nível(is) — ${ui.altLevels[k] != null ? 'editado' : p.why}`)));
  });

  const create = async () => {
    if (!twoOk) { toast('Escolha 2 parâmetros diferentes para a próxima rodada.', true); return; }
    if (parsed.some((p) => p.error || !p.values.length)) { toast('Corrija os níveis antes de criar a rodada.', true); return; }
    if (count > LIMITS.max) { toast(`${count} pontos excedem o limite de ${LIMITS.max}.`, true); return; }
    if (count > LIMITS.confirm && !(await confirmBox('Rodada grande', `Gerar ${count} Design Points? Cada um é uma simulação CFD.`, 'Gerar'))) return;
    const name = (ui.altName || '').trim() || defName;
    const res = buildNextRun(pkg, run, chosen.dp, Object.fromEntries(keysNext.map((k) => [k, levelOf(k)])), { name, uid: () => uid('dp'), cfg, fixed });
    if (res.error) { toast(res.error, true); return; }
    store.update((s) => { pkg.runs.push(res.run); s.ui.active.runId = res.run.id; }, ['otimização alternada', name, 'rodada criada', `fixos ${cfg.fix === 'regiao' ? `no centro da região vizinha ao ${chosen.dp.name}` : `do ${chosen.dp.name}`} de "${run.name}" (${met.label} = ${fv(chosen.v, 5)}); ${res.run.dps.length} DP(s)${res.removed ? `, ${res.removed} inválido(s) descartado(s)` : ''}`]);
    toast(`Rodada "${name}" criada com ${res.run.dps.length} DP(s)${res.removed ? ` (${res.removed} combinação(ões) descartada(s): ${res.removed - res.nGeo} pelas regras, ${res.nGeo} por erro de geometria)` : ''}. Ela já é a rodada ativa.`);
  };

  return card('Otimização alternada', intro, criteria, chainRow,
    h('h3', null, `Melhor configuração de "${run.name}" — ${crit}`), bestBox,
    h('h3', null, 'Próxima rodada (outro par de parâmetros)'),
    h('div', { class: 'fields' }, selectField({ label: 'Variar na próxima rodada', value: blk, options: opts, onChange: (v) => { ui.altBlock = v; ui.altLevels = null; ctx.rerender(); }, hint: blocks.length ? `ordem da passada: ${blocks.map((b) => b.label).join(' → ')}` : null })),
    custom,
    keysNext.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Parâmetro', 'Centro (valor fixo)', 'Níveis', 'Origem da proposta'].map((t) => h('th', null, t)))),
      h('tbody', null, levelRows))) : h('div', { class: 'empty' }, 'Escolha os 2 parâmetros da próxima rodada.'),
    !twoOk && keysNext.length ? msgs([{ level: 'aviso', msg: 'Escolha 2 parâmetros diferentes.' }]) : null,
    h('p', { class: 'muted' }, 'Os demais parâmetros ficam fixos na coluna "Fixo na próxima rodada". A rodada é criada no método fatorial (grade 2D, como a planilha), com as regras de validade e a verificação de geometria do pacote; a seleção ativa passa para ela.'),
    h('div', { class: 'fields' }, textField({ label: 'Nome da nova rodada', value: ui.altName || defName, key: 'alt_name', wide: true, onChange: (v) => { ui.altName = v; } })),
    h('div', { class: 'row' }, h('button', { class: 'primary', disabled: !twoOk || count > LIMITS.max || null, onclick: create }, `Criar próxima rodada e gerar ${count} DP(s)`)));
}
