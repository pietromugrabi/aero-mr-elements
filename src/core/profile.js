// Processamento de perfis: normalização, arredondamento do bordo de fuga (BF),
// corda geométrica e Gurney flap.
//
// Referencial "do perfil" (adimensional): BA em (0,0), BF em (1,0), extradorso (sucção) em +y,
// escoamento em +x. As transformações para o CAD são feitas depois (transform.js / assembly.js).

import { parseDat } from './dat.js';
import { DEG, add, sub, mul, dot, dist, norm, rotate, pointPolyline, segIntersect, selfIntersections, signedArea } from './geom.js';

/** Índice do BA: ponto mais distante do ponto médio do BF. */
export function findLE(pts, closedTE = false) {
  const n = pts.length, m = closedTE ? pts[0] : [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2];
  let k = 0, d = -1;
  pts.forEach((p, i) => { const di = dist(p, m); if (di > d) { d = di; k = i; } });
  return k;
}

/**
 * Normaliza: BA na origem, corda BA–BF(médio) unitária e, se alignChord, alinhada a +x.
 * A escala é sempre feita a partir da corda medida, portanto uma entrada física (mm) nunca é
 * escalada duas vezes: o resultado é sempre adimensional (x/c).
 */
/**
 * BA sobre a curva: ponto da spline (Catmull-Rom pelos pontos originais) mais distante do BF médio,
 * procurado nos trechos vizinhos ao vértice mais distante. É inserido no contorno se não coincidir
 * com um vértice (os demais pontos não mudam).
 */
export function refineLE(pts, closedTE = false) {
  const n = pts.length, k0 = findLE(pts, closedTE);
  const m = closedTE ? pts[0] : [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2];
  let best = { d: dist(pts[k0], m), p: pts[k0], seg: -1 };
  for (let i = Math.max(1, k0 - 2); i <= Math.min(n - 3, k0 + 1); i++) {
    for (let s = 1; s < 64; s++) {
      const p = catmullRom(pts[i - 1], pts[i], pts[i + 1], pts[i + 2], s / 64);
      const d = dist(p, m);
      if (d > best.d + 1e-14) best = { d, p, seg: i };
    }
  }
  if (best.seg < 0) return { pts, leIndex: k0, inserted: false };
  const out = pts.slice(0, best.seg + 1).concat([best.p], pts.slice(best.seg + 1));
  return { pts: out, leIndex: best.seg + 1, inserted: true, shift: dist(best.p, pts[k0]) };
}

export function normalizeProfile(parsed, { inputMode = 'normalizado', alignChord = true } = {}) {
  const warnings = [];
  const rl = refineLE(parsed.points, !!parsed.closedTE);
  const pts = rl.pts;
  const n = pts.length;
  const le = pts[rl.leIndex];
  const teMid = parsed.te ? parsed.te.mid : [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2];
  const v = sub(teMid, le);
  const c = Math.hypot(v[0], v[1]);
  const ang = Math.atan2(v[1], v[0]);
  if (inputMode === 'normalizado' && (c > 1.5 || c < 0.5)) {
    warnings.push(`Entrada marcada como normalizada, mas a corda medida é ${c.toFixed(3)}. Se o arquivo estiver em mm, selecione "física". (A escala usa sempre a corda medida, então não há escala dupla.)`);
  }
  if (inputMode === 'físico' && c > 0.5 && c < 1.5) {
    warnings.push(`Entrada marcada como física (mm), mas a corda medida é ${c.toFixed(3)} — parece um arquivo normalizado.`);
  }
  const out = pts.map((p) => {
    let q = sub(p, le);
    if (alignChord) q = rotate(q, -ang);
    return [q[0] / c, q[1] / c];
  });
  return {
    pts: out, leIndex: rl.leIndex, closedTE: !!parsed.closedTE, fileChord: c,
    rotationDeg: alignChord ? ang / DEG : 0, leOffset: le, leInserted: rl.inserted, warnings,
  };
}

// --- Arredondamento do BF ----------------------------------------------------------------

