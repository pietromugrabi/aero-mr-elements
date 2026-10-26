// Planejamento do método "Otimização alternada" (aba Inputs / Design Points): etapas dentro da
// rodada, cada uma com 1–2 variáveis e seus níveis; a etapa 1 é um fatorial (tabela como a planilha)
// e cada etapa seguinte cruza as variáveis novas com o máximo e os vizinhos da etapa anterior.

import { h, msgs, badge, selectField, numField, seg, confirmBox, toast, fv } from './dom.js';
import * as store from './store.js';
import { doeVariables, parseLevels, filterValidRows, makeDesignPoints, LIMITS } from '../core/doe.js';
import { uid } from '../core/model.js';
import { metricList } from '../core/outputs.js';
import { altConfig, CRITERIA, NEIGHBOR_MODES, stagesOf, stageDps, stageErrors, stageRows, stageCount, stageTable, carried, overallBest, stageEdges, keysUpTo } from '../core/alternada.js';

const SHOW = [['L', '|lift|'], ['Cl', 'Cl'], ['Cd', 'Cd'], ['ClCd', 'Cl/Cd']];

/** Tabela da etapa no formato da planilha: máximo em vermelho, vizinhos que seguem em verde. */
function stageTableEl(pkg, run, k, metric, info, labelOf, unitOf) {
  const T = stageTable(pkg, run, k, metric);
  const head = (ks, t) => (ks.length === 1 ? `${fv(t[0], 4)} ${unitOf(ks[0])}` : ks.map((key, i) => `${labelOf(key)} = ${fv(t[i], 4)}`).join(', '));
  const style = (c) => (!c ? null : info && c.dp.id === info.best.dp.id ? { background: 'var(--accent-soft)', fontWeight: '700', outline: '1px solid var(--accent)' } : info?.ids.has(c.dp.id) ? { background: 'var(--ok-soft)' } : null);
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, `${T.rowKeys.map(labelOf).join(', ')}${T.rowKeys.length ? ' ↓ / ' : ''}${T.colKeys.map(labelOf).join(', ')} →`), T.cols.map((t) => h('th', { class: 'num' }, head(T.colKeys, t))))),
    h('tbody', null, T.rows.map((rt, r) => h('tr', null, h('th', { style: { position: 'static' } }, T.rowKeys.length ? head(T.rowKeys, rt) : (metric === 'L' ? '|lift| [N]' : metric)),
      T.cols.map((_, c) => { const x = T.cells[r][c]; return h('td', { class: 'num', style: style(x), title: x ? `${x.dp.name}${x.v == null ? ': sem resultado' : ''}` : 'combinação não gerada' }, x ? (x.v == null ? '–' : fv(metric === 'L' ? Math.abs(x.v) : x.v, 5)) : ''); }))))));
}

