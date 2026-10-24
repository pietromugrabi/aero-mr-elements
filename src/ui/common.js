// Utilidades compartilhadas pelas telas.
import { h } from './dom.js';
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

export function pageHead(title, desc, ...right) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), desc ? h('p', null, desc) : null), right.length ? h('div', { class: 'row' }, ...right) : null);
}

export const hasExample = (run) => run?.dps?.some((d) => d.outputs?.isExample);
export const projectHasExample = (prj) => prj?.packages?.some((k) => k.runs.some(hasExample));

/** Linhas curvas brancas e vermelha, no estilo do logotipo da Mauá Racing (decorativas). */
export const SWOOSH = '<svg class="swoosh" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 58 C 260 8, 720 -6, 1220 30" stroke="#ffffff" stroke-opacity=".16" stroke-width="2" fill="none"/><path d="M380 62 C 640 22, 940 14, 1220 44" stroke="#e10600" stroke-opacity=".45" stroke-width="1.5" fill="none"/></svg>';

/** Faixa de abertura com o logotipo da equipe. */
export function hero(subtitle) {
  const el = h('div', { class: 'hero', html: `${SWOOSH}<img src="src/ui/assets/maua-racing.png" alt="Mauá Racing"><div class="hero-text"><h1>AERO MULT-<span class="mr">MR</span> ELEMENTS</h1><p></p></div>` });
  el.querySelector('p').textContent = subtitle || '';
  return el;
}
