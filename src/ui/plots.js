// Gráficos em SVG (sem dependências): vista geométrica interativa, XY, barras, mapa de calor.
// As cores são lidas das variáveis CSS no momento do desenho (o SVG exportado leva os valores).
import { h, s, download, safeName } from './dom.js';
import { fmtSig } from '../core/num.js';

export function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    surface: v('--surface'), text: v('--text'), text2: v('--text-2'), muted: v('--muted'), grid: v('--grid'), axis: v('--axis'),
    accent: v('--accent'), err: v('--err'), warn: v('--warn'), ok: v('--ok'), example: v('--example'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)),
    dark: document.documentElement.dataset.theme !== 'light',
  };
}

// Escala sequencial de um só matiz (vermelho Mauá Racing): claro → escuro.
const SEQ_LIGHT = ['#fde6e3', '#fbd0ca', '#f8b3a9', '#f49587', '#ef7766', '#e85a47', '#e03d2b', '#d0281a', '#b81d12', '#9e150d', '#850f09', '#6b0a06', '#520604'];
// Âncoras validadas (validador de paletas da skill dataviz): um só matiz, claridade monotônica, degraus
// visíveis e o valor mínimo com contraste ≥ 2:1 contra o painel de cada tema. Entre âncoras, interpolação.
export const RAMP_LIGHT = ['#f49587', '#e85a47', '#d0281a', '#9e150d', '#520604'];
export const RAMP_DARK = ['#9e150d', '#d0281a', '#e85a47', '#f49587', '#fbd0ca'];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export function seqColor(t, dark) {
  const ramp = dark ? RAMP_DARK : RAMP_LIGHT;
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (ramp.length - 1), k = Math.min(ramp.length - 2, Math.floor(x)), f = x - k;
  const a = hex(ramp[k]), b = hex(ramp[k + 1]);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}
void SEQ_LIGHT;

export function niceTicks(min, max, n = 6) {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= n) || 10 * mag;
  const t = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) t.push(+v.toPrecision(12));
  return t;
}
const tickLabel = (v) => fmtSig(v, 4);

let tipEl;
function tip(show, x, y, text) {
  if (!tipEl) { tipEl = h('div', { class: 'tooltip' }); document.body.append(tipEl); }
  if (!show) { tipEl.style.display = 'none'; return; }
  tipEl.textContent = text; tipEl.style.display = 'block';
  const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
  tipEl.style.left = Math.min(innerWidth - w - 8, x + 14) + 'px';
  tipEl.style.top = Math.min(innerHeight - hh - 8, y + 14) + 'px';
}

export function exportSVG(svg, name) {
  const c = svg.cloneNode(true);
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  download(`${safeName(name)}.svg`, new XMLSerializer().serializeToString(c), 'image/svg+xml');
}
export function exportPNG(svg, name, scale = 2) {
  const c = svg.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = svg.viewBox.baseVal, w = vb.width || svg.clientWidth, hh = vb.height || svg.clientHeight;
  c.setAttribute('width', w); c.setAttribute('height', hh);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = hh * scale;
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => download(`${safeName(name)}.png`, b), 'image/png');
  };
  img.src = url;
}

function toolbar(getSvg, name, extra = []) {
  return h('div', { class: 'tools' }, ...extra,
    h('button', { title: 'Exportar SVG', onclick: () => exportSVG(getSvg(), name) }, 'SVG'),
    h('button', { title: 'Exportar PNG', onclick: () => exportPNG(getSvg(), name) }, 'PNG'));
}

// ------------------------------------------------------------------ Vista geométrica
/**
 * scene(): { elements:[{pts, le, te, pivot, label, gurney}], slots:[], rect?, flow:[dx,dy], lift:[dx,dy],
 *            overlays?: [{pts, color, dash}], axes:[h,v] }
 * opts: { height, show: {pivots, chords, gaps, vectors, labels, clearance}, name }
 */
