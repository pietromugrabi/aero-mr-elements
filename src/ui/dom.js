// Helpers de DOM e componentes de formulário (todos os campos numéricos mostram a unidade).
import { parseNum, fmtSig } from '../core/num.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}

const numStr = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : String(+Number(v).toPrecision(12)).replace('.', ','));

/** Campo numérico com unidade. onChange(número|null). Aceita vírgula ou ponto. */
export function numField({ label, unit, value, onChange, hint, key, disabled, required, placeholder, derived, onInput, title }) {
  const inp = h('input', { type: 'text', inputmode: 'decimal', value: numStr(value), disabled, placeholder: placeholder ?? (required ? 'obrigatório' : ''), dataset: key ? { k: key } : undefined, title });
  const box = h('div', { class: 'inp' + (derived ? ' derived' : '') + (required && (value == null || value === '') ? ' invalid' : '') }, inp, unit ? h('span', { class: 'unit' }, unit) : null);
  const read = () => { const t = inp.value.trim(); if (t === '') return null; const v = parseNum(t); return Number.isFinite(v) ? v : NaN; };
  inp.addEventListener('change', () => {
    const v = read();
    if (Number.isNaN(v)) { box.classList.add('invalid'); toast(`Valor inválido em "${label || key}". Use número (vírgula ou ponto).`, true); return; }
    box.classList.remove('invalid');
    onChange && onChange(v);
  });
  if (onInput) inp.addEventListener('input', () => { const v = read(); if (Number.isFinite(v)) onInput(v); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  return h('div', { class: 'field' }, label ? h('label', null, label) : null, box, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function textField({ label, value, onChange, hint, key, placeholder, unit, wide }) {
  const inp = h('input', { type: 'text', value: value ?? '', placeholder, dataset: key ? { k: key } : undefined });
  inp.addEventListener('change', () => onChange && onChange(inp.value));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  return h('div', { class: 'field', style: wide ? { gridColumn: '1 / -1' } : null }, label ? h('label', null, label) : null, h('div', { class: 'inp' }, inp, unit ? h('span', { class: 'unit' }, unit) : null), hint ? h('div', { class: 'hint' }, hint) : null);
}

export function selectField({ label, value, options, onChange, hint, key, unit }) {
  const sel = h('select', { dataset: key ? { k: key } : undefined }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, l)));
  sel.value = value ?? '';
  sel.addEventListener('change', () => onChange && onChange(sel.value));
  return h('div', { class: 'field' }, label ? h('label', null, label) : null, h('div', { class: 'inp' }, sel, unit ? h('span', { class: 'unit' }, unit) : null), hint ? h('div', { class: 'hint' }, hint) : null);
}

export function checkField({ label, checked, onChange, key, title }) {
  const c = h('input', { type: 'checkbox', checked, dataset: key ? { k: key } : undefined });
  c.addEventListener('change', () => onChange && onChange(c.checked));
  return h('label', { class: 'check', title }, c, label);
}

export function seg(options, value, onChange) {
  return h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { class: String(v) === String(value) ? 'on' : '', onclick: () => onChange(v) }, l)));
}

export function msgs(list) {
  if (!list || !list.length) return null;
  return h('ul', { class: 'msgs' }, list.map((m) => h('li', { class: typeof m === 'string' ? 'aviso' : (m.level || 'aviso') }, typeof m === 'string' ? m : m.msg)));
}

export function badge(text, cls = '') { return h('span', { class: `badge ${cls}` }, text); }

export function card(title, ...children) { return h('div', { class: 'card' }, title ? h('h2', null, title) : null, ...children); }

export function exampleBanner(text = 'DADOS DE EXEMPLO — resultados sintéticos gerados pelo aplicativo para demonstrar o fluxo. NÃO são resultados de CFD.') {
  return h('div', { class: 'banner example' }, h('strong', null, 'Exemplo'), h('span', null, text));
}

/** Tabela simples: cols [{label, unit, num, get(row) → texto|Node}] */
export function table(cols, rows, { tall = false, rowClass } = {}) {
  return h('div', { class: 'table-wrap' + (tall ? ' tall' : '') }, h('table', null,
    h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label, c.unit ? h('span', { class: 'th-unit' }, ` [${c.unit}]`) : null)))),
    h('tbody', null, rows.map((r, i) => h('tr', { class: rowClass ? rowClass(r, i) : '' }, cols.map((c) => { const v = c.get(r, i); return h('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : v == null ? '—' : String(v)); }))))));
}

export const fv = (v, sig = 5) => (Number.isFinite(v) ? fmtSig(v, sig) : '—');

let toastBox;
export function toast(msg, isErr = false) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts' }); document.body.append(toastBox); }
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3200);
}

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => { bg.remove(); resolve(v); };
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(null); } },
      h('div', { class: 'modal', role: 'dialog' }, h('h2', null, title), body,
        h('div', { class: 'row end', style: { marginTop: '14px' } }, actions.map((a) => h('button', { class: a.primary ? 'primary' : a.danger ? 'danger' : '', onclick: () => close(a.value) }, a.label)))));
    document.body.append(bg);
    const f = bg.querySelector('input, textarea, button.primary');
    f && f.focus();
  });
}

export async function confirmBox(title, text, okLabel = 'Confirmar', danger = false) {
  return (await modal(title, h('p', null, text), [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: !danger, danger }])) === true;
}

export async function promptBox(title, label, value = '') {
  const inp = h('input', { type: 'text', value, style: { width: '100%' } });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') bg().querySelector('button.primary').click(); });
  const bg = () => inp.closest('.modal-bg');
  const r = await modal(title, h('div', { class: 'field' }, h('label', null, label), inp), [{ label: 'Cancelar', value: null }, { label: 'OK', value: 'ok', primary: true }]);
  return r === 'ok' ? inp.value.trim() : null;
}

export function download(name, data, mime = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => {
      const f = inp.files[0]; inp.remove();
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: r.result });
      r.readAsText(f);
    });
    document.body.append(inp); inp.click();
  });
}

export const safeName = (s) => String(s || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60);

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallback());
  return Promise.resolve(fallback());
  function fallback() { const t = h('textarea', { value: text }); document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; }
}
