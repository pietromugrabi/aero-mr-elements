// Cartão "Otimização alternada" da aba Inputs / Design Points: escolhe o melhor DP da rodada pelo
// critério do pacote e cria a próxima rodada com esses valores fixos, variando o próximo bloco.

import { h, card, msgs, badge, checkField, selectField, numField, textField, confirmBox, toast, fv } from './dom.js';
import * as store from './store.js';
import { metricList } from '../core/outputs.js';
import { doeVariables, parseLevels, LIMITS } from '../core/doe.js';
import { uid } from '../core/model.js';
import { altConfig, GOALS, rankRun, edges, fixedFrom, chainOf, suggestedBlocks, nextBlockIndex, proposeLevels, improvement, buildNextRun, variedVars } from '../core/alternada.js';

export function altCard(ctx, pkg, run) {
  const ui = ctx.ui, cfg = altConfig(pkg);
  const mets = metricList(pkg.config.elements.length);
  const met = mets.find((m) => m.key === cfg.metric) || mets[0];
  const setCfg = (k, v) => store.update(() => { pkg.config.altOpt = { ...altConfig(pkg), [k]: v }; ui.altLevels = null; }, ['otimização alternada', pkg.name, k, String(v)]);
  const R = rankRun(pkg, run, cfg);
  const chain = chainOf(pkg, run);

  const criteria = h('div', { class: 'fields' },
    selectField({ label: 'Critério (pacote)', value: cfg.metric, options: mets.map((m) => [m.key, m.label]), onChange: (v) => setCfg('metric', v) }),
    selectField({ label: 'Objetivo', value: cfg.goal, options: GOALS, onChange: (v) => setCfg('goal', v) }),
    numField({ label: 'Tolerância de parada', unit: '%', value: cfg.tol, key: 'alt_tol', onChange: (v) => setCfg('tol', v ?? 1), hint: 'melhora menor que isto, depois de percorrer todos os blocos = convergiu' }),
    numField({ label: 'Níveis de variável nova', unit: 'nív.', value: cfg.nLevels, key: 'alt_nl', onChange: (v) => setCfg('nLevels', Math.max(2, Math.round(v || 5))), hint: 'variáveis já variadas na cadeia usam refino (3 níveis, metade do passo)' }));

  const chainRow = chain.length > 1 ? h('div', { class: 'row', style: { margin: '8px 0', flexWrap: 'wrap' } }, h('span', { class: 'lbl' }, 'Cadeia:'),
    chain.flatMap((r, i) => {
      const b = rankRun(pkg, r, cfg).best;
      const el = h('button', { class: 'small' + (r === run ? ' primary' : ''), onclick: () => store.setActive({ runId: r.id }) }, `${r.name}${b ? ` (${fv(b.v, 4)})` : ''}`);
      return i ? [h('span', { class: 'muted' }, '→'), el] : [el];
    })) : null;

  const intro = h('p', { class: 'muted' }, 'Cada rodada varia um bloco (ex.: AoA_1 × AoA_2) com os demais fixos; o melhor DP pelo critério vira o ponto fixo da próxima rodada, que varia outro bloco (ex.: Gap_1 × Overlap_1). Depois de percorrer todos os blocos, repita com passo menor até a melhora ficar abaixo da tolerância.');

  if (!R.best) {
    return card('Otimização alternada', intro, criteria, chainRow,
      msgs([{ level: 'info', msg: run.dps.length ? `Nenhum DP desta rodada tem resultado de ${met.label}. Importe os resultados do Fluent (aba Outputs) para escolher o melhor DP e gerar a próxima rodada.` : 'Gere os DPs desta rodada, rode no Fluent e importe os resultados para continuar a otimização.' }]));
  }

  // estado local: reinicia quando muda a rodada
  if (ui.altFor !== run.id) { ui.altFor = run.id; ui.altDpId = null; ui.altBlock = null; ui.altKeys = null; ui.altLevels = null; ui.altName = null; }
  const chosen = R.ranked.find((x) => x.dp.id === ui.altDpId) || R.best;
  const ed = edges(pkg, run, chosen.dp);
  const fixed = fixedFrom(pkg, chosen.dp);
  const vars = doeVariables(pkg), byKey = new Map(vars.map((v) => [v.key, v]));
  const imp = improvement(pkg, run, cfg);

  const notes = [];
  if (R.nResults < R.nTotal) notes.push({ level: 'info', msg: `${R.nResults} de ${R.nTotal} DP(s) têm resultado; os demais (sem resultado ou "falhou") não entram na escolha.` });
  if (chosen.example) notes.push({ level: 'aviso', msg: 'O DP escolhido tem DADOS DE EXEMPLO (sintéticos), não resultado de CFD.' });
  if (chosen.stale) notes.push({ level: 'aviso', msg: 'As entradas do DP escolhido foram alteradas depois da importação: o resultado pode não corresponder.' });
  ed.filter((e) => e.edge).forEach((e) => notes.push({ level: 'aviso', msg: `O melhor ${e.label} (${fv(e.value, 4)} ${e.unit}) ficou na borda (${e.edge === 'min' ? 'mínimo' : 'máximo'}) da faixa testada: o ótimo pode estar fora dela. Considere repetir este bloco (a proposta recentra a faixa) antes de passar ao próximo.` }));
  if (imp) notes.push(imp.pct < cfg.tol ? { level: 'ok', msg: `Melhora de ${fv(imp.pct, 3)} % em relação a "${imp.from.name}" (${fv(imp.prev.v, 5)} → ${fv(imp.cur.v, 5)}), abaixo da tolerância de ${fv(cfg.tol, 3)} %. Se a passada já percorreu todos os blocos, a otimização convergiu.` } : { level: 'info', msg: `Melhora de ${fv(imp.pct, 3)} % em relação a "${imp.from.name}" (${fv(imp.prev.v, 5)} → ${fv(imp.cur.v, 5)}).` });

  const bestBox = h('div', null,
    h('div', { class: 'fields' }, selectField({ label: 'DP fixado na próxima rodada', value: chosen.dp.id, options: R.ranked.slice(0, 15).map((x, i) => [x.dp.id, `${i === 0 ? '★ ' : ''}${x.dp.name} — ${met.label} = ${fv(x.v, 5)}`]), onChange: (v) => { ui.altDpId = v; ui.altLevels = null; ctx.rerender(); }, hint: 'o primeiro é o melhor pelo critério; troque se quiser fixar outro' })),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Variável', `Valor no ${chosen.dp.name}`, 'Níveis testados nesta rodada', ''].map((t) => h('th', null, t)))),
      h('tbody', null, vars.filter((v) => fixed[v.key] != null).map((v) => {
        const e = ed.find((x) => x.key === v.key);
        return h('tr', null, h('td', null, h('code', null, v.label)), h('td', { class: 'num' }, `${fv(fixed[v.key], 5)} ${v.unit}`),
          h('td', null, e ? e.levels.map((x) => fv(x, 4)).join('; ') : h('span', { class: 'muted' }, 'fixo')),
          h('td', null, e ? (e.edge ? badge(`borda (${e.edge === 'min' ? 'mín.' : 'máx.'})`, 'warn') : badge('interior', 'ok')) : ''));
      })))),
    msgs(notes));

  // próximo bloco
  const blocks = suggestedBlocks(pkg);
  const current = variedVars(pkg, run).map((v) => v.key);
  const opts = [...blocks.map((b, i) => [String(i), b.label]), ...(current.length ? [['repetir', `Repetir este bloco (${current.map((k) => byKey.get(k)?.label || k).join(' × ')})`]] : []), ['custom', 'Personalizado']];
  // ótimo na borda → padrão é repetir o bloco com a faixa recentrada; senão, o próximo bloco da passada
  const blk = ui.altBlock ?? (current.length && ed.some((e) => e.edge) ? 'repetir' : String(Math.max(0, nextBlockIndex(pkg, run))));
  const keysNext = blk === 'custom' ? (ui.altKeys || []) : blk === 'repetir' ? current : (blocks[Number(blk)]?.keys || []);
  ui.altLevels = ui.altLevels || {};
  const levelOf = (k) => ui.altLevels[k] ?? proposeLevels(pkg, chain, k, fixed[k], cfg).values.map((x) => String(x).replace('.', ',')).join('; ');
  const parsed = keysNext.map((k) => parseLevels(levelOf(k)));
  const count = parsed.reduce((p, x) => p * Math.max(1, x.values.length), keysNext.length ? 1 : 0);
  const step = (run.alt?.step || 1) + 1;
  const defName = `Alternada ${step} — ${keysNext.map((k) => byKey.get(k)?.label || k).join(' × ') || '?'}`;

  const custom = blk === 'custom' ? h('div', { class: 'row', style: { flexWrap: 'wrap', margin: '6px 0' } }, vars.filter((v) => fixed[v.key] != null).map((v) => checkField({ label: v.label, checked: keysNext.includes(v.key), onChange: (on) => { ui.altKeys = on ? [...keysNext, v.key] : keysNext.filter((k) => k !== v.key); ctx.rerender(); } }))) : null;

  const levelRows = keysNext.map((k, i) => {
    const v = byKey.get(k), p = proposeLevels(pkg, chain, k, fixed[k], cfg);
    const inp = h('input', { type: 'text', value: levelOf(k), style: { width: '100%' }, dataset: { k: `alt_lv_${k}` } });
    inp.addEventListener('change', () => { ui.altLevels[k] = inp.value; ctx.rerender(); });
    return h('tr', null, h('td', null, h('code', null, v?.label || k)), h('td', { class: 'num' }, `${fv(fixed[k], 5)} ${v?.unit || ''}`), h('td', { style: { minWidth: '220px' } }, inp),
      h('td', null, parsed[i].error ? badge(parsed[i].error, 'err') : h('small', { class: 'muted' }, `${parsed[i].values.length} nível(is) — ${ui.altLevels[k] != null ? 'editado' : p.why}`)));
  });

  const create = async () => {
    if (!keysNext.length) { toast('Escolha ao menos uma variável para variar.', true); return; }
    if (parsed.some((p) => p.error || !p.values.length)) { toast('Corrija os níveis antes de criar a rodada.', true); return; }
    if (count > LIMITS.max) { toast(`${count} pontos excedem o limite de ${LIMITS.max}.`, true); return; }
    if (count > LIMITS.confirm && !(await confirmBox('Rodada grande', `Gerar ${count} Design Points? Cada um é uma simulação CFD.`, 'Gerar'))) return;
    const name = (ui.altName || '').trim() || defName;
    const res = buildNextRun(pkg, run, chosen.dp, Object.fromEntries(keysNext.map((k) => [k, levelOf(k)])), { name, uid: () => uid('dp'), cfg });
    if (res.error) { toast(res.error, true); return; }
    store.update((s) => { pkg.runs.push(res.run); s.ui.active.runId = res.run.id; }, ['otimização alternada', name, 'rodada criada', `fixos do ${chosen.dp.name} de "${run.name}" (${met.label} = ${fv(chosen.v, 5)}); ${res.run.dps.length} DP(s)${res.removed ? `, ${res.removed} inválido(s) descartado(s)` : ''}`]);
    toast(`Rodada "${name}" criada com ${res.run.dps.length} DP(s)${res.removed ? ` (${res.removed} combinação(ões) descartada(s): ${res.removed - res.nGeo} pelas regras, ${res.nGeo} por erro de geometria)` : ''}. Ela já é a rodada ativa.`);
  };

  return card('Otimização alternada', intro, criteria, chainRow,
    h('h3', null, `Melhor DP de "${run.name}" por ${met.label}`), bestBox,
    h('h3', null, 'Próxima rodada'),
    h('div', { class: 'fields' }, selectField({ label: 'Variar na próxima rodada', value: blk, options: opts, onChange: (v) => { ui.altBlock = v; ui.altLevels = null; ctx.rerender(); }, hint: blocks.length ? `ordem da passada: ${blocks.map((b) => b.label).join(' → ')}` : null })),
    custom,
    keysNext.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Variável', 'Centro (valor fixo)', 'Níveis', 'Origem da proposta'].map((t) => h('th', null, t)))),
      h('tbody', null, levelRows))) : h('div', { class: 'empty' }, 'Escolha as variáveis da próxima rodada.'),
    h('p', { class: 'muted' }, 'As demais variáveis ficam fixas nos valores do DP escolhido. A rodada é criada no método fatorial, com as regras de validade e a verificação de geometria do pacote; a seleção ativa passa para ela.'),
    h('div', { class: 'fields' }, textField({ label: 'Nome da nova rodada', value: ui.altName || defName, key: 'alt_name', wide: true, onChange: (v) => { ui.altName = v; } })),
    h('div', { class: 'row' }, h('button', { class: 'primary', disabled: !keysNext.length || count > LIMITS.max || null, onclick: create }, `Criar próxima rodada e gerar ${count} DP(s)`)));
}
