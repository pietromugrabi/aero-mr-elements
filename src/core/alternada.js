// Método de DOE "Otimização alternada" (como a planilha "Otimização Alternada"), por etapas dentro
// da mesma rodada:
//   etapa 1: fatorial de 1–2 variáveis (ex.: AoA_1 × AoA_2, 5 níveis cada) → tabela como a planilha;
//   etapa k: entra outra variável (ex.: AoA_3, 5 níveis), cruzada só com as melhores combinações da
//            etapa anterior: o máximo do critério (|lift|, |Cl| ou |Cl|/Cd) e seus vizinhos
//            (cada variável a no máximo 1 nível de distância do máximo).
// Os DPs guardam dp.stage (0, 1, ...). Sem DOM.

import { computeDP, flatMetrics } from './outputs.js';
import { generateDesigns, parseLevels } from './doe.js';
import { referenceInputs } from './wing.js';

/** Critérios (sempre em módulo: downforce sai com sinal negativo no Fluent). */
export const CRITERIA = [['L', 'maior |lift| (Lift_force)'], ['Cl', 'maior |Cl| (Cl_total)'], ['ClCd', 'maior |Cl|/Cd']];
/** Quais vizinhos do máximo seguem para a próxima etapa. */
export const NEIGHBOR_MODES = [['todos', 'máximo + todos os vizinhos'], ['faixa', 'máximo + vizinhos a até a faixa % do máximo']];
export const DEFAULT_ALT = Object.freeze({ metric: 'Cl', neighbors: 'todos', band: 2 });

export function altConfig(run) {
  const c = { ...DEFAULT_ALT, ...(run?.doe?.altOpt || {}) };
  if (!CRITERIA.some(([k]) => k === c.metric)) c.metric = DEFAULT_ALT.metric;
  return c;
}

/** Valores fixos de uma rodada: referência do pacote + valores herdados (doe.base), se houver. */
export function runBase(pkg, run) { return { ...referenceInputs(pkg), ...(run?.doe?.base || {}) }; }

const r6 = (v) => +Number(v).toPrecision(6);
const uniq = (a) => [...new Set(a)];

export const stagesOf = (run) => run.doe.stages || [];
export const stageDps = (run, k) => run.dps.filter((d) => d.stage === k);

/** Variáveis das etapas 0..k (sem repetição, na ordem em que entraram). */
export function keysUpTo(run, k) { return uniq(stagesOf(run).slice(0, k + 1).flatMap((s) => s.keys || [])); }

/** Valor de uma métrica num DP (null sem resultado ou com status "falhou"). */
export function metricOf(pkg, dp, metric) {
  if (dp.status === 'falhou') return null;
  const c = computeDP(dp, pkg);
  if (!c.has) return null;
  const v = flatMetrics(c)[metric];
  return Number.isFinite(v) ? v : null;
}

/** DPs com resultado ordenados por |critério| (maior primeiro). */
export function rankDps(pkg, dps, metric) {
  return dps.map((dp) => ({ dp, v: metricOf(pkg, dp, metric) })).filter((x) => x.v != null).map((x) => ({ ...x, s: Math.abs(x.v) })).sort((a, b) => b.s - a.s);
}

/** Níveis usados (ordenados) de cada variável num conjunto de DPs. */
export function levelsUsed(dps, ks) {
  return Object.fromEntries(ks.map((k) => [k, uniq(dps.map((d) => Number(d.inputs[k])).filter(Number.isFinite).map(r6)).sort((a, b) => a - b)]));
}

/**
 * Melhores combinações da etapa k, que seguem para a etapa k+1: o máximo e seus vizinhos
 * (todas as variáveis das etapas 0..k a no máximo 1 nível do máximo; no modo 'faixa', só os
 * vizinhos com |critério| ≥ (1 − faixa%) · máximo).
 * @returns {null | {best, selected, combos:[{combo, dp, v}], keys, ranked, nResults, nTotal}}
 */
export function carried(pkg, run, k, cfg = altConfig(run)) {
  const dps = stageDps(run, k), ranked = rankDps(pkg, dps, cfg.metric);
  if (!ranked.length) return null;
  const ks = keysUpTo(run, k), lv = levelsUsed(dps, ks);
  const ix = (dp) => ks.map((key) => lv[key].indexOf(r6(dp.inputs[key])));
  const best = ranked[0], bi = ix(best.dp);
  const lim = cfg.neighbors === 'faixa' ? best.s * (1 - (Number(cfg.band) || 0) / 100) : -Infinity;
  const selected = ranked.filter((c) => c === best || (c.s >= lim && ix(c.dp).every((x, j) => Math.abs(x - bi[j]) <= 1)));
  const seen = new Set(), combos = [];
  selected.forEach((c) => {
    const combo = Object.fromEntries(ks.map((key) => [key, Number(c.dp.inputs[key])]));
    const id = ks.map((key) => r6(combo[key])).join('|');
    if (!seen.has(id)) { seen.add(id); combos.push({ combo, dp: c.dp, v: c.v }); }
  });
  return { best, selected, ids: new Set(selected.map((c) => c.dp.id)), combos, keys: ks, ranked, nResults: ranked.length, nTotal: dps.length };
}

