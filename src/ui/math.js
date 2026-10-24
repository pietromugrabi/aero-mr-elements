// Fórmulas bonitas e copiáveis. O texto continua sendo o mesmo texto digitado de antes (fonte da
// verdade); aqui ele só ganha desenho: frações empilhadas, raízes com barra, matrizes, índices,
// variáveis em itálico matemático e Σ grande. Cada pedaço desenhado guarda o trecho original em
// data-src, e o Ctrl+C devolve exatamente esse texto (ver installMathCopy).
import { h, toast } from './dom.js';

const GREEK = 'θσρπ';
// variáveis de uma letra desenhadas em itálico (sem 'a', 'e', 'o': são palavras em português)
const VARS = new RegExp(`(^|[^A-Za-zÀ-ÿ_${GREEK}])([xycspqTULDXYRCnr${GREEK}])(?=$|[^A-Za-zÀ-ÿ_${GREEK}0-9])`, 'g');
const IDENT = `[A-Za-z${GREEK}][A-Za-z0-9${GREEK}]*(?:_(?:\\([^()]*\\)|[A-Za-z0-9∞]+))*`;
const ATOM = `(?:${IDENT}|[0-9]+(?:[.,][0-9]+)?)`;
// padrões em ordem de prioridade; cada um vira um nó com data-src = trecho casado
const PATTERNS = [
  { re: /\[\[([^\],]+),\s*([^\]]+)\],\s*\[([^\],]+),\s*([^\]]+)\]\]/y, make: (m) => matrix([m[1], m[2], m[3], m[4]]) },
  { re: /([√∛∜])\(((?:[^()]|\([^()]*\))*)\)/y, make: (m) => radical(m[1], m[2]) },
  { re: new RegExp(`(${ATOM})\\s*\\/\\s*(\\((?:[^()]|\\([^()]*\\))*\\)|${ATOM})`, 'y'), make: (m) => frac(m[1], m[2].replace(/^\((.*)\)$/, '$1')) },
  { re: /½/y, make: () => frac('1', '2') },
  { re: /Σ/y, make: () => h('span', { class: 'm-bigop' }, 'Σ') },
  { re: /([A-Za-z])∞/y, make: (m) => h('span', null, mi(m[1]), h('sub', null, '∞')) },
  { re: new RegExp(IDENT, 'y'), make: (m) => ident(m[0]), test: (s) => s.includes('_') },
];

const mi = (t) => h('i', { class: 'm-i' }, t);

/** Identificador com índice: A_ref → A_ref; BA_(n−1) → BA_(n−1); pivot_dTE_n → pivot_dTE_n (nome de código + índice n). */
function ident(src) {
  const parts = src.split(/_(?![^(]*\))/);
  const last = parts[parts.length - 1], base = parts.slice(0, -1).join('_');
  const sub = h('sub', null, ...inline(last.replace(/^\((.*)\)$/, '$1')));
  if (parts.length === 2) return h('span', { class: 'm-id' }, base.length === 1 ? mi(base) : h('span', null, ...inline(base)), sub);
  // nome com vários "_": é um nome de variável do app — fica reto, só o índice final (n, n−1, dígito) desce
  if (/^(n|\(n[−-]1\)|[0-9]+)$/.test(last)) return h('span', { class: 'm-id' }, h('span', { class: 'm-code' }, base), sub);
  return h('span', { class: 'm-code' }, src);
}

function frac(num, den) {
  return h('span', { class: 'm-frac' }, h('span', { class: 'm-num' }, ...inline(num)), h('span', { class: 'm-den' }, ...inline(den)));
}

function radical(sign, body) {
  const idx = { '∛': '3', '∜': '4' }[sign];
  return h('span', { class: 'm-sqrt' }, idx ? h('sup', { class: 'm-root-idx' }, idx) : null, h('span', { class: 'm-rad' }, '√'), h('span', { class: 'm-rad-body' }, ...inline(body)));
}

function matrix(cells) {
  return h('span', { class: 'm-mat' }, h('span', { class: 'm-mat-grid' }, ...cells.map((c) => h('span', null, ...inline(c.trim())))));
}

