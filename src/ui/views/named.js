import { h, card, msgs, confirmBox, badge } from '../dom.js';
import * as store from '../store.js';
import { needs, pageHead } from '../common.js';
import { validateNamedSelections, defaultNamedSelections } from '../../core/namedsel.js';

const BCS = ['velocity-inlet', 'pressure-outlet', 'symmetry', 'wall', 'wall (moving)', 'pressure-far-field', 'interior', 'outro'];
const TYPES = ['Aresta', 'Face', 'Corpo', 'Vértice'];

export default function named(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, c = pkg.config, list = c.namedSelections;
  const issues = validateNamedSelections(list, c.elements.length, { ground: c.domain.groundEnabled });
  const edit = (s, k, v) => store.update(() => { s[k] = v; s.edited = true; }, ['named selection', s.name, `${k} alterado`, v]);
  const cell = (s, k, wide) => { const i = h('input', { type: 'text', class: 'cell' + (wide ? ' wide' : ''), value: s[k] || '', style: { width: wide ? '100%' : '150px', textAlign: 'left' }, dataset: { k: `ns_${list.indexOf(s)}_${k}` } }); i.addEventListener('change', () => edit(s, k, i.value.trim())); return i; };
  const sel = (s, k, opts) => h('select', { onchange: (e) => edit(s, k, e.target.value) }, opts.map((o) => h('option', { value: o, selected: s[k] === o ? true : null }, o)), opts.includes(s[k]) ? null : h('option', { selected: true, value: s[k] }, s[k]));
  return h('div', null,
    pageHead(`Named Selections — ${pkg.name}`, 'Lista gerada a partir do domínio e dos elementos. Edite à vontade; os nomes são usados nas condições de contorno e nos relatórios de força.',
      h('button', { onclick: () => store.update(() => { list.push({ name: `ns_${list.length + 1}`, type: c.mode === '3D' ? 'Face' : 'Aresta', entities: '', description: '', bc: 'wall', notes: '', custom: true, edited: true }); }, ['named selection', pkg.name, 'adicionada']) }, '+ Adicionar'),
      h('button', { onclick: async () => { if (await confirmBox('Regenerar lista', 'Recria inlet, outlet, ground/symmetry e wall_element_1..N com os textos padrão, descartando edições.', 'Regenerar', true)) store.update(() => { c.namedSelections = defaultNamedSelections(c.elements.length, { ground: c.domain.groundEnabled, gurney: c.elements.map((e) => !!e.gurney?.enabled), dim: c.mode, groundMoving: c.domain.groundMoving }); }, ['named selection', pkg.name, 'lista regenerada']); } }, 'Regenerar padrão')),
    card(null, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Nome', 'Tipo', 'Entidades / superfícies', 'Descrição', 'Condição de contorno', 'Notas', ''].map((t) => h('th', null, t)))),
      h('tbody', null, list.map((s) => h('tr', null,
        h('td', null, cell(s, 'name')), h('td', null, sel(s, 'type', TYPES)), h('td', { style: { minWidth: '260px' } }, cell(s, 'entities', true)),
        h('td', null, cell(s, 'description')), h('td', null, sel(s, 'bc', BCS)), h('td', null, cell(s, 'notes')),
        h('td', null, h('button', { class: 'small danger', onclick: () => store.update(() => { c.namedSelections = list.filter((x) => x !== s); }, ['named selection', s.name, 'removida']) }, 'Remover'))))))),
      h('h3', null, 'Validação'), issues.length ? msgs(issues) : msgs([{ level: 'ok', msg: 'Nomes válidos, sem duplicatas, todas as paredes presentes e nenhuma entidade em duas Named Selections.' }]),
      c.elements.some((e) => e.gurney?.enabled) ? msgs([{ level: 'info', msg: 'Elementos com Gurney: inclua as 3 arestas do Gurney na Named Selection da parede do elemento (o Gurney e o perfil formam um único contorno).' }]) : null,
      h('p', { class: 'muted' }, 'No DesignModeler/Meshing: selecione as entidades → botão direito → Create Named Selection, com exatamente estes nomes. ', badge('não aplicado automaticamente', 'warn'))));
}
