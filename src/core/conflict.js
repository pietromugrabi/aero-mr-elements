// Mapa de conflito: varre 2 variáveis de entrada numa grade (demais no valor de referência) e
// classifica cada ponto pela montagem 2D do próprio app:
//   'erro'  = elementos se atravessando, auto-interseção ou cota inválida (DS_ ≤ 0);
//   'aviso' = monta, mas com folga da fenda abaixo do mínimo, pivô fora do perfil etc.;
//   'regra' = viola as regras do DOE (flap com corda maior / AoA menor que o anterior);
//   'ok'    = sem problemas.

import { buildWing, withDerivedPivots, referenceInputs } from './wing.js';
import { doeVariables, dpViolations } from './doe.js';

/** Variáveis que podem ser eixos do mapa (exclui liga/desliga do Gurney e Uinf, que não mudam a geometria). */
export function conflictVariables(pkg) {
  return doeVariables(pkg).filter((v) => v.key !== 'Uinf' && !/^gurney_on_/.test(v.key));
}

/** Faixa padrão de um eixo a partir do valor de referência. */
export function defaultRange(v) {
  const r = Number(v.ref);
  if (v.ref == null || !Number.isFinite(r)) return { min: null, max: null };
  if (v.unit === '°') return { min: r - 10, max: r + 10 };
  if (v.unit === 'x/c') return { min: +(Math.max(0.001, r * 0.25)).toPrecision(4), max: +(r * 2 || 0.05).toPrecision(4) };
  if (/^chord_/.test(v.key)) return { min: +(r * 0.7).toPrecision(5), max: +(r * 1.3).toPrecision(5) };
  return { min: +(Math.max(0.1, r * 0.25)).toPrecision(4), max: +(r * 2 || 10).toPrecision(4) };
}

const linspace = (a, b, n) => (n <= 1 ? [a] : Array.from({ length: n }, (_, i) => +(a + ((b - a) * i) / (n - 1)).toPrecision(10)));

/** Avalia um ponto (entradas completas, sem derivados). */
export function evalPoint(pkg, inputs, pivotScaling = true) {
  const inp = withDerivedPivots(pkg, inputs, pivotScaling);
  const rule = dpViolations(pkg, inp);
  let w;
  try { w = buildWing(pkg, inp); } catch (e) { return { status: 'erro', msgs: [e.message], clearance: null }; }
  if (!w.plane) return { status: 'erro', msgs: w.errors, clearance: null };
  const errs = w.asm.checks.filter((c) => c.level === 'erro').map((c) => c.msg);
  const warns = w.asm.checks.filter((c) => c.level === 'aviso').map((c) => c.msg);
  const cl = w.asm.slots.map((s) => s.clearance).filter(Number.isFinite);
  const clearance = cl.length ? Math.min(...cl) : null;
  const status = errs.length ? 'erro' : rule.length ? 'regra' : warns.length ? 'aviso' : 'ok';
  return { status, msgs: [...errs, ...rule.map((m) => `regra do DOE: ${m}`), ...warns], clearance };
}

/**
 * Prepara a grade. A avaliação é feita por evalCell (em lotes, para não travar a interface).
 * @returns {{xs, ys, cells: (null|{status,msgs,clearance})[][], base}}
 */
export function makeGrid(pkg, { x, y, nx = 25, ny = 25 }) {
  const base = referenceInputs(pkg);
  return { xKey: x.key, yKey: y.key, xs: linspace(Number(x.min), Number(x.max), nx), ys: linspace(Number(y.min), Number(y.max), ny), cells: Array.from({ length: ny }, () => Array(nx).fill(null)), base };
}

export function evalCell(pkg, grid, i, j, pivotScaling = true) {
  const inp = { ...grid.base, [grid.xKey]: grid.xs[i], [grid.yKey]: grid.ys[j] };
  grid.cells[j][i] = evalPoint(pkg, inp, pivotScaling);
  return grid.cells[j][i];
}

/** Avalia a grade inteira de uma vez (testes / grades pequenas). */
export function conflictMap(pkg, opts, pivotScaling = true) {
  const g = makeGrid(pkg, opts);
  g.ys.forEach((_, j) => g.xs.forEach((__, i) => evalCell(pkg, g, i, j, pivotScaling)));
  return g;
}

/** Contagem por status e faixas sem erro ao longo de uma linha/coluna da grade. */
export function summarize(grid) {
  const count = { ok: 0, aviso: 0, regra: 0, erro: 0, pendente: 0 };
  grid.cells.flat().forEach((c) => { count[c ? c.status : 'pendente']++; });
  return count;
}

/** Intervalos contíguos de valores com status aceito numa sequência [{v, status}]. */
export function validRuns(seq, accept = ['ok', 'aviso']) {
  const runs = [];
  let cur = null;
  seq.forEach(({ v, status }) => {
    if (accept.includes(status)) { if (!cur) { cur = { from: v, to: v }; runs.push(cur); } else cur.to = v; }
    else cur = null;
  });
  return runs;
}
