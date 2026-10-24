// Leitura/escrita de CSV (detecção de separador, aspas, comentários "#" do Workbench).

function splitLine(line, d) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function detectDelimiter(lines) {
  const cands = ['\t', ';', ','];
  let best = ',', score = -1;
  for (const d of cands) {
    const counts = lines.slice(0, 10).map((l) => splitLine(l, d).length);
    if (!counts.length) continue;
    const min = Math.min(...counts);
    const consistent = counts.every((c) => c === counts[0]);
    const s = (min - 1) * (consistent ? 2 : 1);
    if (s > score) { score = s; best = d; }
  }
  return best;
}

const looksNumeric = (s) => /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(String(s).trim());

/**
 * @returns {{headers:string[], rows:string[][], delimiter:string, comments:string[], unitsRow:string[]|null}}
 */
export function parseCSV(text) {
  const all = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const comments = [], data = [];
  all.forEach((l) => { if (!l.trim()) return; if (l.trim().startsWith('#')) comments.push(l.trim().replace(/^#+\s?/, '')); else data.push(l); });
  const delimiter = detectDelimiter(data.length ? data : comments);
  let rows = data.map((l) => splitLine(l, delimiter));
  let headers = [];
  // Cabeçalho: alguma célula além da 1ª é texto (a 1ª coluna de dados pode ser "DP 0").
  const isHeaderRow = (r) => r.slice(1).some((c) => c && !looksNumeric(c)) || (r.length === 1 && !looksNumeric(r[0]));
  if (rows.length && isHeaderRow(rows[0])) {
    headers = rows.shift();
  } else {
    // cabeçalho dentro de um comentário (algumas exportações do Workbench)
    for (let i = comments.length - 1; i >= 0; i--) {
      const h = splitLine(comments[i], delimiter);
      if (h.length === (rows[0]?.length || 0) && h.some((c) => c && !looksNumeric(c))) { headers = h; break; }
    }
    if (!headers.length) headers = (rows[0] || []).map((_, i) => `col${i + 1}`);
  }
  // linha de unidades (ex.: "", "[mm]", "[N]")
  let unitsRow = null;
  if (rows.length && rows[0].every((c) => !c || /^\[.*\]$|^\(.*\)$|^(mm|m|deg|°|n|m\/s|kn|lbf)$/i.test(c))) unitsRow = rows.shift();
  return { headers, rows, delimiter, comments, unitsRow };
}

function q(s, d) {
  const str = String(s ?? '');
  return /["\n\r]/.test(str) || str.includes(d) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** CSV. decimalComma = true usa ";" e vírgula decimal (Excel pt-BR). */
export function toCSV(headers, rows, { decimalComma = false } = {}) {
  const d = decimalComma ? ';' : ',';
  const cell = (v) => (typeof v === 'number' && Number.isFinite(v) ? (decimalComma ? String(v).replace('.', ',') : String(v)) : v == null ? '' : v);
  return [headers.map((h) => q(h, d)).join(d), ...rows.map((r) => r.map((v) => q(cell(v), d)).join(d))].join('\r\n') + '\r\n';
}

/** Texto separado por tabulação (copiar/colar com planilhas). */
export function toTSV(headers, rows) {
  return [headers.join('\t'), ...rows.map((r) => r.map((v) => (typeof v === 'number' ? String(v).replace('.', ',') : v ?? '')).join('\t'))].join('\n');
}
