// Casca da aplicação: barra superior (contexto ativo), menu lateral, roteamento por hash e tema.
import { h, toast } from './dom.js';
import * as store from './store.js';
import { projectHasExample, SWOOSH } from './common.js';
import dashboard from './views/dashboard.js';
import projetos from './views/projetos.js';
import geometria from './views/geometria.js';
import dominio from './views/dominio.js';
import malha from './views/malha.js';
import named from './views/named.js';
import fluent from './views/fluent.js';
import inputs from './views/inputs.js';
import outputs from './views/outputs.js';
import graficos from './views/graficos.js';
import comparacao from './views/comparacao.js';
import exportacao from './views/exportacao.js';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', view: dashboard, grp: 'Visão geral' },
  { id: 'projetos', label: 'Projetos', view: projetos },
  { id: 'geometria', label: 'Geometria', view: geometria, grp: 'Preparação', n: 1 },
  { id: 'dominio', label: 'Domínio', view: dominio, n: 2 },
  { id: 'malha', label: 'Mesh', view: malha, n: 3 },
  { id: 'named', label: 'Named Selections', view: named, n: 4 },
  { id: 'fluent', label: 'Fluent Setup & Ref. Values', view: fluent, n: 5 },
  { id: 'inputs', label: 'Inputs / Design Points', view: inputs, grp: 'Estudo', n: 6 },
  { id: 'outputs', label: 'Outputs', view: outputs, n: 7 },
  { id: 'graficos', label: 'Gráficos', view: graficos, grp: 'Análise', n: 8 },
  { id: 'comparacao', label: 'Comparação', view: comparacao, n: 9 },
  { id: 'exportacao', label: 'Exportação', view: exportacao, n: 10 },
];


/** Ícones de linha (24×24, stroke = currentColor) para o menu lateral. */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  projetos: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  geometria: '<path d="M2 14c4-6 12-8 20-5-7 0-13 2-20 5z"/><path d="M12 18c3-3 7-4 10-3-4 .5-7 1.5-10 3z"/>',
  dominio: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M8 13c2-2 5-3 8-2"/>',
  malha: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  named: '<path d="M4 7h10l6 5-6 5H4z"/><circle cx="8" cy="12" r="1.2"/>',
  fluent: '<path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0"/>',
  inputs: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M9 9v11M15 9v11"/>',
  outputs: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  graficos: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-5 3 3 5-7"/>',
  comparacao: '<path d="M7 4v16M17 4v16"/><path d="M3 9h8M13 15h8"/>',
  exportacao: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 14v6h16v-6"/>',
};
const icon = (id) => h('span', { class: 'ico', html: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] || ''}</svg>` });
const root = document.getElementById('app');
let route = (location.hash || '#dashboard').slice(1).split('?')[0];
const viewState = {}; // estado de interface por tela (abas, filtros) — não persistido

function setTheme(t) {
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('aero-tema', t); } catch { /* ignore */ }
  render();
}
const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function topbar() {
  const st = store.getState();
  const prj = store.activeProject(), pkg = store.activePackage(), run = store.activeRun();
  const sel = (items, cur, onChange, empty) => h('select', { onchange: (e) => onChange(e.target.value), title: empty },
    items.length ? items.map((i) => h('option', { value: i.id, selected: cur && i.id === cur.id ? true : null }, i.name)) : h('option', { value: '' }, empty));
  return h('header', { class: 'topbar' },
    h('button', { class: 'menu-btn icon-btn', onclick: () => root.firstChild.classList.toggle('nav-open'), 'aria-label': 'Menu' }, '☰'),
    h('div', { html: SWOOSH, style: { display: 'contents' } }),
    h('a', { class: 'brand', href: '#dashboard', title: 'AERO MULT-MR ELEMENTS — Mauá Racing', html: '<img src="src/ui/assets/maua-racing.png" alt="Mauá Racing"><span class="sepv"></span><span class="brand-name">AERO MULT-<span class="mr">MR</span> ELEMENTS<small>Mauá Racing · aerodinâmica</small></span>' }),
    h('div', { class: 'ctx' },
      h('span', { class: 'muted' }, 'Projeto'), sel(st.projects, prj, (id) => store.setActive({ projectId: id }), '— sem projetos —'),
      h('span', { class: 'sep' }, '›'), h('span', { class: 'muted' }, 'Pacote'), sel(prj?.packages || [], pkg, (id) => store.setActive({ packageId: id }), '— sem pacotes —'),
      h('span', { class: 'sep' }, '›'), h('span', { class: 'muted' }, 'Rodada'), sel(pkg?.runs || [], run, (id) => store.setActive({ runId: id }), '— sem rodadas —'),
      projectHasExample(prj) ? h('span', { class: 'badge example', title: 'Este projeto contém resultados sintéticos (dados de exemplo)' }, 'dados de exemplo') : null),
    h('select', { title: 'Tema', onchange: (e) => setTheme(e.target.value) },
      [['dark', 'Tema preto'], ['light', 'Tema claro']].map(([v, l]) => h('option', { value: v, selected: currentTheme() === v ? true : null }, l))),
    h('span', { class: 'savestate', id: 'savestate' }, saveText()));
}

function saveText() {
  const p = store.persist;
  if (p.saving) return 'Salvando…';
  const where = [p.idb ? 'navegador' : null, p.server ? 'dados/estado.json' : null].filter(Boolean).join(' + ') || 'não salvo';
  const t = p.lastSaved ? new Date(p.lastSaved).toLocaleTimeString('pt-BR') : '—';
  return `${p.error ? '⚠ ' : ''}Salvo ${t} (${where})`;
}

function sidebar() {
  const items = [];
  SECTIONS.forEach((sct) => {
    if (sct.grp) items.push(h('div', { class: 'grp' }, sct.grp));
    items.push(h('a', { href: `#${sct.id}`, class: route === sct.id ? 'active' : '', onclick: () => root.firstChild.classList.remove('nav-open') }, icon(sct.id), h('span', { class: 'num' }, sct.n ?? ''), sct.label));
  });
  return h('nav', { class: 'sidebar' }, h('div', { class: 'nav' }, items),
    h('div', { class: 'about' }, h('strong', { style: { color: '#fff', letterSpacing: '1px' } }, 'AERO MULT-MR ELEMENTS'), h('br'), 'Prepara, organiza e analisa estudos SolidWorks + ANSYS Workbench/Fluent. Não executa CAD, malha nem CFD.'));
}

