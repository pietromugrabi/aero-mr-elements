// Dados para gráficos: coleta de registros (DP × métricas), filtros, séries, mapa de calor,
// superfície de resposta e ranking. Sem DOM.

import { computeDP, flatMetrics } from './outputs.js';
import { referenceValues } from './fluent.js';
import { gurneyConfigured, keys } from './wing.js';

/** Gurney ativo em algum elemento neste DP (gurney_on_n do DP ou, na falta, o estado do pacote). */
export function gurneyOn(pkg, inputs = {}) {
  return pkg.config.elements.some((e, i) => { if (!gurneyConfigured(e)) return false; const v = Number(inputs[keys.gon(i + 1)]); return Number.isFinite(v) ? v >= 0.5 : !!e.gurney.enabled; });
}

/** Achata o projeto em registros: um por DP (com ou sem resultado). */
export function collectRecords(project, opts = {}) {
  const recs = [];
  (project?.packages || []).forEach((pkg) => {
    pkg.runs.forEach((run) => {
      run.dps.forEach((dp) => {
        const c = computeDP(dp, pkg, opts);
        const ref = c.ref || referenceValues(pkg, dp.inputs);
        recs.push({
          pkgId: pkg.id, pkgName: pkg.name, runId: run.id, runName: run.name, dpId: dp.id, dpName: dp.name,
          gurney: gurneyOn(pkg, dp.inputs) ? 'com Gurney' : 'sem Gurney', isExample: !!dp.outputs?.isExample, hasResult: c.has,
          nElements: pkg.config.elements.length, profiles: pkg.config.elements.map((e) => e.profileName).join(' / '),
          inputs: { ...dp.inputs }, metrics: c.has ? flatMetrics(c) : {}, flags: c.flags,
          ref: { rho: ref.rho, Aref: ref.Aref, arefBasis: pkg.config.fluent.arefBasis, arefMode: pkg.config.fluent.arefMode, mode: pkg.config.mode, depth: ref.depth },
        });
      });
    });
  });
  return recs;
}

/** Valor de uma variável: entrada (chord_1...), métrica (Cl...), ou meta (gurney, pacote, rodada). */
export function valueOf(rec, key) {
  if (key in rec.metrics) return rec.metrics[key];
  if (key in rec.inputs) return Number(rec.inputs[key]);
  if (key === 'pacote') return rec.pkgName;
  if (key === 'rodada') return rec.runName;
  if (key === 'gurney') return rec.gurney;
  if (key === 'dp') return rec.dpName;
  return undefined;
}

/** filters: { packages:[], runs:[], ranges:{key:[min,max]}, values:{key:[v...]}, onlyWithResults } */
export function filterRecords(recs, f = {}) {
  return recs.filter((r) => {
    if (f.onlyWithResults !== false && !r.hasResult) return false;
    if (f.packages?.length && !f.packages.includes(r.pkgId)) return false;
    if (f.runs?.length && !f.runs.includes(r.runId)) return false;
    for (const [k, rg] of Object.entries(f.ranges || {})) {
      const v = valueOf(r, k);
      if (rg[0] != null && Number.isFinite(rg[0]) && !(v >= rg[0] - 1e-12)) return false;
      if (rg[1] != null && Number.isFinite(rg[1]) && !(v <= rg[1] + 1e-12)) return false;
    }
    return true;
  });
}

const fmtV = (v) => (typeof v === 'number' ? +v.toPrecision(6) : v);

/** Variáveis de entrada que variam dentro de um conjunto de registros (exceto as ignoradas). */
export function varyingInputs(recs, ignore = []) {
  const ks = new Set(recs.flatMap((r) => Object.keys(r.inputs)));
  const out = [];
  ks.forEach((k) => {
    if (ignore.includes(k) || /^pivot_/.test(k)) return;
    const vals = new Set(recs.map((r) => String(fmtV(Number(r.inputs[k])))));
    if (vals.size > 1) out.push(k);
  });
  return out;
}

/**
 * Sensibilidade (dados do gráfico de Pareto): efeito de cada entrada que varia sobre |métrica|.
 * O efeito compara só DPs iguais em todas as outras entradas (amplitude dentro de cada grupo, com
 * média entre os grupos); assim vale para variar um parâmetro por vez e para fatoriais. Se não
 * houver DPs comparáveis, usa a diferença entre as médias por nível (mode 'médias').
 * @returns [{key, effect, pct, cum, n, mode}] do maior para o menor efeito
 */
