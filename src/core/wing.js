// Integração: configuração do pacote (+ entradas de um Design Point) → geometria montada no CAD.

import { processProfile, elementLocal } from './profile.js';
import { assemble, DEFAULT_CONV, resolveTopology } from './assembly.js';
import { scalePivot } from './pivots.js';
import { toPlane, DEFAULT_TRANSFORM } from './transform.js';
import { bbox } from './geom.js';

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
};

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
  return tp.kinds[i] === 'slat' ? { kind: 'slat', a: n, b: r } : { kind: 'flap', a: r, b: n };
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
    if (tp.kinds[i] !== 'principal') { inp[keys.gap(n)] = el.gap_ref; inp[keys.overlap(n)] = el.overlap_ref; }
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
 * Retorna uma cópia das entradas.
 */
export function withDerivedPivots(pkg, inputs, pivotScaling = true) {
  const out = { ...inputs };
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
    elems.push({
      label: `Elemento ${n}`, type: tp.kinds[i], ref: tp.refs[i], chord, aoa: num(keys.aoa(n), el.aoa_ref),
      gap: isPrincipal ? 0 : num(keys.gap(n), el.gap_ref), overlap: isPrincipal ? 0 : num(keys.overlap(n), el.overlap_ref),
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
