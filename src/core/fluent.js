// Fluent: valores de referência, tabela de parâmetros do Workbench, relatórios de força e
// verificação de dupla contagem. Gera apenas dados e instruções — não há integração com o ANSYS.

import { directions } from './transform.js';
import { keys, pairOf, topologyOf, gurneyConfigured } from './wing.js';

export const DEFAULT_FLUENT = Object.freeze({
  Uinf: 33.3, rho: 1.225, mu: 1.7894e-5, T: 288.16, depth: 1,
  arefMode: 'global',     // 'global' (Σ cordas × profundidade) | 'elemento' (corda_n × profundidade nos coef. por elemento)
  arefBasis: 'porDP',     // 'porDP' (Σ cordas do DP) | 'fixo' (valor do setup)
  arefFixed: null,        // m², quando arefBasis = 'fixo'
  lrefMode: 'soma',       // 'soma' | 'principal'
  liftVector: null, dragVector: null, // null = automático a partir da transformação
  viscous: 'k-omega SST', solver: 'pressure-based (Coupled)',
  names: { uinf: 'Uinf', liftTotal: 'lift_force', dragTotal: 'drag_force', liftEl: 'lift_el{n}', dragEl: 'drag_el{n}' },
});

export const elName = (tpl, n) => tpl.replace('{n}', String(n));

export function forceVectors(pkg) {
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const d = directions(pkg.config.transform);
  return { lift: f.liftVector || d.lift, drag: f.dragVector || d.flow, auto: !f.liftVector && !f.dragVector, labels: d };
}

/**
 * Valores de referência para um DP (ou para a referência do pacote).
 * Em 2D o Fluent reporta forças por unidade de profundidade × "Depth" (padrão 1 m).
 */
export function referenceValues(pkg, inputs = null) {
  const c = pkg.config, f = { ...DEFAULT_FLUENT, ...c.fluent };
  const errors = [], notes = [];
  const n = c.elements.length;
  const chord = (i) => Number(inputs?.[keys.chord(i + 1)] ?? c.elements[i].chord_ref);
  const chords = Array.from({ length: n }, (_, i) => chord(i));
  let depth = Number(f.depth) || 1;
  if (c.mode === '3D') {
    const span = Number(c.span_mm);
    if (!(span > 0)) errors.push('Modo 3D: informe a envergadura (span) — ela não é estimada pelo aplicativo.');
    depth = span / 1000;
  }
  const U = Number(inputs?.Uinf ?? f.Uinf);
  const sumC = chords.reduce((a, b) => a + b, 0) / 1000;
  let Aref = sumC * depth;
  if (f.arefBasis === 'fixo') {
    if (Number(f.arefFixed) > 0) Aref = Number(f.arefFixed);
    else errors.push('A_ref fixo selecionado, mas sem valor. Informe A_ref [m²].');
  }
  const Ael = chords.map((ci) => (f.arefMode === 'elemento' ? (ci / 1000) * depth : Aref));
  const Lref = f.lrefMode === 'principal' ? chords[0] / 1000 : sumC;
  const q = 0.5 * f.rho * U * U;
  if (c.mode !== '3D') notes.push(`2D: forças do Fluent por profundidade = ${depth} m (Reference Values → Depth).`);
  return { U, rho: f.rho, mu: f.mu, T: f.T, depth, Aref, Ael, Lref, q, Re: (f.rho * U * Lref) / f.mu, chords, errors, notes };
}

/**
 * Nomes DS_ do SolidWorks para cada variável do app (convenção do modelo de referência).
 * Gap/Overlap: DS_gap{a}{b}, com (a, b) o par de montante para jusante (flap n → (ref, n); slat n → (n, ref)).
 * gurney_on_n não é cota: retorna null (ligar/desligar = configuração ou supressão do recurso no SolidWorks).
 * @param ctx pacote (recomendado) ou nº de Gurneys (compatibilidade)
 */
