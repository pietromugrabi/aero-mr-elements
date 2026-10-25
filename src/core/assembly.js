// Montagem dos elementos (referencial do perfil: x = escoamento, y = sustentação/sucção, em mm).
// Ver docs/equacoes.md para a derivação completa.
//
// Tipos de elemento:
//  - 'principal': exatamente um; ancorado na origem (pivô ou BA).
//  - 'flap': a jusante do elemento de referência (padrão: o anterior). BA_flap = BF_ref + (−overlap, −gap).
//  - 'slat': a montante do elemento de referência (padrão: o principal). BF_slat = BA_ref + (+overlap, +gap).
//    Overlap > 0: BF do slat a jusante do BA do ref; Gap > 0: BF do slat do lado de sucção do BA do ref.
//  - 'upperflap': acima do elemento de referência (lado de pressão; padrão: o principal), com o ponto
//    de referência escolhido por elemento (upAnchor):
//      'bf' → BA_up = BF_ref + (−overlap, −gap)  (Overlap > 0: BA a montante do BF do ref)
//      'ba' → BA_up = BA_ref + (+stagger, −gap)  (Stagger = Overlap_n; > 0: BA a jusante do BA do ref)
//    Gap > 0: lado de pressão (acima, no CAD padrão da asa invertida).
//
// Convenções (todas configuráveis em `conv`):
//  - AoA positivo = nariz para cima no referencial do perfil (aumenta a sustentação no sentido
//    configurado). Com a transformação padrão (X=−x, Y=−y) isso é "BF para cima, mais downforce",
//    exatamente como DS_AoAN. Ângulo absoluto (em relação ao escoamento).
//  - Rotação: p' = T + R(−σ·AoA)·(p − P_local), σ = conv.aoaSign (padrão +1).
//  - assemblyMode 'sequencial' (padrão, = SolidWorks DS_): o principal gira em torno do próprio pivô
//    (na origem); os demais são girados e transladados pelo gap/overlap em relação ao ref.
//    Nesse modo o pivô dos elementos não principais é apenas um ponto de referência.
//  - assemblyMode 'pivoFixo': monta com todas as cordas alinhadas ao escoamento (AoA = 0) e depois
//    gira cada elemento em torno do próprio pivô.
//  - gapDef 'ponto' (padrão): gap = componente normal entre os pontos de referência; 'minimo':
//    gap = folga mínima entre os contornos do elemento e do ref (resolvido por bissecção);
//    'tangente': gap = distância vertical do ponto de referência do ref (BF; BA no upperflap pelo BA)
//    até a reta horizontal tangente ao elemento — ao extradorso (ponto mais alto) de um flap, ao
//    intradorso (ponto mais baixo) de um upperflap. O overlap não muda (deslocamento só vertical).
//    O slat não tem essa definição e segue ponto a ponto.

import { DEG, add, sub, rotate, polygonDistance, polygonsIntersect, pointInPolygon, pointPolyline, bbox, selfIntersections } from './geom.js';
import { pivotLocal } from './pivots.js';

export const DEFAULT_CONV = Object.freeze({
  assemblyMode: 'sequencial', anchor: 'pivo1', gapAxes: 'escoamento', gapDef: 'ponto',
  pivotSide: 'succao', pivotDTE: 'euclidiana', aoaSign: 1, chordDef: 'geometrica',
  swRules: true, clearanceMin: 1.0,
});

export const TYPE_LABEL = { principal: 'principal', flap: 'flap', slat: 'slat', upperflap: 'upperflap' };

/**
 * Regra de posicionamento de cada tipo: ponto do ref (refPt), ponto do elemento (own) e sinais de
 * overlap/gap no vetor ref→elemento, nos eixos do escoamento: v = (sx·Overlap, sy·Gap).
 */
export function placementRule(kind, upAnchor = 'bf') {
  if (kind === 'slat') return { refPt: 'le', own: 'te', sx: 1, sy: 1 };
  if (kind === 'upperflap' && upAnchor === 'ba') return { refPt: 'le', own: 'le', sx: 1, sy: -1 };
  return { refPt: 'te', own: 'le', sx: -1, sy: -1 }; // flap e upperflap a partir do BF
}

/**
 * Resolve tipo e referência de cada elemento (com padrões compatíveis com versões antigas:
 * elemento 1 = principal, os demais = flaps encadeados).
 * @returns {{kinds:string[], refs:(number|null)[], principal:number, order:number[], errors:string[]}}
 */
