// Otimização alternada (busca por blocos de coordenadas): cada rodada varia um bloco de variáveis
// numa grade (ex.: AoA_1 × AoA_2); o melhor DP pelo critério vira o ponto fixo da próxima rodada,
// que varia outro bloco (ex.: Gap_1 × Overlap_1). Uma passada percorre todos os blocos; as passadas
// seguintes refinam (passo pela metade) até a melhora ficar abaixo da tolerância.
// Sem DOM. As rodadas encadeadas guardam run.alt = { step, fromRunId, fromDpId, ... } e
// run.doe.base = valores fixos herdados do melhor DP.

import { computeDP, flatMetrics } from './outputs.js';
import { doeVariables, generateDesigns, filterValidRows, makeDesignPoints, LIMITS } from './doe.js';
import { referenceInputs, topologyOf, pairOf, isRelGap, keys } from './wing.js';
import { newRun } from './model.js';

export const DEFAULT_ALT = Object.freeze({ metric: 'Cl', goal: 'absmax', tol: 1, nLevels: 5 });
export const GOALS = [['absmax', 'maior |valor| (downforce, Cl < 0)'], ['max', 'maior valor'], ['min', 'menor valor']];
export const altConfig = (pkg) => ({ ...DEFAULT_ALT, ...(pkg.config.altOpt || {}) });

/** Pontuação (maior = melhor) de um valor pelo objetivo. */
export function score(v, goal) { return goal === 'absmax' ? Math.abs(v) : goal === 'min' ? -v : v; }

/** Valores fixos de uma rodada: referência do pacote + valores herdados do melhor DP anterior. */
export function runBase(pkg, run) { return { ...referenceInputs(pkg), ...(run?.doe?.base || {}) }; }

const r6 = (v) => +Number(v).toPrecision(6);

/** DPs com resultado ordenados pelo critério (exclui os marcados como "falhou"). */
export function rankRun(pkg, run, { metric, goal } = altConfig(pkg)) {
  const ranked = [];
  run.dps.forEach((dp) => {
    if (dp.status === 'falhou') return;
    const c = computeDP(dp, pkg);
    if (!c.has) return;
    const v = flatMetrics(c)[metric];
    if (Number.isFinite(v)) ranked.push({ dp, v, s: score(v, goal), stale: !!dp.outputsStale, example: !!dp.outputs?.isExample });
  });
  ranked.sort((a, b) => b.s - a.s);
  return { best: ranked[0] || null, ranked, nResults: ranked.length, nTotal: run.dps.length };
}

/** Variáveis do DOE que variam entre os DPs da rodada, com os níveis usados e o passo. */
export function variedVars(pkg, run) {
  return doeVariables(pkg).map((v) => {
    const lv = [...new Set(run.dps.map((d) => Number(d.inputs[v.key])).filter(Number.isFinite).map(r6))].sort((a, b) => a - b);
    const steps = lv.slice(1).map((x, i) => x - lv[i]);
    return { ...v, levels: lv, step: steps.length ? r6(Math.min(...steps)) : null };
  }).filter((v) => v.levels.length > 1);
}

/** O melhor valor de cada variável variada caiu na borda da faixa? ('min' | 'max' | null). */
export function edges(pkg, run, dp) {
  return variedVars(pkg, run).map((v) => {
    const x = r6(dp.inputs[v.key]);
    return { key: v.key, label: v.label, unit: v.unit, value: x, levels: v.levels, step: v.step, edge: x <= v.levels[0] ? 'min' : x >= v.levels[v.levels.length - 1] ? 'max' : null };
  });
}

/** Valores das variáveis do DOE no DP escolhido (passam a ser os fixos da próxima rodada). */
export function fixedFrom(pkg, dp) {
  const out = {};
  doeVariables(pkg).forEach((v) => { const x = Number(dp.inputs[v.key]); if (Number.isFinite(x)) out[v.key] = x; });
  return out;
}

/** Rodadas da cadeia até esta (mais antiga primeiro), seguindo run.alt.fromRunId no pacote. */
export function chainOf(pkg, run) {
  const out = [], seen = new Set();
  let r = run;
  while (r && !seen.has(r.id)) { out.unshift(r); seen.add(r.id); r = r.alt?.fromRunId ? pkg.runs.find((x) => x.id === r.alt.fromRunId) : null; }
  return out;
}

/**
 * Blocos sugeridos, na ordem da passada: para cada elemento posicionado n (com ref r):
 * AoA_r × AoA_n e depois Gap × Overlap do par. Corda fica de fora (pode ser escolhida à mão).
 */
export function suggestedBlocks(pkg) {
  const tp = topologyOf(pkg), vars = doeVariables(pkg), byKey = new Map(vars.map((v) => [v.key, v]));
  const blocks = [];
  pkg.config.elements.forEach((el, i) => {
    const n = i + 1, pr = pairOf(pkg, n);
    if (!pr) return;
    const a = [keys.aoa(tp.refs[i] + 1), keys.aoa(n)].filter((k) => byKey.has(k));
    if (a.length) blocks.push(a);
    const g = (isRelGap(el) ? [keys.gapc(n), keys.overlapc(n)] : [keys.gap(n), keys.overlap(n)]).filter((k) => byKey.has(k));
    if (g.length) blocks.push(g);
  });
  return blocks.map((ks) => ({ keys: ks, label: ks.map((k) => byKey.get(k).label).join(' × ') }));
}