export function sensitivity(recs, metric, { ignore = ['Uinf'] } = {}) {
  const keys = varyingInputs(recs, ignore);
  const pts = recs.map((r) => ({ r, y: Math.abs(valueOf(r, metric)) })).filter((p) => Number.isFinite(p.y));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const level = (r, k) => fmtV(Number(r.inputs[k]));
  const rows = keys.map((key) => {
    const others = keys.filter((k) => k !== key);
    const groups = new Map();
    pts.forEach((p) => { const sig = others.map((k) => level(p.r, k)).join('|'); if (!groups.has(sig)) groups.set(sig, []); groups.get(sig).push(p); });
    const ranges = [...groups.values()].filter((g) => new Set(g.map((p) => level(p.r, key))).size > 1).map((g) => { const ys = g.map((p) => p.y); return Math.max(...ys) - Math.min(...ys); });
    if (ranges.length) return { key, effect: mean(ranges), n: ranges.length, mode: 'pares' };
    const lv = new Map();
    pts.forEach((p) => { const x = level(p.r, key); if (!lv.has(x)) lv.set(x, []); lv.get(x).push(p.y); });
    const ms = [...lv.values()].map(mean);
    return { key, effect: ms.length > 1 ? Math.max(...ms) - Math.min(...ms) : 0, n: ms.length, mode: 'médias' };
  }).sort((a, b) => b.effect - a.effect);
  const total = rows.reduce((s, r) => s + r.effect, 0);
  let acc = 0;
  return rows.map((r) => { const pct = total > 0 ? (r.effect / total) * 100 : 0; acc += pct; return { ...r, pct, cum: acc }; });
}

/**
 * Séries para gráfico XY. perElement: y é família ('Cl', 'L'...) → uma série por elemento (+ total).
 * Avisos de condições incompatíveis: entradas que variam dentro de uma série, valores de referência
 * diferentes, mistura de dados de exemplo com dados reais e pacotes com nº de elementos diferente.
 */
export function buildSeries(recs, { x, y, groupBy = null, perElement = false, includeTotal = true, nameOf = (k) => k }) {
  const warnings = [];
  const groups = new Map();
  recs.forEach((r) => {
    const g = groupBy ? `${groupBy === 'pacote' || groupBy === 'rodada' || groupBy === 'gurney' ? '' : nameOf(groupBy) + ' = '}${fmtV(valueOf(r, groupBy))}` : 'todos';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  });
  const series = [];
  const nEl = Math.max(0, ...recs.map((r) => r.nElements));
  groups.forEach((rs, g) => {
    const ys = perElement ? [...(includeTotal ? [{ key: y, label: `${y} total` }] : []), ...Array.from({ length: nEl }, (_, i) => ({ key: `${y}_${i + 1}`, label: `${y} el. ${i + 1}` }))] : [{ key: y, label: y }];
    ys.forEach((yy) => {
      const pts = rs.map((r) => ({ x: valueOf(r, x), y: valueOf(r, yy.key), rec: r }))
        .filter((p) => typeof p.x === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x);
      if (pts.length) series.push({ name: groups.size > 1 || !perElement ? (perElement ? `${g} · ${yy.label}` : g) : yy.label, group: g, yKey: yy.key, points: pts });
    });
    const vary = varyingInputs(rs, [x, groupBy].filter(Boolean));
    if (vary.length) warnings.push(`Série "${g}": os pontos também diferem em ${vary.map(nameOf).join(', ')} —a curva mistura condições diferentes (use filtros ou agrupe por uma dessas variáveis).`);
    const xs = rs.map((r) => valueOf(r, x)).filter((v) => typeof v === 'number');
    const dupX = xs.length - new Set(xs.map((v) => v.toPrecision(8))).size;
    if (dupX > 0 && !vary.length) warnings.push(`Série "${g}": ${dupX} ponto(s) com o mesmo X — possíveis DPs duplicados.`);
  });
  refWarnings(recs).forEach((w) => warnings.push(w));
  return { series, warnings };
}