export function resolveTopology(list) {
  const n = list.length, errors = [];
  const kinds = list.map((e, i) => e.type || (i === 0 ? 'principal' : 'flap'));
  let principal = kinds.indexOf('principal');
  if (principal < 0) { errors.push('Nenhum elemento marcado como principal: usado o elemento 1.'); principal = 0; kinds[0] = 'principal'; }
  kinds.forEach((k, i) => { if (k === 'principal' && i !== principal) { errors.push(`Mais de um elemento principal: o elemento ${i + 1} foi tratado como flap.`); kinds[i] = 'flap'; } });
  const refs = list.map((e, i) => {
    if (kinds[i] === 'principal') return null;
    let r = Number.isInteger(e.ref) ? e.ref : kinds[i] === 'slat' || kinds[i] === 'upperflap' ? principal : i - 1;
    if (r < 0 || r >= n || r === i) { errors.push(`Elemento ${i + 1}: referência inválida; usado o principal.`); r = principal; }
    return r;
  });
  const order = [principal], placed = new Set([principal]);
  let guard = 0;
  while (order.length < n && guard++ < n * n) {
    for (let i = 0; i < n; i++) if (!placed.has(i) && placed.has(refs[i])) { order.push(i); placed.add(i); }
  }
  if (order.length < n) {
    for (let i = 0; i < n; i++) if (!placed.has(i)) { errors.push(`Elemento ${i + 1}: referência circular; posicionado em relação ao principal.`); refs[i] = principal; order.push(i); placed.add(i); }
  }
  return { kinds, refs, principal, order, errors };
}

function placeShape(local, chord, piv, theta, translation) {
  // p_global = translation + R(theta)·(p − piv)
  const tf = (p) => add(translation, rotate(sub(p, piv), theta));
  return { pts: local.pts.map(tf), le: tf([0, 0]), te: tf([chord, 0]), pivot: tf(piv), tf };
}

/** Vetor do ponto de referência do ref até o ponto do elemento (ver placementRule). */
function offsetVec(rule, overlap, gap, axes, thetaRef) {
  const v = [rule.sx * overlap, rule.sy * gap];
  return axes === 'corda' ? rotate(v, thetaRef) : v;
}

/** Posiciona o elemento i (já girado) em relação ao ref; dy = deslocamento vertical extra. */
function placeRelative(e, kind, piv, theta, ref, conv, gapValue, dy = 0) {
  const rotOnly = placeShape(e.local, e.chord, piv, theta, [0, 0]);
  const rule = placementRule(kind, e.upAnchor);
  const anchorRef = ref[rule.refPt];
  const own = rotOnly[rule.own];
  const target = add(anchorRef, offsetVec(rule, e.overlap, gapValue, conv.gapAxes, ref.theta));
  return placeShape(e.local, e.chord, piv, theta, add(sub(target, own), [0, dy]));
}

/**
 * Gap pela tangente horizontal: distância vertical do ponto de referência do ref até a reta horizontal
 * tangente ao elemento (flap: ponto mais alto, no extradorso; upperflap: ponto mais baixo, no intradorso).
 * > 0 = há folga vertical; ≤ 0 = o elemento passa da linha do ponto de referência. null para slat.
 */
export function tangentGap(kind, refPoint, pts) {
  if (kind === 'flap') return refPoint[1] - Math.max(...pts.map((p) => p[1]));
  if (kind === 'upperflap') return Math.min(...pts.map((p) => p[1])) - refPoint[1];
  return null;
}

/** Ajusta só na vertical para que o gap pela tangente seja igual ao Gap informado (relação linear). */
function solveTangentGap(e, kind, piv, theta, ref, conv) {
  const rule = placementRule(kind, e.upAnchor);
  const shape0 = placeRelative(e, kind, piv, theta, ref, conv, e.gap);
  const g0 = tangentGap(kind, ref[rule.refPt], shape0.pts);
  if (g0 == null) return { ok: false, msg: 'gap pela tangente vale para flap e upperflap; o slat segue ponto a ponto.' };
  const delta = e.gap - g0; // flap desce, upperflap sobe
  return { ok: true, shape: placeRelative(e, kind, piv, theta, ref, conv, e.gap, kind === 'upperflap' ? delta : -delta) };
}

/**
 * @param elems [{chord, aoa, gap, overlap, pivotOff, pivotDTE, local:{pts}, label, type?, ref?}]
 *              gap/overlap referem-se ao par (elemento, ref); ignorados no principal.
 * @returns {{ok, elements:[{pts, le, te, pivot, theta, chord, kind, ref, ...}], checks, slots, topology}}
 */
