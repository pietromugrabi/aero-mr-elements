// Integração: configuração do pacote (+ entradas de um Design Point) → geometria montada no CAD.

import { processProfile, elementLocal } from './profile.js';
import { assemble, DEFAULT_CONV, resolveTopology, placementRule, tangentGap, upAnchorOf, leToLe, isDirectUpper } from './assembly.js';
import { scalePivot } from './pivots.js';
import { toPlane, DEFAULT_TRANSFORM } from './transform.js';
import { bbox, sub, rotate } from './geom.js';

const cache = new Map();
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length; }

/** processProfile com cache (o pipeline do perfil não depende do DP, só da referência). */
export function processElementProfile(el, chordDef) {
  const key = [hash(el.datText || ''), el.inputMode, el.alignChord, JSON.stringify(el.te || {}), el.chord_ref, chordDef].join('|');
  if (cache.has(key)) return cache.get(key);
  const r = processProfile(el, chordDef);
  if (cache.size > 200) cache.clear();
  cache.set(key, r);
  return r;
}

/** Nomes das variáveis de entrada de um elemento n (1-based). */
export const keys = {
  chord: (n) => `chord_${n}`, aoa: (n) => `AoA_${n}`, gap: (n) => `Gap_${n}`, overlap: (n) => `Overlap_${n}`,
  off: (n) => `pivot_off_${n}`, dte: (n) => `pivot_dTE_${n}`,
  gon: (n) => `gurney_on_${n}`, gh: (n) => `gurney_h_${n}`, gt: (n) => `gurney_t_${n}`, gpos: (n) => `gurney_pos_${n}`,
  gapc: (n) => `Gap_${n}_c`, overlapc: (n) => `Overlap_${n}_c`,
};

/** Gap/Overlap informados como fração de uma corda (Gap_n = Gap_n_c · chord_base) em vez de mm. */
export const isRelGap = (el) => el?.gapUnit === 'corda';

/** Índice (0-based) do elemento cuja corda é a base de Gap/Overlap relativos: 'ref' (padrão), 'proprio' ou 'principal'. */
export function gapBaseIndex(pkg, i) {
  const el = pkg.config.elements[i], tp = topologyOf(pkg);
  if (el.gapBase === 'proprio') return i;
  if (el.gapBase === 'principal') return Math.max(0, tp.kinds.indexOf('principal'));
  return tp.refs[i] ?? 0;
}

/** Atualiza gap_ref/overlap_ref (mm) dos elementos em modo relativo a partir das frações e de chord_ref. */
export function syncRelativeGaps(pkg) {
  const els = pkg?.config?.elements;
  if (!els?.some(isRelGap)) return;
  const tp = topologyOf(pkg);
  els.forEach((el, i) => {
    if (!isRelGap(el) || tp.kinds[i] === 'principal') return;
    const c = Number(els[gapBaseIndex(pkg, i)]?.chord_ref);
    const mm = (f) => (Number.isFinite(Number(f)) && f !== null && c > 0 ? +(Number(f) * c).toPrecision(10) : null);
    el.gap_ref = mm(el.gapc_ref);
    el.overlap_ref = mm(el.overlapc_ref);
  });
}

/** Gap/Overlap em mm de um elemento relativo, com as cordas das entradas (fração × chord_base). */
function relGapMM(pkg, i, inp) {
  const el = pkg.config.elements[i], n = i + 1, b = gapBaseIndex(pkg, i);
  const num = (k, d) => { const v = Number(inp[k]); return inp[k] != null && Number.isFinite(v) ? v : Number(d); };
  const c = num(keys.chord(b + 1), pkg.config.elements[b]?.chord_ref);
  return { gap: num(keys.gapc(n), el.gapc_ref) * c, overlap: num(keys.overlapc(n), el.overlapc_ref) * c };
}

/** Tipo (principal/flap/slat) e referência de cada elemento do pacote. */
export function topologyOf(pkg) { return resolveTopology(pkg.config.elements); }

/**
 * Par de elementos ao qual Gap_n/Overlap_n se referem, de montante para jusante.
 * flap n com ref r → (r, n); slat n com ref r → (n, r). null para o principal.
 */
export function pairOf(pkg, n) {
  const tp = topologyOf(pkg), i = n - 1;
  if (tp.kinds[i] === 'principal') return null;
  const r = tp.refs[i] + 1;
  if (tp.kinds[i] === 'slat') return { kind: 'slat', a: n, b: r };
  const conv = pkg.config.conventions;
  if (tp.kinds[i] === 'upperflap') return { kind: 'upperflap', a: r, b: n, direct: isDirectUpper(tp, i), anchor: isDirectUpper(tp, i) ? 'ba' : upAnchorOf(conv, pkg.config.elements[i].upAnchor) };
  return { kind: 'flap', a: r, b: n, anchor: leToLe(conv) ? 'ba' : 'bf' };
}

