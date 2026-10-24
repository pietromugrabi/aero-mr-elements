import { h, card, numField, selectField, checkField, msgs, fv, badge } from '../dom.js';
import * as store from '../store.js';
import { wingOf, needs, pageHead } from '../common.js';
import { MESH_METHODS, meshSuggestions, inflationThickness } from '../../core/mesh.js';
import { DEFAULT_FLUENT } from '../../core/fluent.js';

export function suggestionsFor(pkg) {
  const w = wingOf(pkg);
  if (!w.plane) return null;
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const U = Number(f.Uinf);
  if (!(U > 0)) return { missing: 'Informe Uinf (Fluent Setup) para calcular a 1ª camada.' };
  return meshSuggestions({
    chords: w.plane.map((e) => e.chord), rho: f.rho, U, mu: f.mu, yplus: pkg.config.mesh.yplusTarget || 1,
    teRadius: w.procs.map((p, i) => (p.te?.ok ? p.te.r * w.plane[i].chord : null)),
    slotClearance: w.asm.slots.map((s) => s.clearance), gurney: w.asm.elements.map((e) => e.gurney), C: w.chordSum,
  });
}

const sug = (v, unit = 'mm') => (Number.isFinite(v) ? h('span', { class: 'badge info', title: 'Sugestão heurística — não é resultado de malha' }, `sugestão: ${fv(v, 3)} ${unit}`) : null);

