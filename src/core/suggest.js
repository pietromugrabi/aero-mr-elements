// Sugestões de partida para chord, AoA, Gap e Overlap de cada elemento, a partir de faixas
// configuráveis por tipo (flap / slat / upperflap). Não é otimização: são pontos de partida para o
// DOE; o melhor valor sai das simulações. Todas as faixas são relativas ao elemento de referência:
//   chord_n = razão · chord_ref ;  AoA_n = AoA_ref + ΔAoA ;  Gap_n, Overlap_n = fração · chord_ref.

import { resolveTopology } from './assembly.js';
import { clone } from './model.js';

const R = (min, mid, max) => ({ min, mid, max });

/** Faixas típicas de partida (editáveis no pacote). Upperflap fica vazio: sem faixa típica de referência. */
export const DEFAULT_SUGGEST = Object.freeze({
  totalChord: null, // soma das cordas disponível (mm); vazio = parte do chord_ref do principal
  mainAoA: null,    // AoA do principal (°); vazio = usa AoA_ref do principal
  rules: {
    flap: { chordRatio: R(0.55, 0.65, 0.75), dAoA: R(10, 15, 20), gap: R(0.01, 0.03, 0.05), overlap: R(0.005, 0.02, 0.04) },
    slat: { chordRatio: R(0.15, 0.2, 0.25), dAoA: R(-30, -25, -20), gap: R(0.015, 0.025, 0.035), overlap: R(0.005, 0.01, 0.02) },
    upperflap: { chordRatio: R(null, null, null), dAoA: R(null, null, null), gap: R(null, null, null), overlap: R(null, null, null) },
  },
});

export const RULE_FIELDS = [
  ['chordRatio', 'chord_n / chord_ref', '—'],
  ['dAoA', 'AoA_n − AoA_ref', '°'],
  ['gap', 'Gap_n / chord_ref', 'x/c'],
  ['overlap', 'Overlap_n / chord_ref', 'x/c'],
];

/** Configuração de sugestões do pacote (cria com os padrões se faltar). */
export function suggestConfig(pkg) {
  const c = pkg.config;
  if (!c.suggest) c.suggest = clone(DEFAULT_SUGGEST);
  ['flap', 'slat', 'upperflap'].forEach((k) => { if (!c.suggest.rules[k]) c.suggest.rules[k] = clone(DEFAULT_SUGGEST.rules[k]); });
  return c.suggest;
}

const ok = (v) => v !== null && v !== '' && Number.isFinite(Number(v));
const scale = (r, f, add = 0) => (r && ok(r.mid) ? { min: ok(r.min) ? Number(r.min) * f + add : null, mid: Number(r.mid) * f + add, max: ok(r.max) ? Number(r.max) * f + add : null } : null);

/**
 * Sugestão por elemento: {chord, aoa, gap, overlap} com {min, mid, max} (mm / °), e mensagens.
 * Elementos são resolvidos a partir do principal, seguindo a cadeia de referências.
 */