/** Próximo bloco da passada depois do bloco variado nesta rodada (o primeiro, se não houver). */
export function nextBlockIndex(pkg, run) {
  const bl = suggestedBlocks(pkg);
  if (!bl.length) return -1;
  const varied = new Set(variedVars(pkg, run).map((v) => v.key));
  const cur = bl.findIndex((b) => b.keys.length === varied.size && b.keys.every((k) => varied.has(k)));
  return cur < 0 ? 0 : (cur + 1) % bl.length;
}

/** Passo padrão de uma variável que ainda não foi variada na cadeia. */
export function defaultStep(v) {
  const r = Math.abs(Number(v.ref)) || 0;
  if (v.unit === '°') return 2;
  if (v.unit === 'x/c') return 0.01;
  if (/^chord_/.test(v.key)) return r6(Math.max(1, 0.05 * r));
  if (v.unit === 'mm') return 2;
  return r6(0.1 * r || 1);
}

const positiveOnly = (k) => /^(chord|Gap)_/.test(k) || /^gurney_(h|t)_/.test(k);

/** n níveis centrados em c com passo s; n par vira ímpar para o centro ser testado (valores ≤ 0 descartados nas variáveis que não admitem). */
export function levelsAround(key, c, s, n) {
  const out = [];
  if (n % 2 === 0) n += 1;
  for (let i = 0; i < n; i++) out.push(r6(c + (i - (n - 1) / 2) * s));
  return out.filter((x) => !positiveOnly(key) || x > 0);
}

/**
 * Proposta de níveis para uma variável na próxima rodada, centrada no valor fixo:
 *  - nunca variada na cadeia → nLevels níveis com o passo padrão;
 *  - variada antes, ótimo na borda → mesma malha (recentrada, estende a faixa);
 *  - variada antes, ótimo no interior → refino: 3 níveis com metade do passo.
 */
export function proposeLevels(pkg, chain, key, center, cfg = altConfig(pkg)) {
  const v = doeVariables(pkg).find((x) => x.key === key);
  if (!v || !Number.isFinite(center)) return { values: [], why: 'sem valor de partida' };
  for (let i = chain.length - 1; i >= 0; i--) {
    const vv = variedVars(pkg, chain[i]).find((x) => x.key === key);
    if (!vv || !vv.step) continue;
    const b = rankRun(pkg, chain[i], cfg).best;
    const e = b ? edges(pkg, chain[i], b.dp).find((x) => x.key === key) : null;
    if (e?.edge) return { values: levelsAround(key, center, vv.step, Math.max(3, vv.levels.length)), why: `ótimo na borda (${e.edge === 'min' ? 'mínimo' : 'máximo'}) em "${chain[i].name}": faixa recentrada` };
    return { values: levelsAround(key, center, r6(vv.step / 2), 3), why: `refino: metade do passo de "${chain[i].name}"` };
  }
  return { values: levelsAround(key, center, defaultStep(v), cfg.nLevels), why: 'primeira vez na cadeia: passo padrão' };
}

/** Melhora (%) do melhor desta rodada em relação ao melhor da rodada de origem. */
export function improvement(pkg, run, cfg = altConfig(pkg)) {
  const from = run.alt?.fromRunId ? pkg.runs.find((x) => x.id === run.alt.fromRunId) : null;
  if (!from) return null;
  const a = rankRun(pkg, from, cfg).best, b = rankRun(pkg, run, cfg).best;
  if (!a || !b || !a.s) return null;
  return { from, pct: (100 * (b.s - a.s)) / Math.abs(a.s), prev: a, cur: b };
}

/**
 * Cria a próxima rodada da cadeia: valores fixos = DP escolhido, níveis = os informados (fatorial),
 * DPs já gerados com as regras de validade e a verificação de geometria do pacote.
 * @returns {{run, removed, nGeo, error?}}
 */
export function buildNextRun(pkg, run, dp, levels, { name, uid, cfg = altConfig(pkg) } = {}) {
  const fixed = fixedFrom(pkg, dp);
  const b = rankRun(pkg, run, cfg).ranked.find((x) => x.dp === dp);
  const nr = newRun(name || `Alternada ${(run.alt?.step || 1) + 1}`);
  const pivotScaling = run.doe?.pivotScaling !== false;
  nr.doe = { method: 'fatorial', levels: Object.fromEntries(Object.entries(levels).filter(([, v]) => String(v).trim())), base: fixed, pivotScaling };
  nr.alt = { step: (run.alt?.step || 1) + 1, fromRunId: run.id, fromRunName: run.name, fromDpId: dp.id, fromDpName: dp.name, metric: cfg.metric, goal: cfg.goal, value: b ? b.v : null };
  nr.notes = `Otimização alternada, passo ${nr.alt.step}: valores fixos do ${dp.name} de "${run.name}"${b ? ` (${cfg.metric} = ${r6(b.v)})` : ''}.`;
  const base = { ...referenceInputs(pkg), ...fixed };
  const rows = generateDesigns('fatorial', nr.doe.levels, base);
  if (rows.length > LIMITS.max) return { run: null, removed: 0, nGeo: 0, error: `${rows.length} pontos excedem o limite.` };
  const s = filterValidRows(pkg, rows, { geometry: true, pivotScaling });
  if (!s.valid.length) return { run: null, removed: s.invalid.length, nGeo: 0, error: 'Todas as combinações são inválidas (regras de corda/AoA ou erro de geometria). Ajuste os níveis.' };
  nr.dps = makeDesignPoints(pkg, s.valid, { pivotScaling, uid });
  nr.status = 'em preparação';
  if (!run.alt) run.alt = { step: 1 }; // marca o início da cadeia
  return { run: nr, removed: s.invalid.length, nGeo: s.invalid.filter((x) => x.kind === 'geometria').length, invalid: s.invalid };
}
