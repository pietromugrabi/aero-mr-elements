// Saídas por Design Point: importação (CSV/colado), associação aos DPs e coeficientes.
// Dados brutos (como importados) ficam separados dos valores calculados, que nunca são gravados.
//
//   q = ½·ρ·U²    CL = L / (q·A_ref)    CD = D / (q·A_ref)    CL/CD só quando CD ≠ 0
// Totais nunca são médias: vêm do relatório total ou, se o usuário pedir, da SOMA dos elementos.

import { parseNum } from './num.js';
import { parseCSV } from './csv.js';
import { DEFAULT_FLUENT, elName, referenceValues, dsName } from './fluent.js';
import { doeVariables, derivedColumns } from './doe.js';

const FORCE_UNITS = { n: 1, newton: 1, kn: 1000, mn: 0.001, lbf: 4.4482216152605 };
const SPEED_UNITS = { 'm/s': 1, 'm s^-1': 1, 'km/h': 1 / 3.6, mph: 0.44704 };
const LEN_UNITS = { mm: 1, m: 1000, cm: 10, in: 25.4 };

/** "P2 - lift_force [N]" → {base:'lift_force', unit:'N'};  "P3@DS_chord1@Ref@X.Part" → DS_chord1 */
export function normalizeHeader(h) {
  let s = String(h ?? '').trim().replace(/^"|"$/g, '');
  let unit = null;
  const mu = s.match(/\s*[[(]([^\])]+)[\])]\s*$/);
  if (mu) { unit = mu[1].trim(); s = s.slice(0, mu.index).trim(); }
  s = s.replace(/^P\d+\s*-\s*/i, '');
  if (s.includes('@')) { const ds = s.split('@').find((p) => /^DS_/i.test(p)); if (ds) s = ds; }
  return { base: s, unit, original: String(h ?? '') };
}

const canon = (s) => String(s).toLowerCase().replace(/[\s-]+/g, '_');

/** Mapa alias → campo do app. */
export function aliasMap(pkg) {
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const nm = { ...DEFAULT_FLUENT.names, ...(f.names || {}) };
  const m = new Map();
  const put = (field, ...aliases) => aliases.forEach((a) => m.set(canon(a), field));
  put('dp', 'name', 'dp', 'design point', 'design_point', 'designpoint', 'id', 'nome');
  put('lift_total', nm.liftTotal, 'lift_force', 'lift', 'lift_total', 'downforce', 'l_total');
  put('drag_total', nm.dragTotal, 'drag_force', 'drag', 'drag_total', 'd_total');
  pkg.config.elements.forEach((_, i) => {
    const n = i + 1;
    put(`lift_el_${n}`, elName(nm.liftEl, n), `lift_el${n}`, `lift_el_${n}`, `lift_element_${n}`, `lift_element${n}`, `lift${n}`, `lift_elemento_${n}`);
    put(`drag_el_${n}`, elName(nm.dragEl, n), `drag_el${n}`, `drag_el_${n}`, `drag_element_${n}`, `drag_element${n}`, `drag${n}`, `drag_elemento_${n}`);
  });
  [...doeVariables(pkg), ...derivedColumns(pkg)].forEach((v) => {
    put(`in:${v.key}`, v.key);
    const ds = dsName(v.key, pkg);
    if (ds) put(`in:${v.key}`, ds);
  });
  put('in:Uinf', nm.uinf, 'uinf', 'vel_ref', 'velocity', 'velocidade', 'u_inf');
  return m;
}

/** Associação automática colunas → campos, com fator de conversão de unidade. */
export function detectMapping(headers, pkg, unitsRow = null) {
  const am = aliasMap(pkg);
  return headers.map((h, i) => {
    const nh = normalizeHeader(h);
    let unit = nh.unit || (unitsRow?.[i] ? unitsRow[i].replace(/[[\]()]/g, '') : null);
    const field = am.get(canon(nh.base)) || null;
    return { index: i, header: h, base: nh.base, unit, field, ...unitFactor(field, unit) };
  });
}

function unitFactor(field, unit) {
  if (!field || field === 'dp') return { factor: 1, unitNote: null };
  const u = unit ? unit.toLowerCase().trim() : null;
  if (/^(lift|drag)_/.test(field)) {
    if (!u) return { factor: 1, unitNote: 'sem unidade no cabeçalho — assumido N' };
    if (u in FORCE_UNITS) return { factor: FORCE_UNITS[u], unitNote: FORCE_UNITS[u] === 1 ? null : `convertido de ${unit} para N` };
    return { factor: 1, unitNote: `unidade "${unit}" desconhecida — valores usados como N`, unknownUnit: true };
  }
  if (field === 'in:Uinf') {
    if (!u) return { factor: 1, unitNote: null };
    if (u in SPEED_UNITS) return { factor: SPEED_UNITS[u], unitNote: SPEED_UNITS[u] === 1 ? null : `convertido de ${unit} para m/s` };
    return { factor: 1, unitNote: `unidade "${unit}" desconhecida`, unknownUnit: true };
  }
  if (field.startsWith('in:')) {
    if (!u || u === 'deg' || u === '°' || u === 'degree') return { factor: 1, unitNote: null };
    if (u in LEN_UNITS) return { factor: LEN_UNITS[u], unitNote: LEN_UNITS[u] === 1 ? null : `convertido de ${unit} para mm` };
    return { factor: 1, unitNote: null };
  }
  return { factor: 1, unitNote: null };
}

