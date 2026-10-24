// Conversão e formatação numérica (aceita vírgula ou ponto decimal).

const NUM_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eEdD][+-]?\d+)?$/;

/** Converte texto em número. Aceita "3,5", "3.5", "1.2E-3", "1.2D-3". Retorna NaN se inválido. */
export function parseNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/ /g, '');
  if (s === '') return NaN;
  // remove separador de milhar no formato 1.234,5
  if (/^[+-]?\d{1,3}(\.\d{3})+,\d*$/.test(s)) s = s.replace(/\./g, '');
  if (!NUM_RE.test(s)) return NaN;
  return Number(s.replace(',', '.').replace(/[dD]/, 'e'));
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Formata número em pt-BR com casas decimais fixas ("—" se ausente). */
export function fmt(v, digits = 3) {
  if (!isNum(v)) return '—';
  if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0; // evita "-0,000"
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Formata com algarismos significativos (para valores pequenos, ex.: altura da 1ª camada). */
export function fmtSig(v, sig = 4) {
  if (!isNum(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-3 || a >= 1e6) return v.toExponential(sig - 1).replace('.', ',');
  const d = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return fmt(v, Math.min(d, 8));
}

/** Número para arquivos (ponto decimal, sem perda desnecessária). */
export function numOut(v, digits = 6) {
  if (!isNum(v)) return '';
  return String(Number(v.toFixed(digits)));
}

export function round(v, d = 9) { return Math.round(v * 10 ** d) / 10 ** d; }
