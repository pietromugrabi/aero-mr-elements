// Importação de arquivos .dat de perfis (formatos Selig e Lednicer).
// Saída sempre na ordem Selig: BF (extradorso) → BA → BF (intradorso), sentido anti-horário,
// sem repetir o ponto de fechamento.

import { parseNum } from './num.js';
import { dist, signedArea } from './geom.js';

function tokenize(s) {
  let t = s.split(/[\s;]+/).filter(Boolean);
  if (t.length === 1 && t[0].includes(',')) t = t[0].split(',').filter(Boolean);
  return t;
}

/**
 * Lê o texto de um .dat.
 * @returns {{name, points, closedTE, format, leIndex, le, te, chordMeasured, scaleGuess,
 *            warnings: string[], errors: string[], info: string[], stats}}
 */
export function parseDat(text, opts = {}) {
  const warnings = [], errors = [], info = [];
  const lines = String(text ?? '').split(/\r?\n/);
  let name = null;
  const rows = [];
  let skipped = 0;

  lines.forEach((raw, idx) => {
    const ln = idx + 1, s = raw.trim();
    if (!s) return;
    if (s.startsWith('#') || s.startsWith('!')) { skipped++; return; }
    const toks = tokenize(s);
    const nums = toks.map(parseNum);
    const nOk = nums.filter(Number.isFinite).length;
    if (nOk !== toks.length) {
      if (nOk > 0 && rows.length > 0) {
        warnings.push(`Linha ${ln}: linha incompleta ou inválida ("${s.slice(0, 40)}") — ignorada.`);
      } else if (name === null && rows.length === 0) {
        name = s;
        return; // nome do perfil (cabeçalho), não conta como linha ignorada
      } else {
        warnings.push(`Linha ${ln}: texto ignorado ("${s.slice(0, 40)}").`);
      }
      skipped++;
      return;
    }
    if (nums.length === 1) {
      warnings.push(`Linha ${ln}: só um valor numérico — linha incompleta ignorada.`);
      skipped++;
      return;
    }
    if (nums.length > 2) warnings.push(`Linha ${ln}: ${nums.length} colunas — usadas apenas as 2 primeiras (X, Y).`);
    rows.push({ x: nums[0], y: nums[1], line: ln });
  });

  const result = {
    name: name || opts.name || 'perfil', points: [], closedTE: false, format: 'selig', leIndex: -1,
    le: null, te: null, chordMeasured: NaN, scaleGuess: 'normalizado', warnings, errors, info,
    stats: { totalLines: lines.length, dataLines: rows.length, skipped, duplicatesRemoved: 0 },
  };

  if (rows.length < 3) {
    errors.push('Arquivo sem coordenadas suficientes (mínimo de 10 pontos X Y).');
    return result;
  }

  // Detecção do formato Lednicer: 1ª linha numérica = número de pontos de cada superfície.
  let pts;
  const r0 = rows[0];
  const isCount = (v) => Number.isInteger(v) && v >= 2;
  if (isCount(r0.x) && isCount(r0.y) && Math.abs(r0.x + r0.y - (rows.length - 1)) <= 1) {
    result.format = 'lednicer';
    const nu = r0.x, nl = r0.y;
    const upper = rows.slice(1, 1 + nu).map((r) => [r.x, r.y]);
    const lower = rows.slice(1 + nu, 1 + nu + nl).map((r) => [r.x, r.y]);
    if (upper.length !== nu || lower.length !== nl) warnings.push('Formato Lednicer: número de pontos declarado não confere com o arquivo.');
    const l0 = lower[0];
    const startLower = l0 && upper[0] && dist(l0, upper[0]) < 1e-9 ? 1 : 0;
    pts = upper.slice().reverse().concat(lower.slice(startLower));
    info.push(`Formato Lednicer detectado (${nu} + ${nl} pontos) e convertido para a ordem Selig.`);
  } else {
    pts = rows.map((r) => [r.x, r.y]);
  }

  // Escala característica para tolerâncias
  const xs = pts.map((p) => p[0]);
  const span = Math.max(...xs) - Math.min(...xs) || 1;
  const tol = 1e-9 * span;

  // Duplicados consecutivos
  const clean = [pts[0]];
  const lineOf = (i) => (result.format === 'selig' ? rows[i]?.line : undefined);
  for (let i = 1; i < pts.length; i++) {
    if (dist(pts[i], clean[clean.length - 1]) <= tol) {
      result.stats.duplicatesRemoved++;
      const l = lineOf(i);
      warnings.push(`Ponto duplicado consecutivo${l ? ` na linha ${l}` : ''} removido (${pts[i][0]}, ${pts[i][1]}).`);
    } else clean.push(pts[i]);
  }
  pts = clean;

  // Fechamento (primeiro = último): BF fechado
  if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= tol) {
    pts.pop();
    result.closedTE = true;
    info.push('Primeiro e último pontos coincidem: bordo de fuga fechado (ponto de fechamento não repetido).');
  }

  // Duplicados não consecutivos
  const seen = new Map();
  pts.forEach((p, i) => {
    const k = `${Math.round(p[0] / tol)}|${Math.round(p[1] / tol)}`;
    if (seen.has(k)) warnings.push(`Ponto repetido em posições não consecutivas (${seen.get(k) + 1} e ${i + 1}): (${p[0]}, ${p[1]}). Verifique o arquivo.`);
    else seen.set(k, i);
  });

  if (pts.length < 10) {
    errors.push(`Apenas ${pts.length} pontos válidos — mínimo de 10 para definir um perfil.`);
    result.points = pts;
    return result;
  }

  // Orientação: anti-horário (extradorso primeiro, partindo do BF)
  if (signedArea(pts) < 0) {
    // BF fechado: o ponto do BF continua no índice 0; BF aberto: inverter tudo troca as pontas.
    pts = result.closedTE ? [pts[0], ...pts.slice(1).reverse()] : pts.reverse();
    info.push('Ordem dos pontos invertida para BF → extradorso → BA → intradorso (sentido anti-horário).');
  }

  const n = pts.length;
  // BF fechado: o ponto do BF é o índice 0 (o último ponto é do intradorso, antes do fechamento).
  const teU = pts[0], teL = result.closedTE ? pts[0] : pts[n - 1];
  const teMid = [(teU[0] + teL[0]) / 2, (teU[1] + teL[1]) / 2];
  let leIndex = 0, dmax = -1;
  pts.forEach((p, i) => { const d = dist(p, teMid); if (d > dmax) { dmax = d; leIndex = i; } });
  if (leIndex === 0 || leIndex === n - 1) {
    warnings.push('Não foi possível identificar o BA no meio da lista: a ordem dos pontos não parece ser Selig (BF→BA→BF).');
  }

  // Monotonicidade aproximada de cada superfície
  const nonMono = (arr, dir) => arr.reduce((c, p, i) => (i > 0 && dir * (p[0] - arr[i - 1][0]) > 1e-12 * span ? c + 1 : c), 0);
  const up = pts.slice(0, leIndex + 1), lo = pts.slice(leIndex);
  const nmU = nonMono(up, 1), nmL = nonMono(lo, -1);
  if (nmU + nmL > 0) warnings.push(`Coordenada X não monotônica em ${nmU + nmL} trecho(s) de superfície — confira a ordem dos pontos.`);

  result.points = pts;
  result.leIndex = leIndex;
  result.le = pts[leIndex];
  result.te = { upper: teU, lower: teL, mid: teMid, thickness: dist(teU, teL) };
  result.chordMeasured = dmax;
  result.scaleGuess = dmax > 0.5 && dmax < 1.5 ? 'normalizado' : 'físico';
  if (result.scaleGuess === 'físico') info.push(`Corda medida = ${dmax.toFixed(3)} (unidades do arquivo): o arquivo parece estar em coordenadas físicas.`);
  return result;
}

/** Escreve um contorno no formato Selig (.dat), repetindo o ponto inicial se fechado. */
export function writeDat(name, pts, { close = true, digits = 6 } = {}) {
  const out = [name];
  const list = close ? pts.concat([pts[0]]) : pts;
  for (const p of list) out.push(`  ${p[0].toFixed(digits)}  ${p[1].toFixed(digits)}`);
  return out.join('\n') + '\n';
}
