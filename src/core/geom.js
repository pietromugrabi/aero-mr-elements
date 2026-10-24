// Utilitários geométricos 2D (pontos como [x, y]). Sem dependências de DOM.

export const DEG = Math.PI / 180;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]; };

/** Rotaciona p por ang (rad, anti-horário) em torno de c. */
export function rotate(p, ang, c = [0, 0]) {
  const s = Math.sin(ang), co = Math.cos(ang);
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * co - y * s, c[1] + x * s + y * co];
}

/** Área com sinal (positiva = anti-horário). Polígono fechado implícito. */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function bbox(pts) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of pts) {
    if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0];
    if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1];
  }
  return { xmin, xmax, ymin, ymax };
}

/** Distância de p ao segmento ab, com o pé da perpendicular e o parâmetro t∈[0,1]. */
export function pointSegment(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  let t = l2 > 0 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const foot = add(a, mul(ab, t));
  return { d: dist(p, foot), t, foot };
}

/** Distância mínima de p a uma polilinha (closed = polígono). */
export function pointPolyline(p, pts, closed = true) {
  let best = { d: Infinity, i: -1, t: 0, foot: null };
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const r = pointSegment(p, pts[i], pts[(i + 1) % n]);
    if (r.d < best.d) best = { d: r.d, i, t: r.t, foot: r.foot };
  }
  return best;
}

/** Interseção própria entre os segmentos ab e cd. Retorna o ponto ou null. */
export function segIntersect(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-300) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / den, u = cross(qp, r) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { p: add(a, mul(r, t)), t, u };
  return null;
}

export function pointInPolygon(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function boxesOverlap(A, B, pad = 0) {
  return !(A.xmax + pad < B.xmin || B.xmax + pad < A.xmin || A.ymax + pad < B.ymin || B.ymax + pad < A.ymin);
}

/** true se os polígonos se cruzam ou um contém o outro. */
export function polygonsIntersect(A, B) {
  const ba = bbox(A), bb = bbox(B);
  if (!boxesOverlap(ba, bb)) return false;
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    const sb = { xmin: Math.min(a1[0], a2[0]), xmax: Math.max(a1[0], a2[0]), ymin: Math.min(a1[1], a2[1]), ymax: Math.max(a1[1], a2[1]) };
    if (!boxesOverlap(sb, bb)) continue;
    for (let j = 0; j < B.length; j++) {
      if (segIntersect(a1, a2, B[j], B[(j + 1) % B.length])) return true;
    }
  }
  return pointInPolygon(A[0], B) || pointInPolygon(B[0], A);
}

/** Distância mínima entre dois polígonos (0 se houver interseção). Exata para polilinhas. */
export function polygonDistance(A, B) {
  if (polygonsIntersect(A, B)) return { d: 0, pa: null, pb: null };
  let best = { d: Infinity, pa: null, pb: null };
  const bb = bbox(B), ba = bbox(A);
  for (const p of A) {
    // poda: só testa pontos que podem melhorar o mínimo atual
    const dx = Math.max(bb.xmin - p[0], 0, p[0] - bb.xmax), dy = Math.max(bb.ymin - p[1], 0, p[1] - bb.ymax);
    if (Math.hypot(dx, dy) >= best.d) continue;
    const r = pointPolyline(p, B);
    if (r.d < best.d) best = { d: r.d, pa: p, pb: r.foot };
  }
  for (const p of B) {
    const dx = Math.max(ba.xmin - p[0], 0, p[0] - ba.xmax), dy = Math.max(ba.ymin - p[1], 0, p[1] - ba.ymax);
    if (Math.hypot(dx, dy) >= best.d) continue;
    const r = pointPolyline(p, A);
    if (r.d < best.d) best = { d: r.d, pa: r.foot, pb: p };
  }
  return best;
}

/** Lista de pares de segmentos não adjacentes que se cruzam (auto-interseção). */
export function selfIntersections(poly, max = 5) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const r = segIntersect(a, b, poly[j], poly[(j + 1) % n]);
      if (r) { out.push({ i, j, p: r.p }); if (out.length >= max) return out; }
    }
  }
  return out;
}

/** Interpola y na polilinha (x monotônico por trechos) para um x dado, procurando entre i0 e i1. */
export function yAtX(pts, x, i0 = 0, i1 = pts.length - 1) {
  for (let i = i0; i < i1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
      const t = (x - a[0]) / (b[0] - a[0]);
      return { y: a[1] + t * (b[1] - a[1]), i, t };
    }
  }
  return null;
}