export function altPlan(ctx, pkg, run, { base, pivotScaling }) {
  const ui = ctx.ui, doe = run.doe, cfg = altConfig(run);
  const vars = doeVariables(pkg), varKeys = vars.map((v) => v.key), byKey = new Map(vars.map((v) => [v.key, v]));
  const labelOf = (k) => byKey.get(k)?.label || k, unitOf = (k) => byKey.get(k)?.unit || '';
  const met = metricList(pkg.config.elements.length);
  const metLabel = (k) => met.find((m) => m.key === k)?.label || k;
  const stages = stagesOf(run);
  const upd = (fn, what, detail = '') => store.update(fn, ['DOE', run.name, what, String(detail)]);
  const setOpt = (k, v) => upd(() => { doe.altOpt = { ...altConfig(run), [k]: v }; }, `otimização alternada: ${k}`, v);
  ui.altShow = ui.altShow || {};

  const genStage = async (k) => {
    const errs = stageErrors(run, k, varKeys);
    if (errs.length) { toast(`Etapa ${k + 1}: ${errs.join('; ')}.`, true); return; }
    const r = stageRows(pkg, run, k, base, cfg);
    if (r.error) { toast(r.error, true); return; }
    if (r.rows.length > LIMITS.max) { toast(`${r.rows.length} pontos excedem o limite de ${LIMITS.max}.`, true); return; }
    if (r.rows.length > LIMITS.confirm && !(await confirmBox('Etapa grande', `Gerar ${r.rows.length} Design Points? Cada um é uma simulação CFD.`, 'Gerar'))) return;
    const old = run.dps.filter((d) => d.stage >= k);
    if (old.length) {
      const withRes = old.filter((d) => d.outputs).length, later = old.some((d) => d.stage > k);
      if (!(await confirmBox('Regerar etapa', `Substituir ${old.length} DP(s) da etapa ${k + 1}${later ? ' e das etapas seguintes (que dependem dela)' : ''}?${withRes ? ` ${withRes} têm resultados, que serão apagados.` : ''}`, 'Regerar', true))) return;
    }
    const s = filterValidRows(pkg, r.rows, { geometry: true, pivotScaling });
    if (!s.valid.length) { toast('Todas as combinações da etapa são inválidas (regras de corda/AoA ou erro de geometria). Ajuste os níveis.', true); return; }
    upd(() => {
      run.dps = run.dps.filter((d) => !(d.stage >= k));
      const dps = makeDesignPoints(pkg, s.valid, { pivotScaling, startIndex: run.dps.length, uid: () => uid('dp') });
      dps.forEach((d) => { d.stage = k; });
      run.dps.push(...dps);
      run.status = run.status === 'rascunho' ? 'em preparação' : run.status;
    }, `etapa ${k + 1} gerada`, `${s.valid.length} DP(s)${s.invalid.length ? `, ${s.invalid.length} inválido(s) descartado(s)` : ''}`);
    const nGeo = s.invalid.filter((x) => x.kind === 'geometria').length;
    toast(`Etapa ${k + 1}: ${s.valid.length} DP(s) gerado(s)${s.invalid.length ? ` (${s.invalid.length} combinação(ões) descartada(s): ${s.invalid.length - nGeo} pelas regras, ${nGeo} por erro de geometria)` : ''}. Rode no Fluent e importe os resultados para liberar a próxima etapa.`);
  };

  const stageEl = (st, k) => {
    const dps = stageDps(run, k), nRes = dps.filter((d) => d.outputs?.raw).length;
    const ks = (st.keys || []);
    const prev = k > 0 ? carried(pkg, run, k - 1, cfg) : null;
    const count = stageCount(pkg, run, k, cfg);
    const errs = stageErrors(run, k, varKeys);
    const status = dps.length ? badge(`${dps.length} DP(s), ${nRes} com resultado`, nRes === dps.length ? 'ok' : 'warn') : k > 0 && !prev ? badge('aguardando resultados da etapa anterior', 'warn') : badge('não gerada', '');
    const usedBefore = keysUpTo(run, k - 1);
    const opts = vars.map((v) => [v.key, `${v.label} — ${v.group}${usedBefore.includes(v.key) ? ' (já variada antes)' : ''}`]);
    const setKey = (i, v) => upd(() => { st.keys = [...(st.keys || [])]; st.keys[i] = v || undefined; st.keys = st.keys.filter((x, j) => x || j === 0); st.levels = st.levels || {}; }, `etapa ${k + 1}: variável ${i + 1}`, v);
    const levelInputs = ks.filter(Boolean).map((key) => {
      const p = parseLevels(st.levels?.[key]);
      const inp = h('input', { type: 'text', value: st.levels?.[key] || '', placeholder: 'ex.: 0; 2; 4; 6; 8  ou  0:2:8', style: { width: '100%' }, dataset: { k: `alt_${k}_${key}` } });
      inp.addEventListener('change', () => upd(() => { st.levels = { ...(st.levels || {}), [key]: inp.value }; }, `etapa ${k + 1}: níveis de ${labelOf(key)}`, inp.value));
      return h('tr', null, h('td', null, h('code', null, labelOf(key))), h('td', { class: 'num' }, base[key] == null ? '—' : `${fv(base[key], 4)} ${unitOf(key)}`), h('td', { style: { minWidth: '220px' } }, inp),
        h('td', null, p.error ? badge(p.error, 'err') : p.values.length ? `${p.values.length} nível(is)` : h('span', { class: 'muted' }, 'informe os níveis')));
    });

    const info = dps.length ? carried(pkg, run, k, cfg) : null;
    const show = ui.altShow[k] || cfg.metric;
    const notes = [];
    if (k > 0) notes.push(prev ? { level: 'info', msg: `Cruzada com ${prev.combos.length} combinação(ões) da etapa ${k} (máximo + vizinhos): ${prev.combos.map((c) => Object.entries(c.combo).map(([key, v]) => `${labelOf(key)}=${fv(v, 4)}`).join(', ')).join(' | ')}.` } : { level: 'aviso', msg: `Aguardando os resultados da etapa ${k}: gere, rode no Fluent e importe (aba Outputs). A etapa ${k + 1} usa o máximo e os vizinhos dela.` });
    if (info) {
      const b = info.best;
      notes.push({ level: 'ok', msg: `Máximo da etapa ${k + 1}: ${b.dp.name} — ${metLabel(cfg.metric)} = ${fv(b.v, 5)} (${keysUpTo(run, k).map((key) => `${labelOf(key)} = ${fv(b.dp.inputs[key], 4)}`).join(', ')}). ${info.combos.length} combinação(ões) (máximo + vizinhos, em verde) seguem para a próxima etapa.` });
      stageEdges(run, k, b.dp).forEach((e) => notes.push({ level: 'aviso', msg: `O máximo ficou na borda (${e.edge === 'min' ? 'mínimo' : 'máximo'}) dos níveis de ${labelOf(e.key)}: o ótimo pode estar fora da faixa testada. Considere ampliar os níveis e regerar a etapa.` }));
      if (info.nResults < info.nTotal) notes.push({ level: 'info', msg: `${info.nResults} de ${info.nTotal} DP(s) da etapa têm resultado ("–" na tabela); os demais não entram na escolha.` });
      if (dps.some((d) => d.outputs?.isExample)) notes.push({ level: 'aviso', msg: 'Há DADOS DE EXEMPLO (sintéticos) nesta etapa.' });
    }
    const canGen = !errs.length && (k === 0 || prev);
    return h('div', { class: 'card', style: { marginTop: '10px' } },
      h('div', { class: 'row', style: { alignItems: 'center' } }, h('h3', { style: { margin: 0 } }, `Etapa ${k + 1}`), status, h('span', { class: 'spacer' }),
        k === stages.length - 1 && k > 0 ? h('button', { class: 'small danger', onclick: async () => { if (dps.length && !(await confirmBox('Remover etapa', `Remover a etapa ${k + 1} e seus ${dps.length} DP(s)?`, 'Remover', true))) return; upd(() => { doe.stages = doe.stages.slice(0, k); run.dps = run.dps.filter((d) => d.stage !== k); }, `etapa ${k + 1} removida`); } }, 'Remover etapa') : null),
      h('div', { class: 'fields' },
        selectField({ label: k === 0 ? 'Variável 1 (linhas da tabela)' : 'Variável nova', value: ks[0] || '', options: [['', '— escolha —'], ...opts], onChange: (v) => setKey(0, v) }),
        selectField({ label: k === 0 ? 'Variável 2 (colunas da tabela)' : 'Outra variável nova (opcional)', value: ks[1] || '', options: [['', '— nenhuma —'], ...opts], onChange: (v) => setKey(1, v) })),
      levelInputs.length ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Variável', 'Referência', 'Níveis', ''].map((t) => h('th', null, t)))), h('tbody', null, levelInputs))) : null,
      msgs(notes),
      info ? h('div', null,
        h('div', { class: 'row', style: { margin: '8px 0' } }, h('span', { class: 'lbl' }, 'Tabela:'), seg(SHOW, show, (v) => { ui.altShow[k] = v; ctx.rerender(); }), h('small', { class: 'muted' }, 'vermelho = máximo do critério; verde = vizinhos que seguem; "–" = sem resultado')),
        stageTableEl(pkg, run, k, show, info, labelOf, unitOf)) : null,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: dps.length ? '' : 'primary', disabled: !canGen || null, onclick: () => genStage(k) }, `${dps.length ? 'Regerar' : 'Gerar'} etapa ${k + 1}${count != null ? ` (${count} DP(s))` : ''}`),
        errs.length && ks.some(Boolean) ? h('small', { class: 'muted' }, errs.join('; ')) : null));
  };

  const best = overallBest(pkg, run, cfg);
  const last = stages.length - 1;
  return h('div', null,
    h('p', { class: 'muted' }, 'Como a planilha: a etapa 1 é um fatorial de 1–2 variáveis (ex.: AoA_1 × AoA_2 com 5 níveis cada) e vira uma tabela. Cada etapa seguinte acrescenta outra variável (ex.: AoA_3 com 5 níveis) cruzada só com as melhores combinações da etapa anterior: o máximo do critério e seus vizinhos (um nível acima ou abaixo em cada variável). As variáveis fora das etapas ficam no valor de referência.'),
    h('div', { class: 'fields' },
      selectField({ label: 'Melhor resultado', value: cfg.metric, options: CRITERIA, onChange: (v) => setOpt('metric', v), hint: 'em módulo: downforce sai negativa no Fluent' }),
      selectField({ label: 'Seguem para a próxima etapa', value: cfg.neighbors, options: NEIGHBOR_MODES, onChange: (v) => setOpt('neighbors', v) }),
      cfg.neighbors === 'faixa' ? numField({ label: 'Faixa', unit: '% do máximo', value: cfg.band, key: 'alt_band', onChange: (v) => setOpt('band', Math.max(0, v ?? 2)) }) : null),
    stages.map(stageEl),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { disabled: !stageDps(run, last).length || null, title: stageDps(run, last).length ? '' : 'gere a etapa atual antes', onclick: () => upd(() => { doe.stages = [...doe.stages, { keys: [], levels: {} }]; }, `etapa ${stages.length + 1} adicionada`) }, '+ Adicionar etapa (outra variável)')),
    best ? msgs([{ level: 'ok', msg: `Melhor até agora: ${best.dp.name} (etapa ${best.dp.stage + 1}) — ${metLabel(cfg.metric)} = ${fv(best.v, 5)}; ${keysUpTo(run, stages.length - 1).map((key) => `${labelOf(key)} = ${fv(best.dp.inputs[key], 4)}`).join(', ')}.` }]) : null);
}
