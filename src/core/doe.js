// Planejamento de experimentos (Design Points): variáveis, níveis, fatorial completo,
// um fator por vez (OAT), duplicatas e pivôs derivados da corda.

import { parseNum } from './num.js';
import { keys, withDerivedPivots, referenceInputs, topologyOf, pairOf, gurneyConfigured, isRelGap, gapBaseIndex, buildWing, pairName } from './wing.js';

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
      const note = `${pr.kind !== 'flap' ? pr.kind + ' ' : ''}par ${pr.a}–${pr.b}${pr.anchor === 'ba' ? (pr.kind === 'upperflap' ? ' (Overlap = stagger a partir do BA)' : ' (medidos entre os BAs)') : ''}`;
      if (isRelGap(el)) {
        const b = gapBaseIndex(pkg, i) + 1, rn = `${note}; × chord_${b}`;
        vars.push({ key: keys.gapc(n), label: `${pairName(pkg, n, 'Gap')}/c`, unit: 'x/c', group: g, element: n, ref: el.gapc_ref, note: rn });
        vars.push({ key: keys.overlapc(n), label: `${pairName(pkg, n, 'Overlap')}/c`, unit: 'x/c', group: g, element: n, ref: el.overlapc_ref, note: rn });
      } else {
        const from = pr.kind === 'flap' ? pr.anchor : undefined; // flap medido a partir do BF ou do BA do ref
        vars.push({ key: keys.gap(n), label: pairName(pkg, n, 'Gap'), unit: 'mm', group: g, element: n, ref: el.gap_ref, note, from });
        vars.push({ key: keys.overlap(n), label: pairName(pkg, n, 'Overlap'), unit: 'mm', group: g, element: n, ref: el.overlap_ref, note, from });
      }
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
  const tp = topologyOf(pkg);
  pkg.config.elements.forEach((el, i) => {
    const n = i + 1, g = `Elemento ${n}`;
    if (isRelGap(el) && tp.kinds[i] !== 'principal') {
      const b = gapBaseIndex(pkg, i) + 1;
      out.push({ key: keys.gap(n), label: pairName(pkg, n, 'Gap'), unit: 'mm', group: g, element: n, derived: true, deps: [keys.gapc(n), keys.chord(b)] });
      out.push({ key: keys.overlap(n), label: pairName(pkg, n, 'Overlap'), unit: 'mm', group: g, element: n, derived: true, deps: [keys.overlapc(n), keys.chord(b)] });
    }
    out.push({ key: keys.off(n), label: `pivot_off_${n}`, unit: 'mm', group: g, element: n, derived: true, pivot: true });
    out.push({ key: keys.dte(n), label: `pivot_dTE_${n}`, unit: 'mm', group: g, element: n, derived: true, pivot: true });
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

/**
 * Regras de validade dos DPs (pacote): cada flap comparado ao seu elemento de referência (n−1).
 *  chord: inválido se chord_n > chord_(n−1) ;  aoa: inválido se AoA_n < AoA_(n−1).
 * Slat e upperflap não entram (por construção têm corda/ângulo diferentes do principal).
 */
export const DEFAULT_DOE_RULES = Object.freeze({ chord: true, aoa: true, geom: true });
export const doeRules = (pkg) => ({ ...DEFAULT_DOE_RULES, ...(pkg.config.doeRules || {}) });

/** Violações das regras para um conjunto de entradas (valores ausentes = referência). */
export function dpViolations(pkg, inputs) {
  const rules = doeRules(pkg), tp = topologyOf(pkg), els = pkg.config.elements, out = [];
  const val = (k, d) => { const v = Number(inputs?.[k]); return inputs?.[k] != null && Number.isFinite(v) ? v : Number(d); };
  els.forEach((el, i) => {
    if (tp.kinds[i] !== 'flap') return;
    const r = tp.refs[i], n = i + 1, m = r + 1;
    if (rules.chord) {
      const c = val(keys.chord(n), el.chord_ref), cr = val(keys.chord(m), els[r].chord_ref);
      if (c > cr) out.push(`chord_${n} (${c}) > chord_${m} (${cr})`);
    }
    if (rules.aoa) {
      const a = val(keys.aoa(n), el.aoa_ref), ar = val(keys.aoa(m), els[r].aoa_ref);
      if (a < ar) out.push(`AoA_${n} (${a}°) < AoA_${m} (${ar}°)`);
    }
  });
  return out;
}

/** Erros de geometria de um DP já com valores derivados: interseção, auto-interseção, cota inválida... */
export function dpGeometryErrors(pkg, inputs) {
  let w;
  try { w = buildWing(pkg, inputs); } catch (e) { return [`erro ao montar: ${e.message}`]; }
  if (!w.plane) return w.errors.length ? w.errors : ['geometria incompleta'];
  return w.asm.checks.filter((c) => c.level === 'erro').map((c) => c.msg);
}

/**
 * Separa linhas válidas e inválidas pelas regras do pacote.
 * Com geometry = true (e a regra geom ligada), também monta cada linha e descarta as com erro de geometria.
 * @returns {{valid, invalid: [{row, msgs, kind: 'regra'|'geometria'}]}}
 */
export function filterValidRows(pkg, rows, { geometry = false, pivotScaling = true } = {}) {
  const valid = [], invalid = [], geom = geometry && doeRules(pkg).geom;
  rows.forEach((r) => {
    const v = dpViolations(pkg, r);
    if (v.length) { invalid.push({ row: r, msgs: v, kind: 'regra' }); return; }
    if (geom) {
      const g = dpGeometryErrors(pkg, withDerivedPivots(pkg, { ...referenceInputs(pkg), ...r }, pivotScaling));
      if (g.length) { invalid.push({ row: r, msgs: g, kind: 'geometria' }); return; }
    }
    valid.push(r);
  });
  return { valid, invalid };
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