export const dpKey = (s) => {
  const t = String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(t)) return `dp${t}`;
  return t;
};

/** Campos de saída esperados para o pacote. */
export function expectedOutputFields(pkg) {
  const f = ['lift_total', 'drag_total'];
  pkg.config.elements.forEach((_, i) => f.push(`lift_el_${i + 1}`, `drag_el_${i + 1}`));
  return f;
}

/**
 * Aplica um CSV parseado aos DPs de uma rodada (não altera nada; retorna as atualizações e o relatório).
 * @param opts.matchBy 'nome' (coluna DP/Name) | 'ordem' (linha i → DP i)
 */
export function planImport(parsed, mapping, dps, pkg, { matchBy = 'nome', isExample = false, source = '' } = {}) {
  const report = { matched: 0, unmatchedRows: [], dpsWithout: [], duplicates: [], unknownColumns: [], missingFields: [], unitNotes: [], emptyCells: 0, inputMismatch: [], warnings: [] };
  const fields = mapping.filter((m) => m.field);
  mapping.filter((m) => !m.field).forEach((m) => report.unknownColumns.push(m.header));
  mapping.filter((m) => m.unitNote).forEach((m) => report.unitNotes.push(`${m.header}: ${m.unitNote}`));
  const mapped = new Set(fields.map((m) => m.field));
  const dupCols = fields.filter((m, i) => fields.findIndex((x) => x.field === m.field) !== i);
  dupCols.forEach((m) => report.warnings.push(`Coluna "${m.header}" mapeada para um campo já usado (${m.field}) — ignorada.`));
  expectedOutputFields(pkg).forEach((f) => { if (!mapped.has(f)) report.missingFields.push(f); });
  const dpCol = fields.find((m) => m.field === 'dp');
  if (matchBy === 'nome' && !dpCol) { report.warnings.push('Sem coluna de identificação do DP (Name/DP): use a associação por ordem.'); return { updates: [], report }; }
  if (matchBy === 'ordem') report.warnings.push('Associação por ordem das linhas: confira se a ordem do CSV é a mesma da tabela de DPs.');

  const byKey = new Map(dps.map((d) => [dpKey(d.name), d]));
  const used = new Map();
  const updates = [];
  parsed.rows.forEach((row, ri) => {
    if (row.every((c) => !String(c).trim())) return;
    let dp;
    if (matchBy === 'ordem') dp = dps[ri];
    else dp = byKey.get(dpKey(row[dpCol.index]));
    const rowLabel = dpCol ? row[dpCol.index] : `linha ${ri + 1}`;
    if (!dp) { report.unmatchedRows.push(rowLabel); return; }
    if (used.has(dp.id)) { report.duplicates.push(`${dp.name} (linhas ${used.get(dp.id) + 1} e ${ri + 1}) — mantida a primeira`); return; }
    used.set(dp.id, ri);
    const raw = {}, rawRow = {};
    parsed.headers.forEach((h, i) => { rawRow[h] = row[i] ?? ''; });
    fields.forEach((m) => {
      if (m.field === 'dp' || dupCols.includes(m)) return;
      const cell = row[m.index];
      const v = parseNum(cell);
      if (m.field.startsWith('in:')) {
        if (!Number.isFinite(v)) return;
        const k = m.field.slice(3), mine = Number(dp.inputs?.[k]);
        const vv = v * m.factor;
        if (Number.isFinite(mine) && Math.abs(vv - mine) > 1e-6 * Math.max(1, Math.abs(mine))) report.inputMismatch.push(`${dp.name}: ${k} no arquivo = ${vv} ≠ ${mine} no DP`);
        return;
      }
      if (!Number.isFinite(v)) { report.emptyCells++; raw[m.field] = null; return; }
      raw[m.field] = v * m.factor;
    });
    updates.push({ dpId: dp.id, outputs: { raw, rawRow, source, importedAt: new Date().toISOString(), isExample } });
  });
  report.matched = updates.length;
  dps.forEach((d) => { if (!used.has(d.id)) report.dpsWithout.push(d.name); });
  return { updates, report };
}