export function suggestGeometry(pkg) {
  const els = pkg.config.elements, tp = resolveTopology(els), s = suggestConfig(pkg);
  const p = Math.max(0, tp.kinds.indexOf('principal'));
  const out = els.map((_, i) => ({ kind: tp.kinds[i], ref: tp.refs[i], chord: null, aoa: null, gap: null, overlap: null, msgs: [] }));
  // razão de corda acumulada em relação ao principal (para dividir a corda total)
  const ratioToMain = (i, seen = new Set()) => {
    if (i === p) return 1;
    if (seen.has(i) || tp.refs[i] == null) return null;
    seen.add(i);
    const r = s.rules[tp.kinds[i]]?.chordRatio?.mid, up = ratioToMain(tp.refs[i], seen);
    return ok(r) && up != null ? Number(r) * up : null;
  };
  let cMain = ok(els[p].chord_ref) ? Number(els[p].chord_ref) : null;
  if (ok(s.totalChord) && Number(s.totalChord) > 0) {
    const rs = els.map((_, i) => ratioToMain(i));
    if (rs.every((r) => r != null)) cMain = Number(s.totalChord) / rs.reduce((a, b) => a + b, 0);
    else out[p].msgs.push('Corda total ignorada: há elemento sem razão de corda configurada.');
  }
  const aMain = ok(s.mainAoA) ? Number(s.mainAoA) : ok(els[p].aoa_ref) ? Number(els[p].aoa_ref) : null;
  out[p].chord = cMain != null ? { min: null, mid: cMain, max: null } : null;
  out[p].aoa = aMain != null ? { min: null, mid: aMain, max: null } : null;
  if (cMain == null) out[p].msgs.push('Informe chord_ref do principal ou a corda total.');
  if (aMain == null) out[p].msgs.push('Informe AoA_ref do principal ou o AoA do principal nas sugestões.');

  const done = new Set([p]);
  for (let pass = 0; pass < els.length; pass++) {
    els.forEach((_, i) => {
      if (done.has(i) || !done.has(tp.refs[i])) return;
      const ref = out[tp.refs[i]], rule = s.rules[tp.kinds[i]] || {}, o = out[i];
      const cRef = ref.chord?.mid, aRef = ref.aoa?.mid;
      if (cRef != null) {
        o.chord = scale(rule.chordRatio, cRef);
        o.gap = scale(rule.gap, cRef);
        o.overlap = scale(rule.overlap, cRef);
      }
      if (aRef != null) o.aoa = scale(rule.dAoA, 1, aRef);
      const missing = [['chord', 'razão de corda'], ['aoa', 'ΔAoA'], ['gap', 'gap'], ['overlap', 'overlap']].filter(([k]) => !o[k]).map(([, l]) => l);
      if (missing.length) o.msgs.push(`Sem sugestão de ${missing.join(', ')}: ${cRef == null || aRef == null ? 'falta o valor do elemento de referência' : `configure a faixa de ${tp.kinds[i]}`}.`);
      done.add(i);
    });
  }
  return out;
}

/**
 * Aplica os valores centrais aos _ref do pacote. Pivôs acompanham a mudança de corda
 * (mesma razão pivot/chord). Gap/Overlap relativos recebem a fração da sua corda base.
 * @returns nº de valores alterados
 */
export function applySuggestion(pkg, sug, { gapBaseIndexOf } = {}) {
  let n = 0;
  const els = pkg.config.elements;
  sug.forEach((s, i) => {
    const el = els[i];
    if (s.chord?.mid > 0) {
      const c0 = Number(el.chord_ref), c1 = +s.chord.mid.toPrecision(6);
      if (c0 > 0 && c1 !== c0) {
        if (ok(el.pivot_off_ref)) el.pivot_off_ref = +(el.pivot_off_ref * c1 / c0).toPrecision(6);
        if (ok(el.pivot_dTE_ref)) el.pivot_dTE_ref = +(el.pivot_dTE_ref * c1 / c0).toPrecision(6);
      }
      el.chord_ref = c1; n++;
    }
    if (s.aoa && ok(s.aoa.mid)) { el.aoa_ref = +s.aoa.mid.toPrecision(6); n++; }
  });
  // gap/overlap depois das cordas (a fração relativa usa a corda base já atualizada)
  sug.forEach((s, i) => {
    const el = els[i];
    ['gap', 'overlap'].forEach((k) => {
      if (!s[k] || !ok(s[k].mid)) return;
      if (el.gapUnit === 'corda' && gapBaseIndexOf) {
        const cb = Number(els[gapBaseIndexOf(i)]?.chord_ref);
        if (cb > 0) { el[`${k}c_ref`] = +(s[k].mid / cb).toPrecision(6); n++; }
      } else { el[`${k}_ref`] = +s[k].mid.toPrecision(6); n++; }
    });
  });
  return n;
}

/** Texto de níveis do DOE (mín; centro; máx) de uma faixa. */
export function levelsText(r, digits = 4) {
  if (!r) return '';
  return [r.min, r.mid, r.max].filter(ok).map((v) => String(+Number(v).toPrecision(digits)).replace('.', ',')).filter((v, i, a) => a.indexOf(v) === i).join('; ');
}
