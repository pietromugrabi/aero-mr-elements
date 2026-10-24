import { h, card, table, badge, promptBox, confirmBox, modal, selectField, textField, toast } from '../dom.js';
import * as store from '../store.js';
import { pageHead } from '../common.js';
import { STATUS, DP_STATUS, newProject, newPackage, newRun, duplicateProject, duplicatePackage, duplicateRun, uid, clone } from '../../core/model.js';
import { applyReferenceStudy } from '../../core/demo.js';
import { S1223_DAT, NACA23012_DAT } from '../../core/samples-data.js';
import { exportProjectJSON, importProjectJSON, backupAll, restoreAll } from '../io.js';
import { loadDemo } from './dashboard.js';

const statusSel = (value, onChange, list = STATUS) => h('select', { onchange: (e) => onChange(e.target.value) }, list.map((s) => h('option', { value: s, selected: s === value ? true : null }, s)));
const notesBox = (value, onChange) => { const t = h('textarea', { style: { minHeight: '64px', fontFamily: 'var(--font)' }, placeholder: 'Notas…' }); t.value = value || ''; t.addEventListener('change', () => onChange(t.value)); return t; };

async function rename(kind, obj) {
  const n = await promptBox(`Renomear ${kind}`, 'Novo nome', obj.name);
  if (n && n !== obj.name) store.update(() => { const old = obj.name; obj.name = n; obj.updatedAt = new Date().toISOString(); }, [kind, n, 'renomeado', `antes: "${obj.name}"`]);
}

async function newPackageDialog() {
  const sel = { tpl: 'branco', n: '3', name: 'Novo pacote' };
  const body = h('div', { class: 'fields' },
    textField({ label: 'Nome', value: sel.name, onChange: (v) => { sel.name = v; } }),
    selectField({ label: 'Número de elementos', value: sel.n, options: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [String(i), String(i)]), onChange: (v) => { sel.n = v; } }),
    selectField({ label: 'Modelo', value: sel.tpl, options: [['branco', 'Em branco (preencher tudo)'], ['s1223', 'Estudo de referência — 3 × S1223'], ['s1223g', 'Estudo de referência — 3 × S1223 + Gurney no el. 3'], ['naca', 'Estudo de referência — 3 × NACA 23012']], onChange: (v) => { sel.tpl = v; } }),
  );
  const r = await modal('Novo pacote', h('div', null, body, h('p', { class: 'muted' }, 'O modelo "estudo de referência" preenche as cotas DS_ padrão (140/90/60 mm, 3/18/33°, gap 7/4,5, overlap 3,5/2,5, pivôs 7/122, 5/77, 3/51) — valores de demonstração, edite à vontade. A folga ao solo e a envergadura nunca são preenchidas automaticamente.')), [{ label: 'Cancelar', value: null }, { label: 'Criar', value: 'ok', primary: true }]);
  if (r !== 'ok') return;
  const n = sel.tpl === 'branco' ? Number(sel.n) : 3;
  const pkg = newPackage(sel.name || 'Novo pacote', n);
  if (sel.tpl === 's1223') applyReferenceStudy(pkg, S1223_DAT, 'S1223');
  if (sel.tpl === 's1223g') applyReferenceStudy(pkg, S1223_DAT, 'S1223', { gurneyOn: true });
  if (sel.tpl === 'naca') applyReferenceStudy(pkg, NACA23012_DAT, 'NACA23012');
  pkg.runs.push(newRun('Rodada 1'));
  store.update((s, c) => { c.project.packages.push(pkg); s.ui.active.packageId = pkg.id; s.ui.active.runId = pkg.runs[0].id; }, ['pacote', pkg.name, 'criado', `${n} elementos, modelo: ${sel.tpl}`]);
}