/** Texto simples → nós: variáveis de uma letra em itálico, o resto como está. */
function plain(text) {
  const out = [];
  let last = 0;
  text.replace(VARS, (m, pre, v, off) => {
    const start = off + pre.length;
    if (start > last) out.push(text.slice(last, start));
    out.push(mi(v));
    last = start + v.length;
    return m;
  });
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Converte um trecho de fórmula em nós DOM (cada nó especial leva data-src). */
export function inline(src) {
  const out = [];
  let i = 0, buf = '';
  const flush = () => { if (buf) { out.push(...plain(buf)); buf = ''; } };
  while (i < src.length) {
    let hit = null;
    for (const p of PATTERNS) {
      p.re.lastIndex = i;
      const m = p.re.exec(src);
      if (m && m[0].length && (!p.test || p.test(m[0]))) { hit = { m, p }; break; }
    }
    // identificadores sem "_" consomem a palavra inteira (evita casar frações no meio de uma palavra)
    if (!hit) {
      const w = /[A-Za-zÀ-ÿ0-9]+/y; w.lastIndex = i;
      const mw = w.exec(src);
      if (mw && (i === 0 || !/[A-Za-zÀ-ÿ0-9]/.test(src[i - 1])) && src[i + mw[0].length] !== '/' && !/^\s*\//.test(src.slice(i + mw[0].length))) { buf += mw[0]; i += mw[0].length; continue; }
      buf += src[i]; i += 1; continue;
    }
    flush();
    const node = hit.p.make(hit.m);
    node.dataset.src = hit.m[0];
    out.push(node);
    i += hit.m[0].length;
  }
  flush();
  return out;
}

/** Fórmula em linha (ex.: dentro de uma tabela ou rótulo). */
export function mathInline(src) {
  return h('span', { class: 'math m-inline', dataset: { src } }, ...inline(src));
}

/** Bloco de fórmulas (substitui o antigo <div class="eq">), com botão para copiar o texto original. */
export function mathBlock(src, attrs = {}) {
  const body = h('div', { class: 'math-body' }, ...src.split('\n').map((line) => h('div', { class: 'm-line' }, ...(line.trim() ? inline(line) : ['​']))));
  const btn = h('button', { class: 'small ghost m-copy', title: 'Copiar o texto das fórmulas', onclick: () => copyText(src) }, 'Copiar');
  return h('div', { class: 'eq math', ...attrs }, btn, body);
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Fórmulas copiadas como texto.'); }
  catch { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Fórmulas copiadas como texto.'); }
}

/** Texto original de um fragmento: nós desenhados viram o data-src; o resto, o próprio texto. */
function sourceOf(node) {
  if (node.nodeType === 3) return node.nodeValue.replace(/​/g, '');
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  if (node.dataset?.src != null) return node.dataset.src;
  if (node.classList?.contains('m-copy')) return '';
  let s = '';
  const block = /^(DIV|P|LI|H1|H2|H3|TR|DT|DD|PRE|UL)$/;
  node.childNodes.forEach((c, k) => {
    s += sourceOf(c);
    if (k === node.childNodes.length - 1 || c.nodeType !== 1) return;
    if (c.classList.contains('m-line')) s += '\n'; // linhas de fórmula: inclusive as vazias
    else if (block.test(c.tagName) && !s.endsWith('\n')) s += '\n';
  });
  return s;
}

/** Ctrl+C dentro de fórmulas devolve o texto digitado original (instalar uma vez). */
export function installMathCopy() {
  document.addEventListener('copy', (e) => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const host = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest?.('.math');
    if (!host(range.startContainer) && !host(range.endContainer) && !range.cloneContents().querySelector?.('.math')) return;
    // se a seleção começa ou termina dentro de um pedaço desenhado, inclui o pedaço inteiro
    const grow = (n, atStart) => { let el = n.nodeType === 1 ? n : n.parentElement; let top = null; while (el && !el.classList?.contains('math')) { if (el.dataset?.src != null) top = el; el = el.parentElement; } if (top) atStart ? range.setStartBefore(top) : range.setEndAfter(top); };
    grow(range.startContainer, true); grow(range.endContainer, false);
    const frag = range.cloneContents();
    const text = sourceOf(frag);
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });
}