/** Polilinha deslocada (miter) de uma cadeia, para o lado indicado (+1 esquerda, −1 direita). */
function offsetChain(chain, r, side) {
  const segN = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const d = norm(sub(chain[i + 1], chain[i]));
    segN.push(side > 0 ? [-d[1], d[0]] : [d[1], -d[0]]);
  }
  return chain.map((p, i) => {
    let nv;
    if (i === 0) nv = segN[0];
    else if (i === chain.length - 1) nv = segN[i - 1];
    else {
      const s = add(segN[i - 1], segN[i]);
      const m = norm(s);
      const c = dot(m, segN[i]);
      nv = c > 0.2 ? mul(m, 1 / c) : segN[i];
    }
    return add(p, mul(nv, r));
  });
}

/** Ponto de Catmull-Rom centrípeta entre p1 e p2 (t ∈ [0,1]). */
function catmullRom(p0, p1, p2, p3, t) {
  const tj = (ti, a, b) => ti + Math.sqrt(Math.max(dist(a, b), 1e-15));
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => { const w = (tb - ta) || 1e-15; return [((tb - u) * a[0] + (u - ta) * b[0]) / w, ((tb - u) * a[1] + (u - ta) * b[1]) / w]; };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

/**
 * Insere pontos SOBRE a curva (spline pelos pontos originais) nos trechos da cauda, para que as
 * tangências do arco caiam na superfície suave e não nas cordas da polilinha. Pontos originais mantidos.
 */
function densifyTail(chain, xmin, sub = 12) {
  const out = [chain[0]];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    if (Math.min(a[0], b[0]) >= xmin) {
      const p0 = chain[Math.max(0, i - 1)], p3 = chain[Math.min(chain.length - 1, i + 2)];
      for (let k = 1; k < sub; k++) out.push(catmullRom(i === 0 ? a : p0, a, b, p3, k / sub));
    }
    out.push(b);
  }
  return out;
}

/**
 * Arredonda o BF com um círculo de raio r (fração da corda) tangente ao extradorso e ao intradorso.
 * Só os pontos a jusante das tangências são substituídos pelo arco. O contorno original não é alterado.
 * @param pts contorno normalizado (anti-horário, índice 0 = BF do extradorso)
 * @returns {{ok, pts, center, tu, tl, teExtreme, replaced:{upper,lower}, xMinModified, messages:string[], errors:string[]}}
 */