/**
 * Nome de exibição de Gap/Overlap/Stagger do elemento n (1-based), pelo par de montante para jusante:
 * Gap_k = entre o elemento k e o k+1 (ex.: flap 2 atrás do 1 → Gap_1). Pares não consecutivos
 * (slat, upperflap, ref escolhida) usam os dois números: Gap_41, Gap_14.
 * Só muda o NOME mostrado; a chave interna continua Gap_n (n = elemento posicionado).
 */
export function pairName(pkg, n, what = 'Gap') {
  const pr = pairOf(pkg, n);
  if (!pr) return `${what}_${n}`;
  return `${what}_${pr.b === pr.a + 1 ? pr.a : `${pr.a}${pr.b}`}`;
}

/** Gurney com geometria definida (h e t > 0): pode ser ligado/desligado por DP. */
export const gurneyConfigured = (el) => !!el.gurney && Number(el.gurney.h) > 0 && Number(el.gurney.t) > 0;

/** Entradas de referência (valores _ref do pacote) no formato de um DP. */
export function referenceInputs(pkg) {
  const c = pkg.config, inp = {};
  const tp = topologyOf(pkg);
  c.elements.forEach((el, i) => {
    const n = i + 1;
    inp[keys.chord(n)] = el.chord_ref;
    inp[keys.aoa(n)] = el.aoa_ref;
    if (tp.kinds[i] !== 'principal') {
      if (isRelGap(el)) {
        inp[keys.gapc(n)] = el.gapc_ref; inp[keys.overlapc(n)] = el.overlapc_ref;
        const r = relGapMM(pkg, i, {});
        inp[keys.gap(n)] = Number.isFinite(r.gap) ? r.gap : null; inp[keys.overlap(n)] = Number.isFinite(r.overlap) ? r.overlap : null;
      } else { inp[keys.gap(n)] = el.gap_ref; inp[keys.overlap(n)] = el.overlap_ref; }
    }
    inp[keys.off(n)] = el.pivot_off_ref;
    inp[keys.dte(n)] = el.pivot_dTE_ref;
    if (gurneyConfigured(el)) {
      inp[keys.gon(n)] = el.gurney.enabled ? 1 : 0;
      inp[keys.gh(n)] = el.gurney.h; inp[keys.gt(n)] = el.gurney.t; inp[keys.gpos(n)] = Number(el.gurney.pos) || 0;
    }
  });
  inp.Uinf = c.fluent.Uinf;
  return inp;
}

/**
 * Recalcula os pivôs de um DP a partir da corda (se pivotScaling) sem alterar os valores _ref.
 * Gap/Overlap em fração da corda são sempre convertidos para mm (Gap_n = Gap_n_c · chord_base).
 * Retorna uma cópia das entradas.
 */
export function withDerivedPivots(pkg, inputs, pivotScaling = true) {
  const out = { ...inputs };
  const tp = topologyOf(pkg);
  pkg.config.elements.forEach((el, i) => {
    if (!isRelGap(el) || tp.kinds[i] === 'principal') return;
    const r = relGapMM(pkg, i, out);
    out[keys.gap(i + 1)] = Number.isFinite(r.gap) ? +r.gap.toPrecision(10) : null;
    out[keys.overlap(i + 1)] = Number.isFinite(r.overlap) ? +r.overlap.toPrecision(10) : null;
  });
  pkg.config.elements.forEach((el, i) => {
    const n = i + 1;
    const chord = Number(out[keys.chord(n)] ?? el.chord_ref);
    if (pivotScaling) {
      const p = scalePivot(el, chord);
      out[keys.off(n)] = p.off;
      out[keys.dte(n)] = p.dTE;
    } else {
      out[keys.off(n)] = el.pivot_off_ref;
      out[keys.dte(n)] = el.pivot_dTE_ref;
    }
  });
  return out;
}