let lastMainScroll = 0;
export function render() {
  const sct = SECTIONS.find((x) => x.id === route) || SECTIONS[0];
  const ctx = { project: store.activeProject(), pkg: store.activePackage(), run: store.activeRun(), state: store.getState(), ui: (viewState[sct.id] = viewState[sct.id] || {}), rerender: render, go: (r) => { location.hash = r; } };
  // preserva foco e rolagem
  const ae = document.activeElement, focusKey = ae?.dataset?.k, selStart = ae?.selectionStart;
  const oldMain = root.querySelector('.main');
  if (oldMain) lastMainScroll = oldMain.scrollTop;
  let content;
  try { content = sct.view(ctx); } catch (e) { console.error(e); content = h('div', { class: 'card' }, h('h2', null, 'Erro ao desenhar esta tela'), h('pre', { class: 'out' }, String(e.stack || e))); }
  const main = h('main', { class: 'main' }, content);
  const wasOpen = root.firstChild?.classList?.contains('nav-open');
  root.replaceChildren(h('div', { class: 'app' + (wasOpen ? ' nav-open' : '') }, topbar(), sidebar(), main));
  main.scrollTop = lastMainScroll;
  if (focusKey) {
    const el = main.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
    if (el) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch { /* select */ } }
  }
  document.title = `${sct.label} — AERO MULT-MR ELEMENTS`;
}

window.addEventListener('hashchange', () => { route = (location.hash || '#dashboard').slice(1).split('?')[0]; lastMainScroll = 0; render(); });
store.subscribe((kind) => {
  if (kind === 'save') { const el = document.getElementById('savestate'); if (el) el.textContent = saveText(); return; }
  render();
});
window.addEventListener('beforeunload', () => { store.flush(); });

(async () => {
  try { await store.load(); } catch (e) { toast(`Falha ao carregar dados: ${e.message}`, true); }
  render();
})();