export function roundTE(pts, r, { closedTE = false, arcPoints = 16 } = {}) {
  const errors = [], messages = [];
  const n = pts.length;
  const le = findLE(pts, closedTE);
  if (!(r > 0)) return { ok: false, pts, errors: ['Raio do BF deve ser maior que zero.'], messages };

  // Cadeias BF → BA. Extradorso: sentido do contorno (interior à esquerda); intradorso: inverso.
  const xminD = Math.max(0.5, 1 - 15 * r);
  const upper = densifyTail(pts.slice(0, le + 1), xminD);
  const lower = densifyTail((closedTE ? [pts[0]] : []).concat(pts.slice(le).reverse()), xminD);

  const teThick = closedTE ? 0 : dist(pts[0], pts[n - 1]);
  const ou = offsetChain(upper, r, +1);
  const ol = offsetChain(lower, r, -1);

  // Busca a interseção das curvas deslocadas mais próxima do BF (restrita aos 40% finais).
  let best = null;
  const lim = 0.6;
  for (let i = 0; i < ou.length - 1; i++) {
    if (Math.max(upper[i][0], upper[i + 1][0]) < lim) break;
    for (let j = 0; j < ol.length - 1; j++) {
      if (Math.max(lower[j][0], lower[j + 1][0]) < lim) break;
      const x = segIntersect(ou[i], ou[i + 1], ol[j], ol[j + 1]);
      if (x && (!best || x.p[0] > best.c[0])) best = { c: x.p, i, j };
    }
  }
  if (!best) {
    if (!closedTE && teThick > 2 * r) {
      errors.push(`Raio (${(r * 100).toFixed(3)} % c) menor que metade da espessura do BF aberto (${(teThick * 50).toFixed(3)} % c): não existe círculo tangente às duas superfícies. Aumente o raio.`);
    } else {
      errors.push('Não foi encontrado um círculo tangente às duas superfícies perto do BF (raio grande demais para a cauda?).');
    }
    return { ok: false, pts, errors, messages };
  }
  const C = best.c;
  const fu = pointPolyline(C, upper, false), fl = pointPolyline(C, lower, false);
  const resid = Math.max(Math.abs(fu.d - r), Math.abs(fl.d - r));
  if (resid > 1e-3 * r + 1e-9) messages.push(`Tangência aproximada (resíduo ${(resid / r * 100).toFixed(2)} % do raio) — contorno pouco refinado perto do BF.`);

  const Tu = fu.foot, Tl = fl.foot;
  const leP = pts[le];
  const dirE = norm(sub(C, leP));
  const teExtreme = add(C, mul(dirE, r));
  let a0 = Math.atan2(dirE[1], dirE[0]);
  let au = Math.atan2(Tu[1] - C[1], Tu[0] - C[0]);
  let al = Math.atan2(Tl[1] - C[1], Tl[0] - C[0]);
  while (au < a0) au += 2 * Math.PI;
  while (al > a0) al -= 2 * Math.PI;
  if (au - a0 > Math.PI || a0 - al > Math.PI) {
    errors.push('Geometria do arco inconsistente (tangências do mesmo lado do centro).');
    return { ok: false, pts, errors, messages };
  }
  const nu = Math.max(2, Math.round(arcPoints * (au - a0) / (au - al)));
  const nl = Math.max(2, arcPoints - nu);
  const arcU = [], arcL = [];
  for (let k = 0; k < nu; k++) { const a = a0 + ((au - a0) * k) / nu; arcU.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
  for (let k = 1; k < nl; k++) { const a = al + ((a0 - al) * k) / nl; arcL.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }

  // Pontos mantidos
  const keptUpper = upper.slice(fu.i + 1); // inclui o BA
  const keptLower = lower.slice(fl.i + 1).reverse().slice(1); // BA → BF, sem repetir o BA

  const near = (a, b) => dist(a, b) < 1e-12;
  const out = [...arcU];
  if (!near(Tu, keptUpper[0])) out.push(Tu);
  out.push(...keptUpper, ...keptLower);
  if (!near(Tl, keptLower[keptLower.length - 1])) out.push(Tl);
  out.push(...arcL);

  const outKeys = new Set(out.map((p) => p.join(',')));
  const origKeys = new Set(pts.map((p) => p.join(',')));
  const replacedUpper = pts.slice(0, le + 1).filter((p) => !outKeys.has(p.join(','))).length;
  const replacedLower = pts.slice(le + 1).filter((p) => !outKeys.has(p.join(','))).length;
  const transition = keptUpper.concat(keptLower).filter((p) => !origKeys.has(p.join(','))).length;
  const xMinModified = Math.min(Tu[0], Tl[0]);
  if (xMinModified < 0.9) messages.push(`O arredondamento alterou o contorno a partir de x/c = ${xMinModified.toFixed(4)} (antes de 90 % da corda). Verifique o raio.`);
  if (r > 0.02) messages.push('Raio maior que 2 % da corda: valor incomum para um BF arredondado.');
  const si = selfIntersections(out, 1);
  if (si.length) errors.push('O contorno arredondado tem auto-interseção. Reduza o raio.');
  return {
    ok: errors.length === 0, pts: out, center: C, tu: Tu, tl: Tl, teExtreme, r,
    replaced: { upper: replacedUpper, lower: replacedLower }, transitionPoints: transition, xMinModified, messages, errors,
    leIndex: findLE(out),
  };
}

/**
 * Re-normaliza pela corda geométrica: do BA (origem) ao ponto do contorno mais distante dele.
 * Usado quando o BF é arredondado (convenção DS_chordN do SolidWorks).
 */
export function geometricChord(pts, leIndex) {
  const le = pts[leIndex];
  let k = 0, d = -1;
  pts.forEach((p, i) => { const di = dist(p, le); if (di > d) { d = di; k = i; } });
  const v = sub(pts[k], le), ang = Math.atan2(v[1], v[0]);
  const out = pts.map((p) => { const q = rotate(sub(p, le), -ang); return [q[0] / d, q[1] / d]; });
  // Reordena para que o índice 0 seja o ponto extremo do BF
  const ordered = out.slice(k).concat(out.slice(0, k));
  return { pts: ordered, ratio: d, angleDeg: ang / DEG, leIndex: (leIndex - k + pts.length) % pts.length };
}

/**
 * Pipeline completo de um elemento (adimensional).
 * cfg: { datText, inputMode, alignChord, te: {enabled, mode:'pct'|'mm', value, arcPoints}, chord_ref }
 * chordDef: 'geometrica' (BA → ponto extremo do BF arredondado) | 'classica'
 */
export function processProfile(cfg, chordDef = 'geometrica') {
  const parsed = parseDat(cfg.datText || '', { name: cfg.profileName });
  const res = { parsed, ok: parsed.errors.length === 0, errors: [...parsed.errors], warnings: [...parsed.warnings], info: [...parsed.info] };
  if (!res.ok) return res;
  const nrm = normalizeProfile(parsed, { inputMode: cfg.inputMode, alignChord: cfg.alignChord !== false });
  res.normalized = nrm;
  res.warnings.push(...nrm.warnings);
  let pts = nrm.pts, leIndex = nrm.leIndex;
  res.original = pts;
  res.te = null;
  const te = cfg.te || {};
  if (te.enabled) {
    const r = te.mode === 'mm' ? (Number(te.value) / Number(cfg.chord_ref)) : Number(te.value) / 100;
    if (!(r > 0) || !Number.isFinite(r)) {
      res.errors.push('Raio do BF inválido (verifique o valor e a corda de referência).');
    } else {
      const rt = roundTE(pts, r, { closedTE: nrm.closedTE, arcPoints: te.arcPoints || 16 });
      res.te = rt;
      if (rt.ok) { pts = rt.pts; leIndex = rt.leIndex; } else res.errors.push(...rt.errors);
      res.warnings.push(...rt.messages);
    }
  }
  res.chordInfo = { ratio: 1, angleDeg: 0, def: chordDef };
  if (chordDef === 'geometrica' && res.te && res.te.ok) {
    const g = geometricChord(pts, leIndex);
    pts = g.pts; leIndex = g.leIndex;
    res.chordInfo = { ratio: g.ratio, angleDeg: g.angleDeg, def: chordDef };
  }
  if (signedArea(pts) < 0) res.warnings.push('Contorno processado em sentido horário — verifique o arquivo.');
  res.final = pts;
  res.leIndex = leIndex;
  res.ok = res.errors.length === 0;
  return res;
}

/** Cruzamento de x = xq com uma superfície do contorno (índice 0 = BF, BA em le).
 *  Extradorso: segmentos 0..le (x decrescente), retorna o cruzamento mais próximo do BF.
 *  Intradorso: segmentos le..n−1 (+ fechamento), retorna o cruzamento mais próximo do BF. */
function surfaceCrossing(pts, le, xq, side) {
  const n = pts.length;
  const seg = (i) => [pts[i], pts[(i + 1) % n]];
  const hit = (i) => { const [a, b] = seg(i); if ((a[0] - xq) * (b[0] - xq) <= 0 && a[0] !== b[0]) { const s = (xq - a[0]) / (b[0] - a[0]); return { i, p: [xq, a[1] + s * (b[1] - a[1])] }; } return null; };
  if (side === 'succao') { for (let i = 0; i < le; i++) { const r = hit(i); if (r) return r; } return null; }
  let last = null;
  for (let i = le; i < n; i++) { const r = hit(i); if (r) last = r; }
  return last;
}

/**
 * Contorno local do elemento em mm (BA em (0,0), corda sobre +x, sucção em +y) com Gurney opcional.
 * Gurney (padrão = convenção DS_gurney_h/t do SolidWorks):
 *   - side: 'pressao' (padrão, −y) ou 'succao' (+y);
 *   - pos: distância da face de jusante ao BF, ao longo da corda (0 = rente ao BF, padrão);
 *   - h: altura normal à corda, medida a partir da linha da corda (hRef 'corda', padrão — DS mede a
 *     partir do BF) ou a partir da superfície local na face de jusante (hRef 'superficie');
 *   - t: espessura ao longo da corda. Rente ao BF, a superfície entre x = c−t e o BF é aparada
 *     (Gurney e perfil formam um único contorno); com pos > 0 é uma aba retangular sobre a superfície.
 */
export function elementLocal(proc, chord, gurney = null) {
  const pts = proc.final.map((p) => [p[0] * chord, p[1] * chord]);
  const out = { pts, leIndex: proc.leIndex, gurney: null, errors: [], warnings: [] };
  if (!gurney || !gurney.enabled) return out;
  const h = Number(gurney.h), t = Number(gurney.t), pos = Math.max(0, Number(gurney.pos) || 0);
  const side = gurney.side === 'succao' ? 'succao' : 'pressao', sg = side === 'succao' ? 1 : -1;
  if (!(h > 0) || !(t > 0)) { out.errors.push('Gurney: altura e espessura devem ser maiores que zero.'); return out; }
  const te = pts[0], le = proc.leIndex;
  const surfName = side === 'succao' ? 'extradorso' : 'intradorso';
  const x2 = te[0] - pos, x1 = x2 - t;
  if (x1 <= pts[le][0] + 0.05 * chord) { out.errors.push('Gurney: posição + espessura avançam além de 95 % da corda a partir do BF.'); return out; }
  const c1 = surfaceCrossing(pts, le, x1, side);
  const c2 = pos > 0 ? surfaceCrossing(pts, le, x2, side) : { i: null, p: te };
  if (!c1 || !c2) { out.errors.push(`Gurney: não foi possível encontrar o ${surfName} na posição do Gurney.`); return out; }
  const yo = (gurney.hRef === 'superficie' ? c2.p[1] : te[1]) + sg * h;
  const G2 = [x2, yo], G1 = [x1, yo];
  const effUp = sg * (yo - c1.p[1]), effDown = sg * (yo - c2.p[1]);
  if (effUp <= 0 || effDown <= 0) {
    out.errors.push(`Gurney: a altura (${h} mm) não sobressai do ${surfName} (altura do ${surfName} na face de montante: ${(sg * (c1.p[1] - te[1])).toFixed(3)} mm em relação à corda).`);
    return out;
  }
  let contour;
  if (pos === 0) {
    // rente ao BF: apara a superfície entre x1 e o BF
    if (side === 'pressao') contour = pts.slice(0, c1.i + 1).concat([c1.p, G1, G2]);
    else contour = [te, G2, G1, c1.p].concat(pts.slice(c1.i + 1));
  } else if (side === 'pressao') {
    if (c1.i > c2.i) { out.errors.push('Gurney: posição inconsistente no intradorso.'); return out; }
    contour = pts.slice(0, c1.i + 1).concat([c1.p, G1, G2, c2.p], pts.slice(c2.i + 1));
  } else {
    if (c2.i > c1.i) { out.errors.push('Gurney: posição inconsistente no extradorso.'); return out; }
    contour = pts.slice(0, c2.i + 1).concat([c2.p, G2, G1, c1.p], pts.slice(c1.i + 1));
  }
  out.pts = contour;
  out.gurney = { h, t, pos, side, hRef: gurney.hRef || 'corda', effective: effUp /* face de montante: quanto sobressai da superfície */, effectiveUp: effUp, effectiveDown: effDown, hPct: (100 * h) / chord, points: [c2.p, G2, G1, c1.p] };
  if (t > 0.05 * chord) out.warnings.push('Gurney: espessura maior que 5 % da corda do elemento.');
  if (h > 0.1 * chord) out.warnings.push(`Gurney: altura de ${out.gurney.hPct.toFixed(1)} % da corda (valores usuais ficam abaixo de ~5 %).`);
  if (side === 'succao') out.warnings.push('Gurney no lado de sucção: confira se é intencional (o usual é no lado de pressão).');
  return out;
}