/** Monta a asa para um conjunto de entradas (padrão: referência do pacote). */
export function buildWing(pkg, inputs = null) {
  const c = pkg.config;
  const conv = { ...DEFAULT_CONV, ...(c.conventions || {}) };
  const t = { ...DEFAULT_TRANSFORM, ...(c.transform || {}) };
  const inp = inputs || referenceInputs(pkg);
  const procs = [], elems = [], errors = [];
  const tp = topologyOf(pkg);
  c.elements.forEach((el, i) => {
    const n = i + 1;
    const proc = processElementProfile(el, conv.chordDef);
    procs.push(proc);
    if (!proc.ok) { errors.push(`Elemento ${n} (${el.profileName || 'sem perfil'}): ${proc.errors.join(' ')}`); return; }
    const num = (k, d) => { const v = Number(inp[k]); return Number.isFinite(v) ? v : d; };
    const chord = num(keys.chord(n), el.chord_ref);
    const on = gurneyConfigured(el) && num(keys.gon(n), el.gurney.enabled ? 1 : 0) >= 0.5;
    const gurney = on ? { enabled: true, h: num(keys.gh(n), el.gurney.h), t: num(keys.gt(n), el.gurney.t), pos: num(keys.gpos(n), Number(el.gurney.pos) || 0), side: el.gurney.side, hRef: el.gurney.hRef } : null;
    if (el.gurney?.enabled && !gurneyConfigured(el)) errors.push(`Elemento ${n}: Gurney ligado sem altura/espessura.`);
    const isPrincipal = tp.kinds[i] === 'principal';
    const rel = !isPrincipal && isRelGap(el) && inp[keys.gapc(n)] != null ? relGapMM(pkg, i, inp) : null;
    elems.push({
      label: `Elemento ${n}`, type: tp.kinds[i], ref: tp.refs[i], upAnchor: el.upAnchor || 'bf', chord, aoa: num(keys.aoa(n), el.aoa_ref),
      gap: isPrincipal ? 0 : rel ? rel.gap : num(keys.gap(n), el.gap_ref), overlap: isPrincipal ? 0 : rel ? rel.overlap : num(keys.overlap(n), el.overlap_ref),
      pivotOff: num(keys.off(n), el.pivot_off_ref), pivotDTE: num(keys.dte(n), el.pivot_dTE_ref),
      local: elementLocal(proc, chord, gurney),
    });
  });
  if (errors.length) return { ok: false, errors, procs, conv, transform: t };
  const asm = assemble(elems, conv);
  const plane = asm.elements.map((e) => ({
    ...e,
    pts: e.pts.map((p) => toPlane(p, t)), le: toPlane(e.le, t), te: toPlane(e.te, t), pivot: toPlane(e.pivot, t),
  }));
  const allPts = plane.flatMap((e) => e.pts);
  return {
    ok: asm.ok, errors, procs, asm, plane, conv, transform: t, inputs: inp,
    chordSum: elems.reduce((s, e) => s + e.chord, 0), bbox: bbox(allPts),
  };
}

/**
 * Gap/Overlap (mm) da montagem de referência medidos com outro ponto de medição (gapPoint 'bf' ou 'ba'),
 * para trocar a convenção sem mover os elementos. Por elemento: null no principal; gap null quando a
 * definição do gap não depende do ponto (folga mínima, tangente livre).
 */
export function gapsInConvention(pkg, gapPoint) {
  const w = buildWing(pkg);
  if (!w.asm?.elements) return null;
  const conv = { ...w.conv, gapPoint }, els = w.asm.elements;
  return pkg.config.elements.map((el, i) => {
    const e = els[i];
    if (e.ref == null || isDirectUpper(w.asm.topology, i)) return null; // 1º upperflap: sempre BA → BA, não muda
    const a = els[e.ref], rule = placementRule(e.kind, el.upAnchor, conv);
    const d = sub(e[rule.own], a[rule.refPt]), v = conv.gapAxes === 'corda' ? rotate(d, -a.theta) : d;
    const gap = conv.gapDef === 'ponto' ? v[1] / rule.sy : conv.gapDef === 'tangente' ? tangentGap(e.kind, a[rule.refPt], e.pts) : null;
    return { overlap: v[0] / rule.sx, gap };
  });
}

/** Troca o ponto de medição de Gap/Overlap; com keepGeometry, converte os _ref para a montagem não mudar. */
export function setGapPoint(pkg, gapPoint, keepGeometry = true) {
  const conv = pkg.config.conventions;
  if ((conv.gapPoint || 'bf') === gapPoint) return 0;
  const vals = keepGeometry ? gapsInConvention(pkg, gapPoint) : null;
  conv.gapPoint = gapPoint;
  let n = 0;
  (vals || []).forEach((v, i) => {
    if (!v) return;
    const el = pkg.config.elements[i], um = (x) => +x.toFixed(6); // mm com resolução de 1 nm; frações com 9 casas
    const put = (k, mm) => {
      if (mm == null || !Number.isFinite(mm)) return;
      if (isRelGap(el)) { const c = Number(pkg.config.elements[gapBaseIndex(pkg, i)]?.chord_ref); if (c > 0) { el[`${k}c_ref`] = +(mm / c).toFixed(9); n++; } } else { el[`${k}_ref`] = um(mm); n++; }
    };
    put('overlap', v.overlap); put('gap', v.gap);
  });
  syncRelativeGaps(pkg);
  return n;
}
