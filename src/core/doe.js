// Planejamento de experimentos (Design Points): variáveis, níveis, fatorial completo,
// um fator por vez (OAT), duplicatas e pivôs derivados da corda.

import { parseNum } from './num.js';
import { keys, withDerivedPivots, referenceInputs, topologyOf, pairOf, gurneyConfigured } from './wing.js';

export const LIMITS = Object.freeze({ warn: 100, confirm: 1000, max: 20000 });

/** Variáveis de entrada do pacote, agrupadas por elemento. */
export function doeVariables(pkg) {
  const vars = [];
  const tp = topologyOf(pkg);
  pkg.config.elements.forEach((el, i) => {
    const n = i + 1, kind = tp.kinds[i], g = `Elemento ${n}${kind !== 'flap' ? ` (${kind})` : ''}`;
    vars.push({ key: keys.chord(n), label: `chord_${n}`, unit: 'mm', group: g, element: n, ref: el.chord_ref });
    vars.push({ key: keys.aoa(n), label: `AoA_${n}`, unit: '°', group: g, element: n, ref: el.aoa_ref });
    const pr = pairOf(pkg, n);
    if (pr) {
      const note = `${pr.kind !== 'flap' ? pr.kind + ' ' : ''}par ${pr.a}–${pr.b}${pr.anchor === 'ba' ? ' (Overlap = stagger a partir do BA)' : ''}`;
      vars.push({ key: keys.gap(n), label: `Gap_${n}`, unit: 'mm', group: g, element: n, ref: el.gap_ref, note });
      vars.push({ key: keys.overlap(n), label: `Overlap_${n}`, unit: 'mm', group: g, element: n, ref: el.overlap_ref, note });
    }
    if (gurneyConfigured(el)) {
      vars.push({ key: keys.gon(n), label: `gurney_on_${n}`, unit: '0/1', group: g, element: n, ref: el.gurney.enabled ? 1 : 0, note: '0 = sem, 1 = com Gurney' });
      vars.push({ key: keys.gh(n), label: `gurney_h_${n}`, unit: 'mm', group: g, element: n, ref: el.gurney.h });
      vars.push({ key: keys.gt(n), label: `gurney_t_${n}`, unit: 'mm', group: g, element: n, ref: el.gurney.t });
      vars.push({ key: keys.gpos(n), label: `gurney_pos_${n}`, unit: 'mm', group: g, element: n, ref: Number(el.gurney.pos) || 0, note: 'distância ao BF' });
    }
  });
  vars.push({ key: 'Uinf', label: 'Uinf', unit: 'm/s', group: 'Escoamento', element: null, ref: pkg.config.fluent.Uinf });
  return vars;
}

/** Colunas derivadas (somente leitura) exibidas na tabela. */
export function derivedColumns(pkg) {
  const out = [];
  pkg.config.elements.forEach((_, i) => {
    out.push({ key: keys.off(i + 1), label: `pivot_off_${i + 1}`, unit: 'mm', group: `Elemento ${i + 1}`, element: i + 1, derived: true });
    out.push({ key: keys.dte(i + 1), label: `pivot_dTE_${i + 1}`, unit: 'mm', group: `Elemento ${i + 1}`, element: i + 1, derived: true });
  });
  return out;
}

/**
 * Lê níveis: "3; 5; 7" | "3 5 7" | "3, 5, 7" | "3,5 4,5" (vírgula decimal) | "início:passo:fim".
 * @returns {{values:number[], error:string|null}}
 */
