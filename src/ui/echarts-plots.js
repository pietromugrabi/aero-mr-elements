// Gráficos da aba Gráficos com Apache ECharts (src/vendor/echarts.min.js, carregado só quando preciso).
// Mesma interface dos gráficos SVG de plots.js (xyChart, barChart, heatmapChart); se o ECharts não
// carregar, cai automaticamente para eles. Cores e fontes vêm das variáveis CSS do tema.
import { h } from './dom.js';
import { theme, seqColor, xyChart as xySvg, barChart as barSvg, heatmapChart as heatSvg } from './plots.js';
import { fmtSig } from '../core/num.js';

let loading = null;
/** Carrega o ECharts uma vez (script clássico UMD → globalThis.echarts). */
export function loadECharts() {
  if (globalThis.echarts) return Promise.resolve(globalThis.echarts);
  if (!loading) {
    loading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'src/vendor/echarts.min.js';
      sc.onload = () => res(globalThis.echarts);
      sc.onerror = () => { loading = null; rej(new Error('ECharts não carregou')); };
      document.head.append(sc);
    });
  }
  return loading;
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (v, d = 5) => fmtSig(v, d);

/** Cria o contêiner e desenha quando o ECharts e o elemento estiverem prontos; libera ao sair da tela. */
function mount(height, makeOption, fallback) {
  const box = h('div', { class: 'plot echart', style: { height: `${height}px` } });
  loadECharts().then((ec) => {
    let tries = 0;
    const go = () => {
      if (!box.isConnected) { if (++tries < 120) setTimeout(go, 16); return; }
      const chart = ec.init(box, null, { renderer: 'canvas' });
      chart.setOption(makeOption());
      const ro = new ResizeObserver(() => { if (!box.isConnected) { ro.disconnect(); chart.dispose(); return; } chart.resize(); });
      ro.observe(box);
    };
    setTimeout(go, 0); // setTimeout (não rAF): também desenha com a aba em segundo plano
  }).catch(() => box.replaceWith(fallback()));
  return box;
}

function base(th, name) {
  const cs = getComputedStyle(document.documentElement);
  const font = getComputedStyle(document.body).fontFamily, numFont = cs.getPropertyValue('--num-font').trim() || font;
  return {
    font, numFont,
    option: {
      backgroundColor: th.surface,
      textStyle: { fontFamily: font, color: th.text2 },
      animationDuration: 250,
      tooltip: { backgroundColor: th.surface, borderColor: th.axis, borderWidth: 1, textStyle: { color: th.text, fontFamily: numFont, fontSize: 12 }, extraCssText: 'border-radius:3px;box-shadow:none' },
      toolbox: {
        right: 8, top: 6, itemSize: 14, iconStyle: { borderColor: th.muted }, emphasis: { iconStyle: { borderColor: th.accent, textFill: th.text } },
        feature: { dataZoom: { title: { zoom: 'Zoom por área', back: 'Desfazer zoom' } }, restore: { title: 'Restaurar' }, saveAsImage: { title: 'Salvar PNG', name: name || 'grafico', backgroundColor: th.surface, pixelRatio: 2 } },
      },
    },
  };
}

const axis = (th, numFont, extra) => ({
  axisLine: { lineStyle: { color: th.axis } }, axisTick: { lineStyle: { color: th.axis } },
  splitLine: { lineStyle: { color: th.grid } }, axisLabel: { color: th.muted, fontFamily: numFont, formatter: (v) => (typeof v === 'number' ? fmtSig(v, 4) : v) },
  nameLocation: 'middle', nameTextStyle: { color: th.text2, fontSize: 12 }, ...extra,
});

// ------------------------------------------------------------------ XY / dispersão
/** series: [{name, points:[{x,y,label}]}]; opts: {xLabel, yLabel, lines, height, name, badge} */
export function xyChart(series, opts = {}) {
  return mount(opts.height || 400, () => {
    const th = theme(), { option, numFont } = base(th, opts.name);
    const color = (i) => (i < 8 ? th.series[i] : th.muted);
    return {
      ...option,
      grid: { left: 70, right: 28, top: series.length > 1 ? 48 : 40, bottom: 58 },
      legend: series.length > 1 ? { type: 'scroll', left: 8, top: 8, right: 120, textStyle: { color: th.text2 }, inactiveColor: th.muted } : undefined,
      tooltip: { ...option.tooltip, trigger: 'item', formatter: (p) => `<b>${esc(p.seriesName)}</b><br>${esc(opts.xLabel || 'x')} = ${num(p.value[0])}<br>${esc(opts.yLabel || 'y')} = ${num(p.value[1])}${p.data.label ? `<br><span style="opacity:.75">${esc(p.data.label)}</span>` : ''}` },
      xAxis: axis(th, numFont, { type: 'value', scale: true, name: opts.xLabel || 'x', nameGap: 30 }),
      yAxis: axis(th, numFont, { type: 'value', scale: true, name: opts.yLabel || 'y', nameGap: 52 }),
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }, { type: 'inside', yAxisIndex: 0, filterMode: 'none' }],
      graphic: opts.badge ? [{ type: 'text', left: 80, top: series.length > 1 ? 54 : 46, style: { text: opts.badge, fill: th.example, font: `bold 12px ${numFont}` } }] : [],
      series: series.map((se, i) => ({
        name: se.name, type: opts.lines === false ? 'scatter' : 'line', symbol: 'circle', symbolSize: 8, showSymbol: true,
        data: se.points.map((p) => ({ value: [p.x, p.y], label: p.label })),
        lineStyle: { width: 2, color: color(i) }, itemStyle: { color: color(i), borderColor: th.surface, borderWidth: 1.5 },
        emphasis: { focus: 'series', scale: 1.4 },
      })),
    };
  }, () => xySvg(series, opts));
}

