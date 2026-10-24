// Utilidades compartilhadas pelas telas.
import { h } from './dom.js';
import * as store from './store.js';
import { buildWing } from '../core/wing.js';
import { computeDomain } from '../core/domain.js';

const memo = new Map();
/** buildWing com cache por conteúdo da configuração e das entradas. */
export function wingOf(pkg, inputs = null) {
  const key = JSON.stringify([pkg.config, inputs]);
  if (memo.has(key)) return memo.get(key);
  let w;
  try { w = buildWing(pkg, inputs); } catch (e) { w = { ok: false, errors: [`Erro ao montar: ${e.message}`], procs: [] }; }
  if (memo.size > 60) memo.clear();
  memo.set(key, w);
  return w;
}

export function domainOf(pkg, wing) {
  if (!wing?.plane) return null;
  return computeDomain(wing.bbox, wing.plane.map((e) => e.chord), pkg.config.domain, pkg.config.transform.sx);
}

export function needs(what, ctx) {
  const msg = { project: 'Nenhum projeto selecionado.', pkg: 'Nenhum pacote selecionado neste projeto.', run: 'Nenhuma rodada selecionada neste pacote.' };
  for (const w of what) {
    if ((w === 'project' && !ctx.project) || (w === 'pkg' && !ctx.pkg) || (w === 'run' && !ctx.run)) {
      return h('div', { class: 'empty' }, h('p', null, msg[w]), h('p', null, 'Crie ou selecione em ', h('a', { href: '#projetos' }, 'Projetos'), ' (ou carregue o projeto de exemplo no ', h('a', { href: '#dashboard' }, 'Dashboard'), ').'));
    }
  }
  return null;
}

export function swatch(i) { return h('span', { class: 'el-swatch', style: { background: `var(--s${(i % 8) + 1})` } }); }

/**
 * Cabeçalho de tela no formato do carimbo de um desenho técnico: título à esquerda e, à direita,
 * os campos do "carimbo" (projeto, pacote, rodada e situação). O sufixo " — nome" do título vai para o carimbo.
 * Selos (badges) entram como situação; botões ficam numa linha abaixo.
 */
export function pageHead(title, desc, ...right) {
  const prj = store.activeProject(), pkg = store.activePackage(), run = store.activeRun();
  const [head, ...rest] = String(title).split(' — '), suffix = rest.join(' — ');
  const main = suffix && [pkg?.name, run?.name, `${pkg?.name} / ${run?.name}`].includes(suffix) ? head : String(title);
  const cells = [['Projeto', prj?.name], ['Pacote', pkg?.name], ['Rodada', run?.name]].filter(([, v]) => v && v !== main);
  const items = right.filter(Boolean);
  const isBadge = (e) => e instanceof Element && e.classList.contains('badge');
  const status = items.filter(isBadge), actions = items.filter((e) => !isBadge(e));
  const cell = (k, ...v) => h('div', null, h('dt', null, k), h('dd', null, ...v));
  return h('header', { class: 'page-head' },
    h('div', { class: 'ph-title' }, h('h1', null, main), desc ? h('p', null, desc) : null),
    cells.length || status.length ? h('dl', { class: 'title-block' }, ...cells.map(([k, v]) => cell(k, v)), status.length ? cell('Situação', ...status) : null) : null,
    actions.length ? h('div', { class: 'ph-actions row' }, ...actions) : null);
}

export const hasExample = (run) => run?.dps?.some((d) => d.outputs?.isExample);
export const projectHasExample = (prj) => prj?.packages?.some((k) => k.runs.some(hasExample));

/** Linhas curvas brancas e vermelha, no estilo do logotipo da Mauá Racing (decorativas). */
export const SWOOSH = '<svg class="swoosh" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 58 C 260 8, 720 -6, 1220 30" stroke="#ffffff" stroke-opacity=".16" stroke-width="2" fill="none"/><path d="M380 62 C 640 22, 940 14, 1220 44" stroke="#e10600" stroke-opacity=".45" stroke-width="1.5" fill="none"/></svg>';

/**
 * Prolongamento das linhas do logotipo, no sistema de coordenadas da própria imagem (325 × 155 px):
 * a curva branca termina em (≈288, 80) já quase horizontal; a linha segue dali e some aos poucos.
 * O traço vermelho sai da base da barra diagonal (≈300, 118).
 */
const LOGO_TRAIL = '<svg class="logo-trail" viewBox="0 0 325 155" aria-hidden="true"><defs>'
  + '<linearGradient id="trail-w" gradientUnits="userSpaceOnUse" x1="284" y1="0" x2="1700" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
  + '<linearGradient id="trail-r" gradientUnits="userSpaceOnUse" x1="300" y1="0" x2="1900" y2="0"><stop offset="0" stop-color="#e10600"/><stop offset="1" stop-color="#e10600" stop-opacity="0"/></linearGradient></defs>'
  + '<path d="M 282 80.5 C 600 80, 1000 74, 1700 52" stroke="url(#trail-w)" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
  + '<path d="M 300 120 C 700 119, 1150 110, 1900 88" stroke="url(#trail-r)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';

/** Faixa de abertura com o logotipo da equipe. */
export function hero(subtitle) {
  const el = h('div', { class: 'hero', html: `<span class="hero-logo">${LOGO_TRAIL}<img src="src/ui/assets/maua-racing-transparente.png" alt="Mauá Racing"></span><div class="hero-text"><h1>AERO MULT-<span class="mr">MR</span> ELEMENTS</h1><p></p></div>` });
  el.querySelector('p').textContent = subtitle || '';
  return el;
}