export function parseLevels(str) {
  const s = String(str ?? '').trim();
  if (!s) return { values: [], error: null };
  if (s.includes(':')) {
    const p = s.split(':').map((x) => parseNum(x.trim()));
    if (p.length !== 3 || p.some((x) => !Number.isFinite(x))) return { values: [], error: 'Use início:passo:fim (ex.: 0:5:30).' };
    const [a, step, b] = p;
    if (step === 0 || Math.sign(b - a) * Math.sign(step) < 0) return { values: [], error: 'Passo incompatível com o intervalo.' };
    const nn = Math.floor((b - a) / step + 1e-9) + 1;
    if (nn > 1000) return { values: [], error: 'Mais de 1000 níveis.' };
    return { values: Array.from({ length: nn }, (_, i) => +(a + i * step).toPrecision(12)), error: null };
  }
  let toks;
  if (s.includes(';')) toks = s.split(';');
  else if (/\s/.test(s)) toks = s.split(/\s+/).map((t) => t.replace(/,$/, ''));
  else if ((s.match(/,/g) || []).length > 1) toks = s.split(',');
  else toks = [s];
  const vals = [], bad = [];
  toks.map((t) => t.trim()).filter(Boolean).forEach((t) => { const v = parseNum(t); if (Number.isFinite(v)) vals.push(v); else bad.push(t); });
  const uniq = [...new Set(vals)];
  const err = bad.length ? `Valores inválidos: ${bad.join(', ')}` : uniq.length < vals.length ? 'Níveis repetidos foram removidos.' : null;
  return { values: uniq, error: err };
}

function levelsOf(levelsByKey) {
  const m = {};
  Object.entries(levelsByKey || {}).forEach(([k, v]) => { const r = Array.isArray(v) ? { values: v } : parseLevels(v); if (r.values.length) m[k] = r.values; });
  return m;
}

/** Número de pontos antes de gerar. */
export function countDesigns(method, levelsByKey, baseline) {
  const L = levelsOf(levelsByKey);
  const ks = Object.keys(L);
  if (method === 'fatorial') return ks.length ? ks.reduce((p, k) => p * L[k].length, 1) : 1;
  if (method === 'oat') return 1 + ks.reduce((s, k) => s + L[k].filter((v) => v !== Number(baseline[k])).length, 0);
  return 0;
}

/** Gera as linhas de entrada (sem pivôs derivados). */
export function generateDesigns(method, levelsByKey, baseline) {
  const L = levelsOf(levelsByKey);
  const ks = Object.keys(L);
  const base = { ...baseline };
  const n = countDesigns(method, levelsByKey, baseline);
  if (n > LIMITS.max) throw new Error(`${n} pontos excedem o limite de ${LIMITS.max}. Reduza os níveis.`);
  if (method === 'fatorial') {
    let rows = [base];
    ks.forEach((k) => { const next = []; rows.forEach((r) => L[k].forEach((v) => next.push({ ...r, [k]: v }))); rows = next; });
    return rows;
  }
  if (method === 'oat') {
    const rows = [base];
    ks.forEach((k) => L[k].forEach((v) => { if (v !== Number(base[k])) rows.push({ ...base, [k]: v }); }));
    return rows;
  }
  return [];
}

export function rowKey(row, ks) { return ks.map((k) => { const v = Number(row[k]); return Number.isFinite(v) ? v.toPrecision(10) : String(row[k] ?? ''); }).join('|'); }

/** Índices de linhas duplicadas: Map(índice → índice da primeira ocorrência). */
export function findDuplicates(rows, ks) {
  const first = new Map(), dup = new Map();
  rows.forEach((r, i) => { const k = rowKey(r, ks); if (first.has(k)) dup.set(i, first.get(k)); else first.set(k, i); });
  return dup;
}

/** Converte linhas em Design Points, com pivôs escalados pela corda (referências inalteradas). */
export function makeDesignPoints(pkg, rows, { pivotScaling = true, startIndex = 0, uid } = {}) {
  const ref = referenceInputs(pkg);
  return rows.map((r, i) => ({
    id: uid ? uid() : `dp${startIndex + i}`,
    name: `DP ${startIndex + i}`,
    status: 'pendente', notes: '',
    inputs: withDerivedPivots(pkg, { ...ref, ...r }, pivotScaling),
    outputs: null,
  }));
}