export function refWarnings(recs) {
  const w = [];
  const uniq = (f) => new Set(recs.map(f));
  if (uniq((r) => r.ref.rho).size > 1) w.push('Registros com densidades (ρ) diferentes.');
  if (uniq((r) => `${r.ref.arefBasis}|${r.ref.arefMode}`).size > 1) w.push('Registros com convenções de A_ref diferentes: coeficientes não comparáveis diretamente.');
  if (uniq((r) => r.ref.mode).size > 1) w.push('Mistura de casos 2D e 3D.');
  if (uniq((r) => r.nElements).size > 1) w.push('Pacotes com número de elementos diferente.');
  if (uniq((r) => r.isExample).size > 1) w.push('Mistura de DADOS DE EXEMPLO com resultados importados.');
  if (uniq((r) => r.gurney).size > 1) w.push('Mistura de configurações com e sem Gurney (agrupe por "gurney" para separar).');
  return w;
}

/** Mapa de calor: uma célula por par (x, y). Várias DPs na mesma célula são sinalizadas (não há média). */
export function heatmapGrid(recs, { x, y, z }) {
  const xs = [...new Set(recs.map((r) => valueOf(r, x)).filter(Number.isFinite))].sort((a, b) => a - b);
  const ys = [...new Set(recs.map((r) => valueOf(r, y)).filter(Number.isFinite))].sort((a, b) => a - b);
  const cells = new Map();
  recs.forEach((r) => {
    const vx = valueOf(r, x), vy = valueOf(r, y), vz = valueOf(r, z);
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return;
    const k = `${vx}|${vy}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push({ z: vz, rec: r });
  });
  const warnings = [];
  let conflicts = 0;
  const grid = ys.map((vy) => xs.map((vx) => {
    const c = cells.get(`${vx}|${vy}`);
    if (!c) return null;
    if (c.length > 1) conflicts++;
    const zs = c.map((e) => e.z);
    return { z: c[0].z, min: Math.min(...zs), max: Math.max(...zs), n: c.length, recs: c.map((e) => e.rec) };
  }));
  if (conflicts) {
    const vary = varyingInputs(recs, [x, y]);
    warnings.push(`${conflicts} célula(s) com mais de um DP (variam: ${vary.join(', ') || '—'}). A cor mostra o 1º DP; nenhum valor é média. Filtre as demais variáveis.`);
  }
  return { xs, ys, grid, warnings };
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Superfície de resposta quadrática z = a + b·u + c·v + d·u² + e·v² + f·u·v (u, v normalizados em [−1,1]).
 * Exige ≥ 6 pontos distintos, ≥ 3 níveis em cada eixo.
 */
export function fitResponseSurface(points) {
  const xs = new Set(points.map((p) => p.x)), ys = new Set(points.map((p) => p.y));
  if (points.length < 6 || xs.size < 3 || ys.size < 3) return { ok: false, reason: 'São necessários ≥ 6 pontos com ≥ 3 níveis em X e em Y.' };
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const nu = (x) => (2 * (x - xmin)) / (xmax - xmin) - 1, nv = (y) => (2 * (y - ymin)) / (ymax - ymin) - 1;
  const basis = (x, y) => { const u = nu(x), v = nv(y); return [1, u, v, u * u, v * v, u * v]; };
  const A = Array.from({ length: 6 }, () => Array(6).fill(0)), b = Array(6).fill(0);
  points.forEach((p) => { const f = basis(p.x, p.y); for (let i = 0; i < 6; i++) { b[i] += f[i] * p.z; for (let j = 0; j < 6; j++) A[i][j] += f[i] * f[j]; } });
  const coef = solve(A, b);
  if (!coef) return { ok: false, reason: 'Sistema mal condicionado (pontos colineares?).' };
  const predict = (x, y) => basis(x, y).reduce((s, f, i) => s + f * coef[i], 0);
  const mean = points.reduce((s, p) => s + p.z, 0) / points.length;
  const ssTot = points.reduce((s, p) => s + (p.z - mean) ** 2, 0), ssRes = points.reduce((s, p) => s + (p.z - predict(p.x, p.y)) ** 2, 0);
  return { ok: true, coef, predict, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, range: { xmin, xmax, ymin, ymax }, n: points.length };
}

export function ranking(recs, metric, { desc = true, limit = 20 } = {}) {
  return recs.map((r) => ({ rec: r, v: valueOf(r, metric) })).filter((e) => Number.isFinite(e.v))
    .sort((a, b) => (desc ? b.v - a.v : a.v - b.v)).slice(0, limit);
}