// ------------------------------------------------------------------ Barras (ranking)
/** items: [{label, value, detail}]; opts: {metric, name} */
export function barChart(items, opts = {}) {
  const H = Math.max(160, items.length * 26 + 70);
  return mount(H, () => {
    const th = theme(), { option, numFont } = base(th, opts.name);
    return {
      ...option,
      grid: { left: 12, right: 70, top: 36, bottom: 24, containLabel: true },
      tooltip: { ...option.tooltip, trigger: 'item', formatter: (p) => `${esc(items[p.dataIndex].label)}<br>${esc(opts.metric || '')} = ${num(p.value)}${items[p.dataIndex].detail ? `<br><span style="opacity:.75">${esc(items[p.dataIndex].detail)}</span>` : ''}` },
      xAxis: axis(th, numFont, { type: 'value', scale: false }),
      yAxis: { type: 'category', inverse: true, data: items.map((i) => (i.label.length > 42 ? `${i.label.slice(0, 40)}…` : i.label)), axisLabel: { color: th.text2 }, axisLine: { lineStyle: { color: th.axis } }, axisTick: { show: false } },
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: items.map((it, k) => ({ value: it.value, itemStyle: { color: th.series[0], opacity: k === 0 ? 1 : 0.65, borderRadius: 2 } })),
        label: { show: true, position: 'right', color: th.text, fontFamily: numFont, formatter: (p) => fmtSig(p.value, 4) },
      }],
    };
  }, () => barSvg(items, opts));
}

// ------------------------------------------------------------------ Mapa de calor
/** grid[iy][ix] = {z, n, min, max, label} | null; points = DPs de CFD sobre a superfície ajustada */
export function heatmapChart(data, opts = {}) {
  const { xs, ys, grid, points } = data;
  return mount(opts.height || 440, () => {
    const th = theme(), { option, numFont } = base(th, opts.name);
    const zs = grid.flat().filter(Boolean).map((c) => c.z);
    const zmin = opts.zmin ?? Math.min(...zs), zmax = opts.zmax ?? Math.max(...zs);
    // texto da célula claro ou escuro conforme o tom da célula (mesma regra dos gráficos SVG)
    const ink = (z) => (((z - zmin) / (zmax - zmin || 1)) > 0.55 !== th.dark ? '#ffffff' : '#0b0b0b');
    const cells = [];
    grid.forEach((row, iy) => row.forEach((c, ix) => { if (c) cells.push({ value: [ix, iy, c.z], c, label: { color: ink(c.z) }, itemStyle: c.n > 1 ? { borderColor: th.warn, borderWidth: 2 } : undefined }); }));
    const ramp = Array.from({ length: 13 }, (_, k) => seqColor(k / 12, th.dark));
    const showLabels = !opts.noLabels && xs.length <= 12 && ys.length <= 12;
    // DPs de CFD: posição contínua convertida para o índice (fracionário) da grade
    const idx = (v, arr) => ((v - arr[0]) / ((arr[arr.length - 1] - arr[0]) || 1)) * (arr.length - 1);
    return {
      ...option,
      grid: { left: 76, right: 96, top: 40, bottom: 58 },
      tooltip: {
        ...option.tooltip, trigger: 'item',
        formatter: (p) => {
          if (p.seriesType === 'scatter') return `${esc(p.data.label || 'DP')}<br>${esc(opts.zLabel)} (CFD) = ${num(p.data.z)}`;
          const { c } = p.data, [ix, iy] = p.value;
          return `${esc(opts.xLabel)} = ${num(xs[ix])}<br>${esc(opts.yLabel)} = ${num(ys[iy])}<br>${esc(opts.zLabel)} = ${num(c.z)}${c.n > 1 ? `<br>${c.n} DPs nesta célula (${num(c.min, 4)} … ${num(c.max, 4)})` : ''}${c.label ? `<br><span style="opacity:.75">${esc(c.label)}</span>` : ''}`;
        },
      },
      xAxis: axis(th, numFont, { type: 'category', data: xs.map((v) => fmtSig(v, 4)), name: opts.xLabel, nameGap: 30, splitArea: { show: false }, splitLine: { show: false } }),
      yAxis: axis(th, numFont, { type: 'category', data: ys.map((v) => fmtSig(v, 4)), name: opts.yLabel, nameGap: 56, splitArea: { show: false }, splitLine: { show: false } }),
      visualMap: { min: zmin, max: zmax, calculable: true, formatter: (v) => fmtSig(v, 3), orient: 'vertical', right: 8, top: 'middle', itemHeight: 200, text: [fmtSig(zmax, 3), fmtSig(zmin, 3)], textStyle: { color: th.muted, fontFamily: numFont }, inRange: { color: ramp }, seriesIndex: 0 },
      series: [
        { type: 'heatmap', data: cells, label: { show: showLabels, fontFamily: numFont, fontSize: 11, formatter: (p) => fmtSig(p.value[2], 3) }, emphasis: { itemStyle: { borderColor: th.text, borderWidth: 1.5 } } },
        ...(points?.length ? [{ type: 'scatter', symbolSize: 9, itemStyle: { color: th.surface, borderColor: th.text, borderWidth: 1.5 }, data: points.map((p) => ({ value: [idx(p.x, xs), idx(p.y, ys)], label: p.label, z: p.z })), z: 5 }] : []),
      ],
    };
  }, () => heatSvg(data, opts));
}
