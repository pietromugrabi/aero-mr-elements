import { h, card, numField, selectField, checkField, msgs, table, badge } from '../dom.js';
import * as store from '../store.js';
import { wingOf, domainOf, needs, pageHead } from '../common.js';
import { geomPlot } from '../plots.js';
import { planeAxes, directions } from '../../core/transform.js';
import { syncDependentLists } from '../../core/model.js';
import { fmt } from '../../core/num.js';

export default function dominio(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, d = pkg.config.domain, ui = ctx.ui;
  const w = wingOf(pkg);
  const set = (k, v, label) => store.update(() => { d[k] = v; if (k === 'groundEnabled' || k === 'groundMoving') syncDependentLists(pkg.config); }, ['domínio', pkg.name, `${label} alterado`, String(v)]);
  const form = card('Parâmetros (múltiplos de C)',
    h('div', { class: 'fields' },
      selectField({ label: 'C (comprimento de referência)', value: d.chordBasis, options: [['soma', 'C_soma = Σ chord_n'], ['principal', 'corda do elemento 1']], onChange: (v) => set('chordBasis', v, 'base de C') }),
      numField({ label: 'Montante (inlet)', unit: '× C', value: d.upstream, key: 'up', onChange: (v) => set('upstream', v ?? 6, 'montante'), hint: 'padrão 6·C' }),
      numField({ label: 'Jusante (outlet)', unit: '× C', value: d.downstream, key: 'down', onChange: (v) => set('downstream', v ?? 10, 'jusante'), hint: 'padrão 10·C' }),
      numField({ label: 'Acima (symmetry_top)', unit: '× C', value: d.above, key: 'above', onChange: (v) => set('above', v ?? 5, 'acima'), hint: 'padrão 5·C' }),
      !d.groundEnabled ? numField({ label: 'Abaixo', unit: '× C', value: d.below, key: 'below', onChange: (v) => set('below', v ?? 5, 'abaixo'), hint: 'padrão 5·C' }) : null,
    ),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      checkField({ label: 'Solo (efeito solo) como fronteira inferior', checked: d.groundEnabled, onChange: (v) => set('groundEnabled', v, 'solo') }),
      d.groundEnabled ? checkField({ label: 'Solo móvel (velocidade = Uinf)', checked: d.groundMoving, onChange: (v) => set('groundMoving', v, 'solo móvel') }) : null),
    d.groundEnabled ? h('div', { class: 'fields', style: { marginTop: '8px' } }, numField({ label: 'Folga ao solo h (ponto mais baixo → solo)', unit: 'mm', value: d.groundClearance, required: true, key: 'hgr', onChange: (v) => set('groundClearance', v, 'folga ao solo') })) : null,
    h('p', { class: 'muted' }, 'Distâncias medidas a partir dos extremos da montagem (bounding box) na referência do pacote.'));

  if (!w.plane) return h('div', null, pageHead(`Domínio — ${pkg.name}`), form, card('Resultado', msgs(w.errors.map((m) => ({ level: 'erro', msg: m })))));
  const dom = domainOf(pkg, w);
  const [hx, vy] = planeAxes(pkg.config.transform.plane), dir = directions(pkg.config.transform);
  ui.zoom = ui.zoom || 'dominio';
  const r = dom.rect;
  const scene = () => ({
    elements: wingOf(pkg).plane, rect: r, ground: d.groundEnabled, axes: [hx, vy], flow: [pkg.config.transform.sx, 0], lift: [0, pkg.config.transform.sy],
    fitPts: ui.zoom === 'asa' ? wingOf(pkg).plane.flatMap((e) => e.pts) : undefined,
    rectLabels: [
      { x: dom.inletX, y: (r.ymin + r.ymax) / 2, text: 'inlet', anchor: pkg.config.transform.sx < 0 ? 'end' : 'start' },
      { x: dom.outletX, y: (r.ymin + r.ymax) / 2, text: 'outlet', anchor: pkg.config.transform.sx < 0 ? 'start' : 'end' },
      { x: (r.xmin + r.xmax) / 2, y: r.ymax, text: 'symmetry_top' },
      { x: (r.xmin + r.xmax) / 2, y: r.ymin, text: d.groundEnabled ? 'ground' : 'symmetry_bottom' },
    ],
  });
  const plot = geomPlot(scene, { height: 420, show: { pivots: false, chords: false, gaps: false, labels: false, clearance: false }, name: `dominio_${pkg.name}` });
  return h('div', null,
    pageHead(`Domínio — ${pkg.name}`, `Retângulo 2D no plano ${pkg.config.transform.plane}. Escoamento ${dir.flowLabel}.`, dom.errors.length ? badge('incompleto', 'err') : badge('definido', 'ok')),
    h('div', { class: 'grid g-side' }, form,
      card('Resultado',
        h('div', { class: 'kv' },
          h('dt', null, 'C'), h('dd', null, `${fmt(dom.C, 2)} mm (${d.chordBasis === 'soma' ? 'Σ cordas' : 'corda 1'})`),
          h('dt', null, 'Extremos da montagem'), h('dd', null, `${hx} ∈ [${fmt(dom.assembly.xmin, 2)}; ${fmt(dom.assembly.xmax, 2)}], ${vy} ∈ [${fmt(dom.assembly.ymin, 2)}; ${fmt(dom.assembly.ymax, 2)}] mm`),
          h('dt', null, 'Tamanho'), h('dd', null, `${fmt(dom.length, 1)} × ${fmt(dom.height, 1)} mm  (${fmt(dom.length / dom.C, 2)}·C × ${fmt(dom.height / dom.C, 2)}·C)`)),
        table([{ label: 'Fronteira', get: (x) => x[0] }, { label: 'Distância', unit: 'mm', num: true, get: (x) => fmt(x[1], 2) }, { label: 'Coordenada', get: (x) => x[2] }], [
          ['inlet (montante)', dom.dist.upstream, `${hx} = ${fmt(dom.inletX, 2)} mm`], ['outlet (jusante)', dom.dist.downstream, `${hx} = ${fmt(dom.outletX, 2)} mm`],
          ['symmetry_top', dom.dist.above, `${vy} = ${fmt(dom.topY, 2)} mm`], [d.groundEnabled ? 'ground' : 'inferior', dom.dist.below, `${vy} = ${fmt(dom.bottomY, 2)} mm`]]),
        msgs([...dom.errors.map((m) => ({ level: 'erro', msg: m })), ...dom.warnings.map((m) => ({ level: 'aviso', msg: m })), ...dom.recommendations.map((m) => ({ level: 'rec', msg: m }))]),
        pkg.config.mode === '3D' ? msgs([{ level: 'info', msg: '3D: a extensão lateral do domínio não é calculada aqui; defina-a no DesignModeler a partir da envergadura informada.' }]) : null)),
    card('Visualização', h('div', { class: 'row', style: { marginBottom: '8px' } }, h('div', { class: 'seg' },
      h('button', { class: ui.zoom === 'dominio' ? 'on' : '', onclick: () => { ui.zoom = 'dominio'; plot.redraw(true); ctx.rerender(); } }, 'Domínio inteiro'),
      h('button', { class: ui.zoom === 'asa' ? 'on' : '', onclick: () => { ui.zoom = 'asa'; plot.redraw(true); ctx.rerender(); } }, 'Aproximar na asa'))), plot));
}
