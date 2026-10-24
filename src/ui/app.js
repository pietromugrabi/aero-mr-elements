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
      projectHasExample(prj) ? h('span', { class: 'badge example', title: 'Este projeto contém resultados sintéticos de demonstração' }, 'dados de exemplo') : null),
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
    items.push(h('a', { href: `#${sct.id}`, class: route === sct.id ? 'active' : '', onclick: () => root.firstChild.classList.remove('nav-open') }, h('span', { class: 'num' }, sct.n ?? ''), sct.label));
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