export function dsName(key, ctx = 1) {
  const pkg = typeof ctx === 'object' ? ctx : null;
  const nGurney = pkg ? pkg.config.elements.filter(gurneyConfigured).length : ctx;
  let m;
  if ((m = key.match(/^chord_(\d+)$/))) return `DS_chord${m[1]}`;
  if ((m = key.match(/^AoA_(\d+)$/))) return `DS_AoA${m[1]}`;
  if ((m = key.match(/^(Gap|Overlap)_(\d+)$/))) {
    const n = Number(m[2]), pr = pkg ? pairOf(pkg, n) : { a: n - 1, b: n };
    if (!pr) return null;
    const what = m[1] === 'Overlap' && pr.kind === 'upperflap' && pr.anchor === 'ba' ? 'stagger' : m[1].toLowerCase();
    return `DS_${what}${pr.a}${pr.b}`;
  }
  if ((m = key.match(/^pivot_off_(\d+)$/))) return `DS_pivot${m[1]}_off`;
  if ((m = key.match(/^pivot_dTE_(\d+)$/))) return `DS_pivot${m[1]}_dTE`;
  if ((m = key.match(/^gurney_(h|t|pos)_(\d+)$/))) return nGurney > 1 ? `DS_gurney${m[2]}_${m[1]}` : `DS_gurney_${m[1]}`;
  return null;
}

/** Rótulo do elemento com o tipo (ex.: "elemento 4 (slat)"). */
export function elementLabel(pkg, n) {
  const k = topologyOf(pkg).kinds[n - 1];
  return `elemento ${n}${k && k !== 'flap' ? ` (${k})` : ''}`;
}

/** Relatórios de força (Report Definitions) com mapeamento nome ↔ superfícies ↔ grandeza. */
export function reportDefinitions(pkg) {
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const nm = { ...DEFAULT_FLUENT.names, ...(f.names || {}) };
  const n = pkg.config.elements.length;
  const v = forceVectors(pkg);
  const walls = Array.from({ length: n }, (_, i) => `wall_element_${i + 1}`);
  const list = [
    { name: nm.liftTotal, quantity: 'Força de sustentação (Lift)', vector: v.lift, surfaces: walls.slice(), element: null, field: 'lift_total', unit: 'N' },
    { name: nm.dragTotal, quantity: 'Força de arrasto (Drag)', vector: v.drag, surfaces: walls.slice(), element: null, field: 'drag_total', unit: 'N' },
  ];
  walls.forEach((w, i) => {
    list.push({ name: elName(nm.liftEl, i + 1), quantity: `Sustentação do ${elementLabel(pkg, i + 1)}`, vector: v.lift, surfaces: [w], element: i + 1, field: `lift_el_${i + 1}`, unit: 'N' });
    list.push({ name: elName(nm.dragEl, i + 1), quantity: `Arrasto do ${elementLabel(pkg, i + 1)}`, vector: v.drag, surfaces: [w], element: i + 1, field: `drag_el_${i + 1}`, unit: 'N' });
  });
  return pkg.config.reports?.length ? pkg.config.reports : list;
}

/** Verifica dupla contagem, superfícies desconhecidas e coerência dos vetores. */
export function checkReports(reports, nsList, n) {
  const issues = [];
  const nsNames = new Set(nsList.map((s) => s.name));
  const walls = Array.from({ length: n }, (_, i) => `wall_element_${i + 1}`);
  const seenNames = new Set();
  reports.forEach((r) => {
    if (seenNames.has(r.name)) issues.push({ level: 'erro', msg: `Relatório "${r.name}" repetido.` });
    seenNames.add(r.name);
    const dup = r.surfaces.filter((s, i) => r.surfaces.indexOf(s) !== i);
    if (dup.length) issues.push({ level: 'erro', msg: `"${r.name}": superfície ${dup.join(', ')} listada duas vezes (dupla contagem).` });
    r.surfaces.forEach((s) => { if (!nsNames.has(s)) issues.push({ level: 'erro', msg: `"${r.name}": superfície "${s}" não existe nas Named Selections.` }); });
    if (r.surfaces.includes('ground')) issues.push({ level: 'erro', msg: `"${r.name}" inclui o solo (ground): a força no solo não é força na asa.` });
    const l = Math.hypot(...r.vector);
    if (Math.abs(l - 1) > 1e-6) issues.push({ level: 'aviso', msg: `"${r.name}": vetor de direção não unitário (|v| = ${l.toFixed(3)}).` });
  });
  ['lift_total', 'drag_total'].forEach((fld) => {
    const r = reports.find((x) => x.field === fld);
    if (!r) { issues.push({ level: 'aviso', msg: `Sem relatório de força total (${fld === 'lift_total' ? 'sustentação' : 'arrasto'}).` }); return; }
    const missing = walls.filter((w) => !r.surfaces.includes(w));
    if (missing.length) issues.push({ level: 'erro', msg: `"${r.name}" (total) não inclui ${missing.join(', ')}.` });
  });
  ['lift', 'drag'].forEach((kind) => {
    const per = reports.filter((x) => x.field?.startsWith(`${kind}_el_`));
    const count = new Map();
    per.forEach((r) => r.surfaces.forEach((s) => count.set(s, (count.get(s) || 0) + 1)));
    count.forEach((c, s) => { if (c > 1) issues.push({ level: 'erro', msg: `${s} aparece em ${c} relatórios de ${kind === 'lift' ? 'sustentação' : 'arrasto'} por elemento: a soma dos elementos contaria essa parede duas vezes.` }); });
  });
  const L = reports.find((x) => x.field === 'lift_total'), D = reports.find((x) => x.field === 'drag_total');
  if (L && D) {
    const dp = L.vector.reduce((s, v, i) => s + v * D.vector[i], 0);
    if (Math.abs(dp) > 1e-6) issues.push({ level: 'aviso', msg: 'Vetores de sustentação e arrasto não são ortogonais.' });
  }
  return issues;
}