export function assemble(elems, conv = DEFAULT_CONV) {
  conv = { ...DEFAULT_CONV, ...conv };
  const checks = [];
  const sgn = conv.aoaSign === -1 ? -1 : 1;
  const topo = resolveTopology(elems);
  topo.errors.forEach((m) => checks.push({ level: 'erro', elem: null, msg: m }));
  const { kinds, refs, principal, order } = topo;

  const pivots = elems.map((e, i) => {
    const r = pivotLocal(e.chord, e.pivotOff, e.pivotDTE, conv);
    if (!r.ok) checks.push({ level: 'erro', elem: i, msg: `Elemento ${i + 1}: ${r.error}` });
    return r.ok ? r.p : [e.chord * 0.25, 0];
  });

  const build = (aoaOf) => {
    const placed = new Array(elems.length);
    order.forEach((i) => {
      const e = elems[i], theta = -sgn * aoaOf(i) * DEG, piv = pivots[i];
      if (i === principal) {
        // pivo1: pivô do principal na origem (T = 0). ba1: BA do principal na origem → T = R·piv
        const T = conv.anchor === 'ba1' ? rotate(piv, theta) : [0, 0];
        placed[i] = { ...placeShape(e.local, e.chord, piv, theta, T), theta };
        return;
      }
      const ref = placed[refs[i]];
      let shape = placeRelative(e, kinds[i], piv, theta, ref, conv, e.gap);
      if (conv.gapDef === 'minimo') {
        const solved = solveMinGap(e, kinds[i], piv, theta, ref, conv);
        if (solved.ok) shape = solved.shape; else checks.push({ level: 'aviso', elem: i, msg: `Elemento ${i + 1}: ${solved.msg}` });
      } else if (conv.gapDef === 'tangente') {
        const solved = solveTangentGap(e, kinds[i], piv, theta, ref, conv);
        if (solved.ok) shape = solved.shape; else checks.push({ level: 'info', elem: i, msg: `Elemento ${i + 1}: ${solved.msg}` });
      }
      placed[i] = { ...shape, theta };
    });
    return placed;
  };

  let placed;
  if (conv.assemblyMode === 'pivoFixo') {
    const base = build(() => 0);
    placed = elems.map((e, i) => {
      const theta = -sgn * e.aoa * DEG;
      return { ...placeShape(e.local, e.chord, pivots[i], theta, base[i].pivot), theta };
    });
  } else {
    placed = build((i) => elems[i].aoa);
  }

  const out = placed.map((p, i) => {
    const e = elems[i];
    return {
      label: e.label || `Elemento ${i + 1}`, kind: kinds[i], ref: refs[i], chord: e.chord, aoa: e.aoa, theta: p.theta,
      pts: p.pts, le: p.le, te: p.te, pivot: p.pivot, pivotLocal: pivots[i], gurney: e.local.gurney || null,
      relDeflection: refs[i] != null ? e.aoa - elems[refs[i]].aoa : null,
    };
  });

  // Medições efetivas de cada par (elemento, ref), na mesma convenção usada para posicionar.
  const slots = [];
  order.forEach((i) => {
    if (refs[i] == null) return;
    const r = refs[i], a = out[r], b = out[i], kind = kinds[i];
    const rule = placementRule(kind, elems[i].upAnchor);
    const d = sub(b[rule.own], a[rule.refPt]);
    const dc = rotate(d, -a.theta);
    const md = polygonDistance(a.pts, b.pts);
    slots.push({
      elem: i, ref: r, kind, upAnchor: kind === 'upperflap' ? (elems[i].upAnchor || 'bf') : null,
      pair: kind === 'slat' ? [i + 1, r + 1] : [r + 1, i + 1], // slat: de montante para jusante
      from: a[rule.refPt], to: b[rule.own],
      overlapFlow: d[0] / rule.sx, gapFlow: d[1] / rule.sy, overlapChord: dc[0] / rule.sx, gapChord: dc[1] / rule.sy,
      gapTangent: tangentGap(kind, a[rule.refPt], b.pts),
      clearance: md.d, pa: md.pa, pb: md.pb,
    });
  });

  runChecks(elems, out, slots, conv, checks, kinds);
  return { ok: !checks.some((c) => c.level === 'erro'), elements: out, slots, checks, topology: topo, bbox: bbox(out.flatMap((e) => e.pts)) };
}