/** Problemas de configuração de uma etapa (variáveis e níveis). */
export function stageErrors(run, k, varKeys) {
  const st = stagesOf(run)[k], out = [];
  const ks = (st?.keys || []).filter(Boolean);
  if (!ks.length) out.push('escolha a variável');
  if (uniq(ks).length < ks.length) out.push('variáveis repetidas');
  ks.forEach((key) => {
    if (varKeys && !varKeys.includes(key)) out.push(`${key} não existe neste pacote`);
    const p = parseLevels(st.levels?.[key]);
    if (p.error && !p.values.length) out.push(`${key}: ${p.error}`);
    else if (!p.values.length) out.push(`${key}: informe os níveis`);
  });
  return out;
}

/**
 * Linhas (entradas completas) da etapa k: etapa 0 = fatorial das suas variáveis; etapa k > 0 =
 * melhores combinações da etapa k−1 × fatorial das variáveis novas.
 */
export function stageRows(pkg, run, k, base, cfg = altConfig(run)) {
  const st = stagesOf(run)[k];
  const lv = Object.fromEntries((st.keys || []).filter(Boolean).map((key) => [key, st.levels?.[key] || '']));
  const grid = generateDesigns('fatorial', lv, {});
  if (k === 0) return { rows: grid.map((g) => ({ ...base, ...g })), prev: null };
  const prev = carried(pkg, run, k - 1, cfg);
  if (!prev) return { rows: [], prev: null, error: `A etapa ${k} ainda não tem resultados: rode os DPs no Fluent e importe (aba Outputs).` };
  return { rows: prev.combos.flatMap((c) => grid.map((g) => ({ ...base, ...c.combo, ...g }))), prev };
}

/** Nº de DPs previsto da etapa k (null se depende de resultados que ainda não existem). */
export function stageCount(pkg, run, k, cfg = altConfig(run)) {
  const st = stagesOf(run)[k];
  const n = (st.keys || []).filter(Boolean).reduce((p, key) => p * Math.max(1, parseLevels(st.levels?.[key]).values.length), 1);
  if (k === 0) return n;
  const prev = carried(pkg, run, k - 1, cfg);
  return prev ? prev.combos.length * n : null;
}

/**
 * Tabela no formato da planilha: etapa 0 com 2 variáveis = linhas da 1ª × colunas da 2ª;
 * etapa k > 0 = linhas = combinações vindas da etapa anterior, colunas = níveis das variáveis novas.
 * cells[r][c] = { dp, v } (v = valor da métrica pedida; null sem resultado) ou null se o DP não existe.
 */
export function stageTable(pkg, run, k, metric) {
  const st = stagesOf(run)[k], dps = stageDps(run, k);
  const nk = (st.keys || []).filter(Boolean);
  let rowKeys, colKeys;
  if (k === 0) { rowKeys = nk.length > 1 ? [nk[0]] : []; colKeys = nk.length > 1 ? nk.slice(1) : nk; }
  else { rowKeys = keysUpTo(run, k - 1).filter((key) => !nk.includes(key)); colKeys = nk; }
  const tuple = (d, ks) => ks.map((key) => r6(d.inputs[key]));
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const rowsT = uniq(dps.map((d) => JSON.stringify(tuple(d, rowKeys)))).map((s) => JSON.parse(s)).sort(cmp);
  const colsT = uniq(dps.map((d) => JSON.stringify(tuple(d, colKeys)))).map((s) => JSON.parse(s)).sort(cmp);
  const cells = rowsT.map(() => colsT.map(() => null));
  dps.forEach((d) => {
    const r = rowsT.findIndex((t) => cmp(t, tuple(d, rowKeys)) === 0), c = colsT.findIndex((t) => cmp(t, tuple(d, colKeys)) === 0);
    if (r >= 0 && c >= 0 && !cells[r][c]) cells[r][c] = { dp: d, v: metricOf(pkg, d, metric) };
  });
  return { rowKeys, colKeys, rows: rowsT, cols: colsT, cells };
}

/** Melhor DP de todas as etapas geradas (pelo critério). */
export function overallBest(pkg, run, cfg = altConfig(run)) {
  return rankDps(pkg, run.dps.filter((d) => d.stage != null), cfg.metric)[0] || null;
}

/** O máximo da etapa caiu na borda da faixa de alguma variável nova? [{key, edge:'min'|'max'}] */
export function stageEdges(run, k, bestDp) {
  const st = stagesOf(run)[k], dps = stageDps(run, k);
  return (st.keys || []).filter(Boolean).map((key) => {
    const lv = levelsUsed(dps, [key])[key], x = r6(bestDp.inputs[key]);
    return { key, edge: lv.length < 2 ? null : x <= lv[0] ? 'min' : x >= lv[lv.length - 1] ? 'max' : null };
  }).filter((e) => e.edge);
}