/** Tabela de parâmetros do Workbench (entradas geométricas DS_ + Uinf; saídas de força). */
export function parameterTable(pkg, inputKeys) {
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const nm = { ...DEFAULT_FLUENT.names, ...(f.names || {}) };
  const rows = [];
  let p = 1;
  (inputKeys || []).filter((k) => k !== 'Uinf' && !/_c$/.test(k)).forEach((k) => { // Gap_n_c: fração, vira DS_gap (mm) derivado
    const unit = /^AoA/.test(k) ? '°' : 'mm';
    const ds = dsName(k, pkg);
    if (/^gurney_on_/.test(k)) { rows.push({ param: `P${p++}`, name: k, appKey: k, kind: 'Entrada', unit: '0/1', source: 'NÃO é cota DS_: Gurney ligado/desligado', note: 'use configurações/peças separadas (com e sem Gurney) ou um parâmetro de supressão; não é alterável por cota no DesignModeler' }); return; }
    rows.push({ param: `P${p++}`, name: ds || k, appKey: k, kind: 'Entrada', unit, source: 'SolidWorks (cota DS_ do esboço Ref)', note: /^pivot_/.test(k) ? 'derivado da corda (escalonamento do pivô)' : /^(Gap|Overlap)_\d+$/.test(k) && inputKeys.includes(`${k}_c`) ? 'derivado: fração × corda (Gap/Overlap em função da corda)' : '' });
  });
  rows.push({ param: `P${p++}`, name: nm.uinf, appKey: 'Uinf', kind: 'Entrada', unit: 'm/s', source: 'Fluent: velocidade do inlet (Use as input parameter)', note: '' });
  reportDefinitions(pkg).forEach((r) => {
    rows.push({ param: `P${p++}`, name: r.name, appKey: r.field, kind: 'Saída', unit: 'N', source: `Fluent: Report Definition (${r.surfaces.join(' + ')})`, note: r.quantity });
  });
  return rows;
}

/** Condições de contorno a partir das Named Selections. */
export function boundaryConditions(pkg) {
  const f = { ...DEFAULT_FLUENT, ...pkg.config.fluent };
  const d = directions(pkg.config.transform);
  return (pkg.config.namedSelections || []).map((s) => {
    let detail = s.notes || '';
    if (s.bc === 'velocity-inlet') detail = `Magnitude = ${f.names?.uinf || 'Uinf'} (parâmetro de entrada, ref. ${f.Uinf} m/s), direção ${d.flowLabel}, normal à fronteira`;
    if (s.bc === 'pressure-outlet') detail = 'Pressão manométrica 0 Pa; backflow com turbulência padrão';
    if (s.bc === 'wall (moving)') detail = `Moving wall, translacional, velocidade = Uinf no sentido ${d.flowLabel} (use a expressão/parâmetro Uinf)`;
    if (s.bc === 'symmetry') detail = 'Symmetry (tensão de cisalhamento nula)';
    if (s.bc === 'wall') detail = 'Stationary wall, no-slip';
    return { name: s.name, bc: s.bc, detail };
  });
}