export function geomPlot(scene, opts = {}) {
  const H = opts.height || 420;
  const wrap = h('div', { class: 'plot', style: { height: H + 'px' } });
  let view = null; // {cx, cy, k}
  let W = 800;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
  const fit = () => {
    const sc = scene();
    const pts = (sc.fitPts || sc.elements.flatMap((e) => e.pts)).concat(sc.rect ? [[sc.rect.xmin, sc.rect.ymin], [sc.rect.xmax, sc.rect.ymax]] : []);
    if (!pts.length) { view = { cx: 0, cy: 0, k: 1 }; return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const k = Math.min((W - 60) / (xmax - xmin || 1), (H - 60) / (ymax - ymin || 1));
    view = { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, k };
  };
  const X = (x) => W / 2 + (x - view.cx) * view.k, Y = (y) => H / 2 - (y - view.cy) * view.k;
  const path = (pts, close = true) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join('') + (close ? 'Z' : '');

  /** Gap pela tangente: reta horizontal tangente (tracejada), ponto de tangência e cota vertical com setas. */
  function drawTangentGap(tn, tag, th, labels) {
    const col = th.warn;
    const [l0, l1] = tn.line;
    svg.append(s('line', { x1: X(l0[0]), y1: Y(l0[1]), x2: X(l1[0]), y2: Y(l1[1]), stroke: col, 'stroke-width': 1.3, 'stroke-dasharray': '6 4' }));
    // linha de chamada horizontal no ponto de partida (BF ou ponto mais baixo do elemento de cima)
    const ext = 10 / view.k;
    svg.append(s('line', { x1: X(tn.from[0] - ext), y1: Y(tn.from[1]), x2: X(tn.from[0] + ext), y2: Y(tn.from[1]), stroke: col, 'stroke-width': 1 }));
    svg.append(s('circle', { cx: X(tn.tangent[0]), cy: Y(tn.tangent[1]), r: 3.5, fill: th.surface, stroke: col, 'stroke-width': 1.5 }));
    svg.append(s('circle', { cx: X(tn.from[0]), cy: Y(tn.from[1]), r: 3, fill: col }));
    // cota vertical com setas nas duas pontas
    const x = X(tn.from[0]), ya = Y(tn.from[1]), yb = Y(tn.foot[1]);
    svg.append(s('line', { x1: x, y1: ya, x2: x, y2: yb, stroke: col, 'stroke-width': 1.3 }));
    const dir = Math.sign(yb - ya) || 1, aw = 4, al = Math.min(7, Math.abs(yb - ya) / 2.5);
    if (al > 1.5) {
      svg.append(s('path', { d: `M${x},${ya} L${x - aw},${ya + dir * al} L${x + aw},${ya + dir * al} Z`, fill: col }));
      svg.append(s('path', { d: `M${x},${yb} L${x - aw},${yb - dir * al} L${x + aw},${yb - dir * al} Z`, fill: col }));
    }
    if (labels) {
      const txt = `g${tag} = ${fmtSig(tn.value, 4)} mm`, ty = (ya + yb) / 2 + 4;
      svg.append(s('text', { x: x + 8, y: ty, 'font-size': 11, 'font-weight': 600, fill: col, 'paint-order': 'stroke', stroke: th.surface, 'stroke-width': 3 }, txt));
    }
  }

  function draw() {
    W = Math.max(320, wrap.clientWidth || 800);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!view) fit();
    const sc = scene(), th = theme(), show = { pivots: true, chords: true, gaps: true, vectors: true, labels: true, clearance: true, ...(opts.show || {}) };
    svg.replaceChildren();
    svg.append(s('rect', { x: 0, y: 0, width: W, height: H, fill: th.surface }));
    // grade
    const gx = niceTicks(view.cx - W / 2 / view.k, view.cx + W / 2 / view.k, 10), gy = niceTicks(view.cy - H / 2 / view.k, view.cy + H / 2 / view.k, 8);
    gx.forEach((v) => svg.append(s('line', { x1: X(v), x2: X(v), y1: 0, y2: H, stroke: th.grid, 'stroke-width': 1 })));
    gy.forEach((v) => svg.append(s('line', { y1: Y(v), y2: Y(v), x1: 0, x2: W, stroke: th.grid, 'stroke-width': 1 })));
    gx.forEach((v) => svg.append(s('text', { x: X(v) + 3, y: H - 4, 'font-size': 10, fill: th.muted }, tickLabel(v))));
    gy.forEach((v) => svg.append(s('text', { x: 3, y: Y(v) - 3, 'font-size': 10, fill: th.muted }, tickLabel(v))));
    svg.append(s('text', { x: W - 6, y: H - 16, 'font-size': 11, fill: th.text2, 'text-anchor': 'end' }, `${sc.axes?.[0] || 'X'} [mm] →   ↑ ${sc.axes?.[1] || 'Y'} [mm]`));
    // origem
    svg.append(s('circle', { cx: X(0), cy: Y(0), r: 3, fill: 'none', stroke: th.muted }));
    if (sc.rect) {
      const r = sc.rect;
      svg.append(s('path', { d: path([[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmax, r.ymax], [r.xmin, r.ymax]]), fill: 'none', stroke: th.text2, 'stroke-width': 1.5 }));
      (sc.rectLabels || []).forEach((l) => svg.append(s('text', { x: X(l.x), y: Y(l.y), 'font-size': 12, fill: th.text, 'text-anchor': l.anchor || 'middle', 'font-weight': 600 }, l.text)));
      if (sc.ground) svg.append(s('line', { x1: X(r.xmin), x2: X(r.xmax), y1: Y(r.ymin), y2: Y(r.ymin), stroke: th.text, 'stroke-width': 3 }));
    }
    (sc.overlays || []).forEach((o) => svg.append(s('path', { d: path(o.pts, o.close !== false), fill: 'none', stroke: o.color || th.muted, 'stroke-width': o.width || 1, 'stroke-dasharray': o.dash || null })));
    sc.elements.forEach((e, i) => {
      const col = th.series[i % 8];
      svg.append(s('path', { d: path(e.pts), fill: col, 'fill-opacity': 0.18, stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      if (show.chords && e.le && e.te) svg.append(s('line', { x1: X(e.le[0]), y1: Y(e.le[1]), x2: X(e.te[0]), y2: Y(e.te[1]), stroke: col, 'stroke-width': 1, 'stroke-dasharray': '5 4' }));
      if (show.pivots && e.pivot) {
        const px = X(e.pivot[0]), py = Y(e.pivot[1]);
        svg.append(s('circle', { cx: px, cy: py, r: 5, fill: th.surface, stroke: th.text, 'stroke-width': 1.5 }), s('line', { x1: px - 8, x2: px + 8, y1: py, y2: py, stroke: th.text }), s('line', { y1: py - 8, y2: py + 8, x1: px, x2: px, stroke: th.text }));
      }
      if (show.labels && e.le) {
        const nearRight = X(e.le[0]) > W - 110;
        svg.append(s('text', { x: X(e.le[0]) + (nearRight ? -8 : 8), y: Y(e.le[1]) - 10, 'font-size': 12, 'font-weight': 600, fill: th.text, 'text-anchor': nearRight ? 'end' : 'start' }, e.label || `E${i + 1}`));
      }
    });
    if (show.gaps) (sc.slots || []).forEach((sl, i) => {
      const a = sl.from || sc.elements[i].te, b = sl.to || sc.elements[i + 1].le, tag = sl.pair ? sl.pair.join('') : `${i + 1}${i + 2}`;
      const c = [b[0], a[1]];
      if (sl.tan) {
        // gap pela tangente; o overlap continua sendo a distância horizontal BF → BA
        drawTangentGap(sl.tan, tag, th, show.labels);
        svg.append(s('line', { x1: X(a[0]), y1: Y(a[1]), x2: X(c[0]), y2: Y(c[1]), stroke: th.text2, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
        if (show.labels) svg.append(s('text', { x: (X(a[0]) + X(c[0])) / 2, y: Y(a[1]) - 6, 'font-size': 10.5, fill: th.text2, 'text-anchor': 'middle' }, `o${tag}`));
        if (show.clearance && sl.pa && sl.pb) svg.append(s('line', { x1: X(sl.pa[0]), y1: Y(sl.pa[1]), x2: X(sl.pb[0]), y2: Y(sl.pb[1]), stroke: th.err, 'stroke-width': 1.5 }));
        return;
      }
      svg.append(s('path', { d: path([a, c, b], false), fill: 'none', stroke: th.text2, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
      if (show.labels) svg.append(s('text', { x: X(b[0]) + 4, y: (Y(a[1]) + Y(b[1])) / 2, 'font-size': 10.5, fill: th.text2 }, `g${tag}`), s('text', { x: (X(a[0]) + X(c[0])) / 2, y: Y(a[1]) + 12, 'font-size': 10.5, fill: th.text2, 'text-anchor': 'middle' }, `o${tag}`));
      if (show.clearance && sl.pa && sl.pb) svg.append(s('line', { x1: X(sl.pa[0]), y1: Y(sl.pa[1]), x2: X(sl.pb[0]), y2: Y(sl.pb[1]), stroke: th.err, 'stroke-width': 1.5 }));
    });
    if (show.vectors && sc.flow) {
      const ox = 50, oy = 40, L = 50;
      const arrow = (dx, dy, col, label, x0, y0) => {
        const x1 = x0 + dx * L, y1 = y0 - dy * L;
        const ang = Math.atan2(y1 - y0, x1 - x0);
        svg.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: col, 'stroke-width': 2 }),
          s('path', { d: `M${x1},${y1} L${x1 - 9 * Math.cos(ang - 0.4)},${y1 - 9 * Math.sin(ang - 0.4)} L${x1 - 9 * Math.cos(ang + 0.4)},${y1 - 9 * Math.sin(ang + 0.4)} Z`, fill: col }),
          s('text', { x: x1 + (dx > 0 ? 6 : dx < 0 ? -6 : 6), y: y1 + (dy < 0 ? 14 : dy > 0 ? -4 : 4), 'font-size': 11, fill: th.text2, 'text-anchor': dx < 0 ? 'end' : 'start' }, label));
      };
      const x0 = sc.flow[0] < 0 ? W - ox - 20 : ox;
      arrow(sc.flow[0], sc.flow[1], th.accent, 'escoamento U∞', x0, oy + 10);
      arrow(sc.lift[0], sc.lift[1], th.ok, sc.liftLabel || 'sustentação', x0 + (sc.flow[0] < 0 ? -L - 30 : L + 30), oy + 30);
    }
  }
  wrap.append(svg, toolbar(() => svg, opts.name || 'geometria', [
    h('button', { title: 'Ajustar à janela', onclick: () => { fit(); draw(); } }, 'Ajustar'),
    h('button', { onclick: () => { view.k *= 1.4; draw(); } }, '+'),
    h('button', { onclick: () => { view.k /= 1.4; draw(); } }, '−'),
  ]));
  // zoom com roda, arraste para mover, coordenadas no tooltip
  const toData = (ev) => { const r = svg.getBoundingClientRect(); const sx = ((ev.clientX - r.left) / r.width) * W, sy = ((ev.clientY - r.top) / r.height) * H; return [view.cx + (sx - W / 2) / view.k, view.cy - (sy - H / 2) / view.k, sx, sy]; };
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [x, y] = toData(ev), f = ev.deltaY < 0 ? 1.2 : 1 / 1.2;
    view.cx = x - (x - view.cx) / f; view.cy = y - (y - view.cy) / f; view.k *= f; draw();
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, cx: view.cx, cy: view.cy }; svg.setPointerCapture(ev.pointerId); });
  svg.addEventListener('pointermove', (ev) => {
    if (drag) { const r = svg.getBoundingClientRect(); const sc = W / r.width; view.cx = drag.cx - ((ev.clientX - drag.x) * sc) / view.k; view.cy = drag.cy + ((ev.clientY - drag.y) * sc) / view.k; draw(); tip(false); return; }
    const [x, y] = toData(ev); tip(true, ev.clientX, ev.clientY, `${scene().axes?.[0] || 'X'} = ${fmtSig(x, 6)} mm\n${scene().axes?.[1] || 'Y'} = ${fmtSig(y, 6)} mm`);
  });
  svg.addEventListener('pointerup', () => { drag = null; });
  svg.addEventListener('pointerleave', () => tip(false));
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(wrap);
  wrap.redraw = (refit = false) => { if (refit) view = null; draw(); };
  wrap.svg = svg;
  return wrap;
}

// ------------------------------------------------------------------ XY
/**
 * series: [{name, points:[{x,y,label}]}]; opts: {xLabel, yLabel, lines, height, name, badge, zeroLine}
 * Cores fixas por ordem da série (no máx. 8; as demais em cinza, com aviso fora do gráfico).
 */
export function xyChart(series, opts = {}) {
  const H = opts.height || 380;
  const wrap = h('div', null);
  const hidden = new Set();
  const plot = h('div', { class: 'plot', style: { height: H + 'px' } });
  const svg = s('svg');
  const legend = h('div', { class: 'legend' });
  plot.append(svg, toolbar(() => svg, opts.name || 'grafico'));
  wrap.append(series.length > 1 ? legend : null, plot);
  const colorOf = (i, th) => (i < 8 ? th.series[i] : th.muted);
  function draw() {
    const th = theme();
    const W = Math.max(320, plot.clientWidth || 800);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const vis = series.filter((_, i) => !hidden.has(i));
    const all = vis.flatMap((se) => se.points);
    const m = { l: 64, r: 18, t: 36, b: 46 }; // topo livre para a barra SVG/PNG
    svg.append(s('rect', { x: 0, y: 0, width: W, height: H, fill: th.surface }));
    if (!all.length) { svg.append(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: th.muted }, 'Sem dados para os filtros escolhidos')); return; }
    let xmin = Math.min(...all.map((p) => p.x)), xmax = Math.max(...all.map((p) => p.x));
    let ymin = Math.min(...all.map((p) => p.y)), ymax = Math.max(...all.map((p) => p.y));
    if (opts.zeroLine) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
    const px = (xmax - xmin) * 0.05 || 1, py = (ymax - ymin) * 0.08 || Math.abs(ymax) * 0.1 || 1;
    xmin -= px; xmax += px; ymin -= py; ymax += py;
    const X = (x) => m.l + ((x - xmin) / (xmax - xmin)) * (W - m.l - m.r), Y = (y) => H - m.b - ((y - ymin) / (ymax - ymin)) * (H - m.t - m.b);
    niceTicks(ymin, ymax, 6).forEach((v) => { svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: th.grid }), s('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: th.muted }, tickLabel(v))); });
    niceTicks(xmin, xmax, 8).forEach((v) => { svg.append(s('line', { x1: X(v), x2: X(v), y1: H - m.b, y2: H - m.b + 4, stroke: th.axis }), s('text', { x: X(v), y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: th.muted }, tickLabel(v))); });
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: th.axis }));
    if (ymin < 0 && ymax > 0) svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: th.axis }));
    svg.append(s('text', { x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: th.text2 }, opts.xLabel || 'x'));
    svg.append(s('text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: th.text2, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, opts.yLabel || 'y'));
    if (opts.badge) svg.append(s('text', { x: m.l + 6, y: m.t + 12, 'font-size': 12, 'font-weight': 700, fill: th.example }, opts.badge));
    const hits = [];
    series.forEach((se, i) => {
      if (hidden.has(i)) return;
      const col = colorOf(i, th);
      if (opts.lines !== false && se.points.length > 1) svg.append(s('path', { d: se.points.map((p, k) => `${k ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(''), fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      se.points.forEach((p) => { svg.append(s('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: col, stroke: th.surface, 'stroke-width': 2 })); hits.push({ sx: X(p.x), sy: Y(p.y), p, se }); });
      if (series.length <= 4 && se.points.length && opts.lines !== false) { const last = se.points[se.points.length - 1]; svg.append(s('text', { x: Math.min(W - m.r - 2, X(last.x) + 6), y: Y(last.y) - 6, 'font-size': 11, fill: th.text2, 'text-anchor': X(last.x) > W - 120 ? 'end' : 'start' }, se.name)); }
    });
    const cross = s('line', { y1: m.t, y2: H - m.b, stroke: th.axis, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    const ring = s('circle', { r: 7, fill: 'none', stroke: th.text, 'stroke-width': 1.5, visibility: 'hidden' });
    svg.append(cross, ring);
    svg.onpointermove = (ev) => {
      const r = svg.getBoundingClientRect(); const sx = ((ev.clientX - r.left) / r.width) * W, sy = ((ev.clientY - r.top) / r.height) * H;
      let best = null, bd = 900;
      hits.forEach((ht) => { const d = (ht.sx - sx) ** 2 + (ht.sy - sy) ** 2; if (d < bd) { bd = d; best = ht; } });
      if (!best) { tip(false); cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); return; }
      cross.setAttribute('x1', best.sx); cross.setAttribute('x2', best.sx); cross.setAttribute('visibility', 'visible');
      ring.setAttribute('cx', best.sx); ring.setAttribute('cy', best.sy); ring.setAttribute('visibility', 'visible');
      tip(true, ev.clientX, ev.clientY, `${best.se.name}\n${opts.xLabel || 'x'} = ${fmtSig(best.p.x, 5)}\n${opts.yLabel || 'y'} = ${fmtSig(best.p.y, 5)}${best.p.label ? '\n' + best.p.label : ''}`);
    };
    svg.onpointerleave = () => { tip(false); cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); };
  }
  function drawLegend() {
    const th = theme();
    legend.replaceChildren(...series.map((se, i) => h('span', { class: 'key' + (hidden.has(i) ? ' off' : ''), onclick: () => { hidden.has(i) ? hidden.delete(i) : hidden.add(i); drawLegend(); draw(); } }, h('span', { class: 'sw', style: { background: colorOf(i, th) } }), se.name)));
  }
  drawLegend();
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(plot);
  wrap.svg = svg;
  return wrap;
}

// ------------------------------------------------------------------ Barras (ranking)
export function barChart(items, opts = {}) {
  const rowH = 24, H = Math.max(120, items.length * rowH + 50);
  const plot = h('div', { class: 'plot', style: { height: H + 'px' } });
  const svg = s('svg');
  plot.append(svg, toolbar(() => svg, opts.name || 'ranking'));
  function draw() {
    const th = theme(), W = Math.max(320, plot.clientWidth || 800);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.replaceChildren(s('rect', { x: 0, y: 0, width: W, height: H, fill: th.surface }));
    const lw = Math.min(260, W * 0.4), m = { l: lw, r: 70, t: 14 };
    const vals = items.map((i) => i.value), vmin = Math.min(0, ...vals), vmax = Math.max(0, ...vals);
    const X = (v) => m.l + ((v - vmin) / (vmax - vmin || 1)) * (W - m.l - m.r);
    items.forEach((it, k) => {
      const y = m.t + k * rowH;
      const x0 = X(0), x1 = X(it.value);
      svg.append(s('text', { x: m.l - 8, y: y + 15, 'text-anchor': 'end', 'font-size': 11.5, fill: th.text2 }, it.label.length > 42 ? it.label.slice(0, 40) + '…' : it.label));
      const r = s('rect', { x: Math.min(x0, x1), y: y + 4, width: Math.max(1, Math.abs(x1 - x0)), height: rowH - 8, rx: 3, fill: k === 0 ? th.series[0] : th.series[0], 'fill-opacity': k === 0 ? 1 : 0.65 });
      r.addEventListener('pointermove', (ev) => tip(true, ev.clientX, ev.clientY, `${it.label}\n${opts.metric || ''} = ${fmtSig(it.value, 5)}${it.detail ? '\n' + it.detail : ''}`));
      r.addEventListener('pointerleave', () => tip(false));
      svg.append(r, s('text', { x: Math.max(x0, x1) + 6, y: y + 15, 'font-size': 11.5, fill: th.text }, fmtSig(it.value, 4)));
    });
  }
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(plot);
  plot.svg = svg;
  return plot;
}

// ------------------------------------------------------------------ Mapa de calor
/** grid[iy][ix] = {z, n, min, max, label} | null */
export function heatmapChart({ xs, ys, grid, points }, opts = {}) {
  const H = opts.height || 420;
  const plot = h('div', { class: 'plot', style: { height: H + 'px' } });
  const svg = s('svg');
  plot.append(svg, toolbar(() => svg, opts.name || 'mapa'));
  function draw() {
    const th = theme(), W = Math.max(320, plot.clientWidth || 800);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.replaceChildren(s('rect', { x: 0, y: 0, width: W, height: H, fill: th.surface }));
    const m = { l: 70, r: 90, t: 36, b: 46 };
    const zs = grid.flat().filter(Boolean).map((c) => c.z);
    if (!zs.length) { svg.append(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: th.muted }, 'Sem dados')); return; }
    const zmin = opts.zmin ?? Math.min(...zs), zmax = opts.zmax ?? Math.max(...zs);
    const cw = (W - m.l - m.r) / xs.length, ch = (H - m.t - m.b) / ys.length;
    const gap = xs.length * ys.length > 400 ? 0 : 2;
    grid.forEach((row, iy) => row.forEach((c, ix) => {
      const x = m.l + ix * cw, y = H - m.b - (iy + 1) * ch;
      if (!c) { svg.append(s('rect', { x: x + gap / 2, y: y + gap / 2, width: cw - gap, height: ch - gap, fill: 'none', stroke: th.grid })); return; }
      const t = (c.z - zmin) / (zmax - zmin || 1);
      const r = s('rect', { x: x + gap / 2, y: y + gap / 2, width: Math.max(0.5, cw - gap), height: Math.max(0.5, ch - gap), rx: gap ? 3 : 0, fill: seqColor(t, th.dark), stroke: c.n > 1 ? th.warn : 'none', 'stroke-width': c.n > 1 ? 2 : 0 });
      r.addEventListener('pointermove', (ev) => tip(true, ev.clientX, ev.clientY, `${opts.xLabel} = ${fmtSig(xs[ix], 5)}\n${opts.yLabel} = ${fmtSig(ys[iy], 5)}\n${opts.zLabel} = ${fmtSig(c.z, 5)}${c.n > 1 ? `\n${c.n} DPs nesta célula (faixa ${fmtSig(c.min, 4)} … ${fmtSig(c.max, 4)})` : ''}${c.label ? '\n' + c.label : ''}`));
      r.addEventListener('pointerleave', () => tip(false));
      svg.append(r);
      if (cw > 46 && ch > 20 && !opts.noLabels) svg.append(s('text', { x: x + cw / 2, y: y + ch / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: t > 0.55 !== th.dark ? '#ffffff' : '#0b0b0b', 'pointer-events': 'none' }, fmtSig(c.z, 3)));
    }));
    const stepX = Math.ceil(xs.length / 12), stepY = Math.ceil(ys.length / 10);
    xs.forEach((v, i) => { if (i % stepX === 0) svg.append(s('text', { x: m.l + (i + 0.5) * cw, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: th.muted }, tickLabel(v))); });
    ys.forEach((v, i) => { if (i % stepY === 0) svg.append(s('text', { x: m.l - 6, y: H - m.b - (i + 0.5) * ch + 4, 'text-anchor': 'end', 'font-size': 11, fill: th.muted }, tickLabel(v))); });
    svg.append(s('text', { x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: th.text2 }, opts.xLabel));
    svg.append(s('text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: th.text2, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, opts.yLabel));
    // legenda de cor
    const lx = W - m.r + 24, lh = H - m.t - m.b;
    for (let k = 0; k < 40; k++) svg.append(s('rect', { x: lx, y: m.t + (lh * (39 - k)) / 40, width: 14, height: lh / 40 + 0.5, fill: seqColor(k / 39, th.dark) }));
    svg.append(s('text', { x: lx + 18, y: m.t + 10, 'font-size': 10.5, fill: th.muted }, fmtSig(zmax, 3)), s('text', { x: lx + 18, y: m.t + lh, 'font-size': 10.5, fill: th.muted }, fmtSig(zmin, 3)), s('text', { x: lx - 4, y: m.t - 4, 'font-size': 10.5, fill: th.text2 }, opts.zLabel || 'z'));
    (points || []).forEach((p) => {
      const ix = (p.x - xs[0]) / ((xs[xs.length - 1] - xs[0]) || 1) * (xs.length - 1), iy = (p.y - ys[0]) / ((ys[ys.length - 1] - ys[0]) || 1) * (ys.length - 1);
      const c = s('circle', { cx: m.l + (ix + 0.5) * cw, cy: H - m.b - (iy + 0.5) * ch, r: 4.5, fill: th.surface, stroke: th.text, 'stroke-width': 1.5 });
      c.addEventListener('pointermove', (ev) => tip(true, ev.clientX, ev.clientY, `${p.label || 'DP'}\n${opts.zLabel} (CFD) = ${fmtSig(p.z, 5)}`));
      c.addEventListener('pointerleave', () => tip(false));
      svg.append(c);
    });
  }
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(plot);
  plot.svg = svg;
  return plot;
}