export default function projetos(ctx) {
  const st = ctx.state, prj = ctx.project, pkg = ctx.pkg, run = ctx.run;
  const ui = ctx.ui;
  const out = [pageHead('Projetos', 'Projetos → pacotes (configuração de geometria/CFD) → rodadas (DOE) → Design Points.',
    h('button', { class: 'primary', onclick: () => store.update((s) => { const p = newProject('Novo projeto'); s.projects.push(p); s.ui.active = { projectId: p.id }; }, null) }, '+ Novo projeto'),
    h('button', { onclick: importProjectJSON }, 'Importar projeto (.json)'),
    h('button', { onclick: loadDemo }, 'Carregar demo'),
    h('button', { onclick: backupAll }, 'Backup completo'),
    h('button', { onclick: restoreAll }, 'Restaurar backup'))];

  out.push(card('Projetos', st.projects.length ? table([
    { label: '', get: (p) => (prj && p.id === prj.id ? badge('ativo', 'info') : h('button', { class: 'small', onclick: () => store.setActive({ projectId: p.id }) }, 'Ativar')) },
    { label: 'Nome', get: (p) => h('span', null, p.name, ' ', p.isDemo ? badge('demo', 'example') : '') },
    { label: 'Status', get: (p) => statusSel(p.status, (v) => store.update(() => { p.status = v; }, null)) },
    { label: 'Pacotes', num: true, get: (p) => p.packages.length },
    { label: 'DPs', num: true, get: (p) => p.packages.reduce((s, k) => s + k.runs.reduce((a, r) => a + r.dps.length, 0), 0) },
    { label: 'Atualizado', get: (p) => new Date(p.updatedAt).toLocaleString('pt-BR') },
    { label: 'Ações', get: (p) => h('div', { class: 'row' },
      h('button', { class: 'small', onclick: () => rename('projeto', p) }, 'Renomear'),
      h('button', { class: 'small', onclick: () => store.update((s) => { const d = duplicateProject(p); s.projects.push(d); }) }, 'Duplicar'),
      h('button', { class: 'small', onclick: () => exportProjectJSON(p) }, 'JSON'),
      h('button', { class: 'small danger', onclick: async () => { if (await confirmBox('Excluir projeto', `Excluir "${p.name}" e todos os seus pacotes, rodadas e resultados? Esta ação não pode ser desfeita (exporte o JSON antes, se necessário).`, 'Excluir', true)) store.update((s) => { s.projects = s.projects.filter((x) => x.id !== p.id); if (s.ui.active.projectId === p.id) s.ui.active = {}; }); } }, 'Excluir')) },
  ], st.projects) : h('p', { class: 'muted' }, 'Nenhum projeto.')));

  if (!prj) return h('div', null, out);

  out.push(card(`Projeto ativo — ${prj.name}`, h('div', { class: 'fields' },
    textField({ label: 'Nome', value: prj.name, onChange: (v) => store.update(() => { prj.name = v; }, ['projeto', v, 'renomeado']) }),
    textField({ label: 'Descrição', value: prj.description, wide: true, onChange: (v) => store.update(() => { prj.description = v; }, ['projeto', prj.name, 'descrição alterada']) })),
  h('h3', null, 'Notas'), notesBox(prj.notes, (v) => store.update(() => { prj.notes = v; }, ['projeto', prj.name, 'notas alteradas']))));

  out.push(card('Pacotes', h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { class: 'primary', onclick: newPackageDialog }, '+ Novo pacote')),
    prj.packages.length ? table([
      { label: '', get: (k) => (pkg && k.id === pkg.id ? badge('ativo', 'info') : h('button', { class: 'small', onclick: () => store.setActive({ packageId: k.id }) }, 'Ativar')) },
      { label: 'Nome', get: (k) => k.name },
      { label: 'Elem.', num: true, get: (k) => k.config.elements.length },
      { label: 'Perfis', get: (k) => k.config.elements.map((e) => e.profileName || '?').join(' / ') },
      { label: 'Gurney', get: (k) => (k.config.elements.some((e) => e.gurney?.enabled) ? 'sim' : 'não') },
      { label: 'Status', get: (k) => statusSel(k.status, (v) => store.update(() => { k.status = v; }, ['pacote', k.name, 'status', v])) },
      { label: 'Rodadas', num: true, get: (k) => k.runs.length },
      { label: 'Ações', get: (k) => h('div', { class: 'row' },
        h('button', { class: 'small', onclick: () => rename('pacote', k) }, 'Renomear'),
        h('button', { class: 'small', onclick: () => store.update((s, c) => { c.project.packages.push(duplicatePackage(k)); }, ['pacote', k.name, 'duplicado']) }, 'Duplicar'),
        h('button', { class: 'small danger', onclick: async () => { if (await confirmBox('Excluir pacote', `Excluir o pacote "${k.name}" com ${k.runs.length} rodada(s)?`, 'Excluir', true)) store.update((s, c) => { c.project.packages = c.project.packages.filter((x) => x.id !== k.id); }, ['pacote', k.name, 'excluído']); } }, 'Excluir')) },
    ], prj.packages) : h('p', { class: 'muted' }, 'Nenhum pacote. Um pacote guarda a geometria, o domínio, a malha, as Named Selections e o setup do Fluent.'),
    pkg ? h('div', null, h('h3', null, `Notas do pacote "${pkg.name}"`), notesBox(pkg.notes, (v) => store.update(() => { pkg.notes = v; }, ['pacote', pkg.name, 'notas alteradas']))) : null));

  if (pkg) {
    out.push(card(`Rodadas do pacote "${pkg.name}"`, h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { class: 'primary', onclick: async () => { const n = await promptBox('Nova rodada', 'Nome', `Rodada ${pkg.runs.length + 1}`); if (n) store.update((s) => { const r = newRun(n); pkg.runs.push(r); s.ui.active.runId = r.id; }, ['rodada', n, 'criada']); } }, '+ Nova rodada')),
      pkg.runs.length ? table([
        { label: '', get: (r) => (run && r.id === run.id ? badge('ativa', 'info') : h('button', { class: 'small', onclick: () => store.setActive({ runId: r.id }) }, 'Ativar')) },
        { label: 'Nome', get: (r) => r.name },
        { label: 'Método', get: (r) => ({ fatorial: 'fatorial completo', oat: 'um fator por vez', manual: 'manual' })[r.doe.method] || r.doe.method },
        { label: 'DPs', num: true, get: (r) => r.dps.length },
        { label: 'Com resultado', num: true, get: (r) => r.dps.filter((d) => d.outputs?.raw).length },
        { label: 'Status', get: (r) => statusSel(r.status, (v) => store.update(() => { r.status = v; }, ['rodada', r.name, 'status', v])) },
        { label: 'Ações', get: (r) => h('div', { class: 'row' },
          h('button', { class: 'small', onclick: () => rename('rodada', r) }, 'Renomear'),
          h('button', { class: 'small', onclick: () => store.update(() => { pkg.runs.push(duplicateRun(r)); }, ['rodada', r.name, 'duplicada']) }, 'Duplicar'),
          h('button', { class: 'small danger', onclick: async () => { if (await confirmBox('Excluir rodada', `Excluir "${r.name}" com ${r.dps.length} DP(s)?`, 'Excluir', true)) store.update(() => { pkg.runs = pkg.runs.filter((x) => x.id !== r.id); }, ['rodada', r.name, 'excluída']); } }, 'Excluir')) },
      ], pkg.runs) : h('p', { class: 'muted' }, 'Nenhuma rodada.'),
      run ? h('div', null, h('h3', null, `Notas da rodada "${run.name}"`), notesBox(run.notes, (v) => store.update(() => { run.notes = v; }, ['rodada', run.name, 'notas alteradas']))) : null));
  }

  if (run) {
    const lim = ui.dpAll ? run.dps.length : 30;
    out.push(card(`Design Points da rodada "${run.name}" (${run.dps.length})`,
      h('p', { class: 'muted' }, 'Entradas e resultados são editados em ', h('a', { href: '#inputs' }, 'Inputs'), ' e ', h('a', { href: '#outputs' }, 'Outputs'), '.'),
      run.dps.length ? table([
        { label: 'DP', get: (d) => d.name },
        { label: 'Status', get: (d) => statusSel(d.status, (v) => store.update(() => { d.status = v; }, ['DP', `${run.name}/${d.name}`, 'status', v]), DP_STATUS) },
        { label: 'Resultado', get: (d) => (d.outputs?.raw ? badge(d.outputs.isExample ? 'exemplo' : 'importado', d.outputs.isExample ? 'example' : 'ok') : badge('sem', '')) },
        { label: 'Notas', get: (d) => { const i = h('input', { type: 'text', value: d.notes || '', style: { width: '100%' } }); i.addEventListener('change', () => store.update(() => { d.notes = i.value; }, ['DP', `${run.name}/${d.name}`, 'nota'])); return i; } },
        { label: 'Ações', get: (d) => h('div', { class: 'row' },
          h('button', { class: 'small', onclick: () => rename('DP', d) }, 'Renomear'),
          h('button', { class: 'small', onclick: () => store.update(() => { const c = clone(d); c.id = uid('dp'); c.name = `${d.name} (cópia)`; c.outputs = null; c.status = 'pendente'; run.dps.splice(run.dps.indexOf(d) + 1, 0, c); }, ['DP', d.name, 'duplicado']) }, 'Duplicar'),
          h('button', { class: 'small danger', onclick: () => store.update(() => { run.dps = run.dps.filter((x) => x !== d); }, ['DP', `${run.name}/${d.name}`, 'excluído']) }, 'Excluir')) },
      ], run.dps.slice(0, lim), { tall: true }) : h('p', { class: 'muted' }, 'Sem DPs. Gere-os em Inputs / Design Points.'),
      run.dps.length > 30 ? h('button', { class: 'small', onclick: () => { ui.dpAll = !ui.dpAll; ctx.rerender(); } }, ui.dpAll ? 'Mostrar menos' : `Mostrar todos (${run.dps.length})`) : null));
  }

  const q = (ui.histQ || '').toLowerCase();
  const hist = prj.history.filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q));
  const qi = h('input', { type: 'text', placeholder: 'Filtrar histórico…', value: ui.histQ || '', dataset: { k: 'histq' } });
  qi.addEventListener('input', () => { ui.histQ = qi.value; ctx.rerender(); });
  out.push(card(`Histórico de alterações (${prj.history.length})`, qi, h('div', { style: { height: '8px' } }),
    table([{ label: 'Quando', get: (e) => new Date(e.ts).toLocaleString('pt-BR') }, { label: 'Tipo', get: (e) => e.entity }, { label: 'Item', get: (e) => e.name }, { label: 'Ação', get: (e) => e.action }, { label: 'Detalhe', get: (e) => e.detail || '' }], hist.slice(0, 200), { tall: true })));
  void toast;
  return h('div', null, out);
}