export default function malha(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, m = pkg.config.mesh;
  const S = suggestionsFor(pkg);
  const set = (fn, label, v) => store.update(fn, ['malha', pkg.name, label, v == null ? '' : String(v)]);
  const applyAll = () => set(() => {
    m.globalMax = +S.globalMax.toPrecision(4);
    S.perElement.forEach((e, i) => {
      const inf = m.inflation.find((x) => x.surface === e.surface); if (inf) { inf.firstLayer = +e.y1.toPrecision(3); inf.layers = e.layers; inf.growth = e.growth; inf.enabled = true; inf.fromSuggestion = true; }
      const es = m.edgeSizing.find((x) => x.target === e.surface); if (es) { es.type = 'tamanho'; es.value = +e.edgeSize.toPrecision(3); es.fromSuggestion = true; }
      if (i === 0) { m.refinements.le.size = +e.leSize.toPrecision(3); m.refinements.te.size = +e.teSize.toPrecision(3); }
    });
    if (S.slotSize.some(Number.isFinite)) m.refinements.gap.size = +Math.min(...S.slotSize.filter(Number.isFinite)).toPrecision(3);
    m.refinements.flap.size = +S.flapSize.toPrecision(3);
    if (S.gurneySize.some(Number.isFinite)) m.refinements.gurney.size = +Math.min(...S.gurneySize.filter(Number.isFinite)).toPrecision(3);
    m.refinements.ground.size = +S.groundSize.toPrecision(3);
    m.refinements.wake.size = +S.wakeSize.toPrecision(3);
  }, 'sugestões aplicadas');

  const refRows = Object.entries(m.refinements).map(([k, r]) => {
    const sv = S && !S.missing ? { le: S.perElement[0]?.leSize, te: S.perElement[0]?.teSize, gap: Math.min(...S.slotSize.filter(Number.isFinite)), flap: S.flapSize, gurney: Math.min(...S.gurneySize.filter(Number.isFinite)), ground: S.groundSize, wake: S.wakeSize }[k] : null;
    return h('tr', null,
      h('td', null, checkField({ label: r.label, checked: r.enabled, onChange: (v) => set(() => { r.enabled = v; }, `refinamento ${k}`, v) })),
      h('td', null, numField({ unit: 'mm', value: r.size, key: `ref_${k}`, onChange: (v) => set(() => { r.size = v; }, `refinamento ${k}`, v) })),
      k === 'wake' ? h('td', null, numField({ unit: '× C', value: r.length, key: 'wakeL', onChange: (v) => set(() => { r.length = v; }, 'comprimento da esteira', v) })) : h('td', null, ''),
      h('td', null, Number.isFinite(sv) ? sug(sv) : ''));
  });

  return h('div', null,
    pageHead(`Mesh — ${pkg.name}`, 'Plano de malha para aplicar no ANSYS Meshing. Este aplicativo não gera nem verifica malhas.', badge('plano — não é malha gerada', 'warn')),
    card('Configuração global', h('div', { class: 'fields' },
      selectField({ label: 'Método', value: m.method, options: MESH_METHODS, onChange: (v) => set(() => { m.method = v; }, 'método', v) }),
      numField({ label: 'Tamanho máximo global', unit: 'mm', value: m.globalMax, key: 'gmax', onChange: (v) => set(() => { m.globalMax = v; }, 'tamanho global', v), hint: S && !S.missing ? `sugestão: ${fv(S.globalMax, 3)} mm (C/2)` : null }),
      numField({ label: 'Taxa de crescimento', unit: '—', value: m.growthRate, key: 'gr', onChange: (v) => set(() => { m.growthRate = v; }, 'crescimento', v) }),
      numField({ label: 'y+ alvo', unit: '—', value: m.yplusTarget, key: 'yp', onChange: (v) => set(() => { m.yplusTarget = v || 1; }, 'y+ alvo', v), hint: '≈1 para k-ω SST resolvendo a subcamada' })),
      S?.missing ? msgs([{ level: 'aviso', msg: S.missing }]) : S ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { onclick: applyAll }, 'Aplicar todas as sugestões'), h('small', { class: 'muted' }, S.note)) : msgs([{ level: 'aviso', msg: 'Geometria incompleta: sem sugestões.' }])),
    card('Inflation por superfície', h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Superfície', 'Ativo', 'Camadas', 'Crescimento', '1ª camada', 'Espessura total', 'Sugestão (y+)'].map((t) => h('th', null, t)))),
      h('tbody', null, m.inflation.map((inf) => {
        const e = S && !S.missing ? S.perElement.find((x) => x.surface === inf.surface) : null;
        const tot = inf.firstLayer && inf.layers ? inflationThickness(inf.firstLayer, inf.growth || 1.2, inf.layers) : null;
        return h('tr', null, h('td', null, h('code', null, inf.surface)),
          h('td', null, checkField({ checked: inf.enabled, onChange: (v) => set(() => { inf.enabled = v; }, `inflation ${inf.surface}`, v) })),
          h('td', null, numField({ unit: 'cam.', value: inf.layers, key: `il_${inf.surface}`, onChange: (v) => set(() => { inf.layers = v == null ? null : Math.round(v); }, `camadas ${inf.surface}`, v) })),
          h('td', null, numField({ unit: '—', value: inf.growth, key: `ig_${inf.surface}`, onChange: (v) => set(() => { inf.growth = v; }, `crescimento ${inf.surface}`, v) })),
          h('td', null, numField({ unit: 'mm', value: inf.firstLayer, key: `if_${inf.surface}`, onChange: (v) => set(() => { inf.firstLayer = v; }, `1ª camada ${inf.surface}`, v) })),
          h('td', { class: 'num' }, tot ? `${fv(tot, 3)} mm` : '—'),
          h('td', null, e ? h('small', null, `y₁ = ${e.y1.toExponential(2)} mm, ${e.layers} cam. (Re = ${e.Re.toExponential(2)}, δ ≈ ${fv(e.delta, 3)} mm)`) : ''));
      }))))),
    card('Edge sizing dos elementos', h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Alvo', 'Tipo', 'Valor', 'Bias', 'Sugestão'].map((t) => h('th', null, t)))),
      h('tbody', null, m.edgeSizing.map((es) => {
        const e = S && !S.missing ? S.perElement.find((x) => x.surface === es.target) : null;
        return h('tr', null, h('td', null, h('code', null, es.target)),
          h('td', null, selectField({ value: es.type, options: [['divisoes', 'nº de divisões'], ['tamanho', 'tamanho de elemento']], onChange: (v) => set(() => { es.type = v; }, `edge sizing ${es.target}`, v) })),
          h('td', null, numField({ unit: es.type === 'tamanho' ? 'mm' : 'div.', value: es.value, key: `es_${es.target}`, onChange: (v) => set(() => { es.value = v; }, `edge sizing ${es.target}`, v) })),
          h('td', null, numField({ unit: '—', value: es.bias, key: `eb_${es.target}`, onChange: (v) => set(() => { es.bias = v; }, `bias ${es.target}`, v) })),
          h('td', null, e ? sug(es.type === 'tamanho' ? e.edgeSize : e.divisions, es.type === 'tamanho' ? 'mm' : 'div.') : ''));
      }))))),
    card('Refinamentos locais (vertex/edge sizing, bodies of influence)', h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Região', 'Tamanho', 'Extensão', 'Sugestão'].map((t) => h('th', null, t)))), h('tbody', null, refRows)))),
    card('Notas do plano', (() => { const t = h('textarea', { placeholder: 'Ex.: estudo de independência de malha, qualidade mínima, etc.' }); t.value = m.notes || ''; t.addEventListener('change', () => set(() => { m.notes = t.value; }, 'notas')); return t; })()));
}