/** Lê texto (arquivo ou colado) e devolve parse + mapeamento sugerido. */
export function readOutputsText(text, pkg) {
  const parsed = parseCSV(text);
  return { parsed, mapping: detectMapping(parsed.headers, pkg, parsed.unitsRow) };
}

const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);

/**
 * Valores calculados de um DP (não persistidos).
 * @param opts.sumIfMissing usar Σ elementos quando o total não foi importado (rotulado)
 */
export function computeDP(dp, pkg, { sumIfMissing = false } = {}) {
  const raw = dp.outputs?.raw;
  const ref = referenceValues(pkg, dp.inputs);
  const n = pkg.config.elements.length;
  const res = { ref, has: !!raw, flags: [], L: null, D: null, Cl: null, Cd: null, LD: null, ClCd: null, perEl: [] };
  if (!raw) return res;
  const qa = ref.q * ref.Aref;
  const elL = [], elD = [];
  for (let i = 1; i <= n; i++) {
    const L = raw[`lift_el_${i}`], D = raw[`drag_el_${i}`];
    elL.push(Number.isFinite(L) ? L : null); elD.push(Number.isFinite(D) ? D : null);
  }
  const allL = elL.every((v) => v !== null), allD = elD.every((v) => v !== null);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  let L = Number.isFinite(raw.lift_total) ? raw.lift_total : null;
  let D = Number.isFinite(raw.drag_total) ? raw.drag_total : null;
  if (L === null && sumIfMissing && allL) { L = sum(elL); res.flags.push('L_total = Σ elementos (total não importado)'); }
  if (D === null && sumIfMissing && allD) { D = sum(elD); res.flags.push('D_total = Σ elementos (total não importado)'); }
  if (Number.isFinite(raw.lift_total) && allL) {
    const s = sum(elL);
    if (Math.abs(s - raw.lift_total) > 0.01 * Math.abs(raw.lift_total) + 1e-9) res.flags.push(`Σ sustentação dos elementos (${s.toFixed(3)} N) difere do total (${raw.lift_total.toFixed(3)} N) em mais de 1 %: verifique superfícies faltando ou contadas duas vezes.`);
  }
  if (Number.isFinite(raw.drag_total) && allD) {
    const s = sum(elD);
    if (Math.abs(s - raw.drag_total) > 0.01 * Math.abs(raw.drag_total) + 1e-9) res.flags.push(`Σ arrasto dos elementos (${s.toFixed(3)} N) difere do total (${raw.drag_total.toFixed(3)} N) em mais de 1 %.`);
  }
  res.L = L; res.D = D;
  res.Cl = L !== null && qa > 0 ? L / qa : null;
  res.Cd = D !== null && qa > 0 ? D / qa : null;
  res.ClCd = ratio(res.Cl, res.Cd);
  res.LD = ratio(L, D);
  for (let i = 0; i < n; i++) {
    const qa_i = ref.q * ref.Ael[i];
    const Cl = elL[i] !== null && qa_i > 0 ? elL[i] / qa_i : null;
    const Cd = elD[i] !== null && qa_i > 0 ? elD[i] / qa_i : null;
    res.perEl.push({ L: elL[i], D: elD[i], Cl, Cd, ClCd: ratio(Cl, Cd), share: L ? ratio(elL[i], L) : null });
  }
  return res;
}

/** Métricas disponíveis para gráficos/ranking. */
export function metricList(n) {
  const m = [
    { key: 'L', label: 'Lift_force', unit: 'N' }, { key: 'D', label: 'Drag_force', unit: 'N' },
    { key: 'Cl', label: 'Cl_total', unit: '—' }, { key: 'Cd', label: 'Cd_total', unit: '—' }, { key: 'ClCd', label: 'Cl/Cd total', unit: '—' },
  ];
  for (let i = 1; i <= n; i++) {
    m.push({ key: `L_${i}`, label: `lift_el${i}`, unit: 'N', el: i }, { key: `D_${i}`, label: `drag_el${i}`, unit: 'N', el: i },
      { key: `Cl_${i}`, label: `Cl_el${i}`, unit: '—', el: i }, { key: `Cd_${i}`, label: `Cd_el${i}`, unit: '—', el: i }, { key: `ClCd_${i}`, label: `Cl/Cd el${i}`, unit: '—', el: i });
  }
  return m;
}

/** Achata o resultado calculado em chaves simples (para tabelas, gráficos e exportação). */
export function flatMetrics(c) {
  const o = { L: c.L, D: c.D, Cl: c.Cl, Cd: c.Cd, ClCd: c.ClCd };
  c.perEl.forEach((e, i) => { o[`L_${i + 1}`] = e.L; o[`D_${i + 1}`] = e.D; o[`Cl_${i + 1}`] = e.Cl; o[`Cd_${i + 1}`] = e.Cd; o[`ClCd_${i + 1}`] = e.ClCd; });
  return o;
}