function solveMinGap(e, kind, piv, theta, ref, conv) {
  // s cresce → o elemento se afasta do ref (flap: para o lado de pressão; slat: para o de sucção).
  const f = (s) => { const shape = placeRelative(e, kind, piv, theta, ref, conv, s); return { shape, g: polygonDistance(ref.pts, shape.pts).d - e.gap }; };
  const span = e.gap + e.chord;
  const s0 = -span, s1 = 2 * span, steps = 120;
  let lastBad = null;
  for (let k = 0; k <= steps; k++) if (f(s0 + ((s1 - s0) * k) / steps).g < 0) lastBad = k;
  if (lastBad === null) return { ok: false, msg: 'gap como folga mínima: nenhuma posição com folga menor que o gap foi encontrada; usado o gap ponto a ponto.' };
  if (lastBad === steps) return { ok: false, msg: 'gap como folga mínima: não convergiu; usado o gap ponto a ponto.' };
  let sLo = s0 + ((s1 - s0) * lastBad) / steps, sHi = s0 + ((s1 - s0) * (lastBad + 1)) / steps;
  let best = null;
  for (let it = 0; it < 50; it++) {
    const m = (sLo + sHi) / 2, r = f(m);
    if (r.g >= 0) { sHi = m; best = r; } else sLo = m;
    if (sHi - sLo < 1e-7) break;
  }
  return { ok: true, shape: (best || f(sHi)).shape };
}

function runChecks(elems, out, slots, conv, checks, kinds) {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (polygonsIntersect(out[i].pts, out[j].pts)) checks.push({ level: 'erro', elem: j, msg: `Interseção entre os elementos ${i + 1} e ${j + 1}: os corpos se sobrepõem (o SolidWorks/DM não detectam isso).` });
    }
  }
  slots.forEach((s) => {
    if (s.clearance > 0 && s.clearance < conv.clearanceMin) {
      checks.push({ level: 'aviso', elem: s.elem, msg: `Folga real da fenda ${s.pair[0]}–${s.pair[1]}${s.kind !== 'flap' ? ` (${s.kind})` : ''} = ${s.clearance.toFixed(2)} mm (< ${conv.clearanceMin} mm): exige malha muito fina na fenda.` });
    }
    if (s.kind === 'slat' && out[s.elem].le[0] > out[s.ref].le[0]) checks.push({ level: 'aviso', elem: s.elem, msg: `Slat (elemento ${s.elem + 1}) com o BA a jusante do BA do elemento ${s.ref + 1}: confira o overlap e a corda.` });
    if (s.kind === 'upperflap' && s.gapFlow <= 0) checks.push({ level: 'aviso', elem: s.elem, msg: `Upperflap (elemento ${s.elem + 1}) não está acima do ponto de referência do elemento ${s.ref + 1} (Gap ≤ 0).` });
  });
  out.forEach((e, i) => {
    const inside = pointInPolygon(e.pivot, e.pts);
    const d = pointPolyline(e.pivot, e.pts).d;
    e.pivotInside = inside; e.pivotClearance = d;
    if (!inside) checks.push({ level: 'aviso', elem: i, msg: `Pivô do elemento ${i + 1} fora do perfil (a ${d.toFixed(2)} mm da superfície).` });
    if (selfIntersections(e.pts, 1).length) checks.push({ level: 'erro', elem: i, msg: `Contorno do elemento ${i + 1} com auto-interseção.` });
  });
  if (conv.swRules) {
    elems.forEach((e, i) => {
      const k = i + 1;
      if (kinds[i] !== 'principal') {
        if (!(e.gap > 0)) checks.push({ level: 'erro', elem: i, msg: `Gap_${k} = ${e.gap}: cota zero/negativa é inválida no SolidWorks (DS_ não tem sinal). Use ≥ 0,1 mm.` });
        if (!(e.overlap > 0)) checks.push({ level: 'erro', elem: i, msg: `Overlap_${k} = ${e.overlap}: cota zero/negativa é inválida no SolidWorks (o sinal se perde). Use ≥ 0,1 mm ou reparametrize.` });
      }
      if (e.aoa < 0) {
        if (kinds[i] === 'slat') checks.push({ level: 'aviso', elem: i, msg: `AoA_${k} negativo (slat defletido): a cota angular do SolidWorks não tem sinal — dimensione o ângulo do slat a partir do lado oposto da horizontal e registre a convenção.` });
        else checks.push({ level: 'erro', elem: i, msg: `AoA_${k} negativo é rejeitado pela cota angular do SolidWorks.` });
      }
      if (!(e.pivotOff > 0)) checks.push({ level: 'erro', elem: i, msg: `pivot_off_${k} deve ser > 0 (cota de distância do SolidWorks).` });
      if (!(e.chord > 0)) checks.push({ level: 'erro', elem: i, msg: `chord_${k} deve ser > 0.` });
    });
  }
  elems.forEach((e, i) => {
    (e.local.errors || []).forEach((m) => checks.push({ level: 'erro', elem: i, msg: `Elemento ${i + 1}: ${m}` }));
    (e.local.warnings || []).forEach((m) => checks.push({ level: 'aviso', elem: i, msg: `Elemento ${i + 1}: ${m}` }));
  });
}
