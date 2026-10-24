import { h, card, numField, selectField, textField, msgs, table, fv, copyText, toast, badge } from '../dom.js';
import * as store from '../store.js';
import { needs, pageHead } from '../common.js';
import { referenceValues, reportDefinitions, checkReports, parameterTable, boundaryConditions, forceVectors, DEFAULT_FLUENT } from '../../core/fluent.js';
import { doeVariables, derivedColumns } from '../../core/doe.js';
import { fluentSetupMD } from '../../core/export.js';
import { parseNum } from '../../core/num.js';

export function inputKeysOf(pkg, run) {
  const levels = run?.doe?.levels || {};
  const varied = doeVariables(pkg).filter((v) => String(levels[v.key] || '').trim()).map((v) => v.key);
  const derived = run?.doe?.pivotScaling !== false ? derivedColumns(pkg).filter((d) => varied.includes(`chord_${d.element}`)).map((d) => d.key) : [];
  return [...varied, ...derived, 'Uinf'];
}

export default function fluent(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, f = pkg.config.fluent, n = pkg.config.elements.length;
  f.names = { ...DEFAULT_FLUENT.names, ...(f.names || {}) };
  const set = (k, v, label) => store.update(() => { f[k] = v; }, ['fluent', pkg.name, `${label || k} alterado`, String(v)]);
  const ref = referenceValues(pkg);
  const vec = forceVectors(pkg);
  const reps = reportDefinitions(pkg);
  const issues = checkReports(reps, pkg.config.namedSelections, n);
  const keys = inputKeysOf(pkg, ctx.run);
  const vecField = (label, k, cur) => {
    const i = h('input', { type: 'text', value: cur.join('; '), dataset: { k: `vec_${k}` }, style: { width: '100%' } });
    i.addEventListener('change', () => {
      if (!i.value.trim()) { set(k, null, label); return; }
      const v = i.value.split(/[;\s]+/).map(parseNum);
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) { toast('Vetor inválido: use 3 componentes, ex.: 0; -1; 0', true); return; }
      set(k, v, label);
    });
    return h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'inp' }, i, h('span', { class: 'unit' }, '(x; y; z)')), h('div', { class: 'hint' }, f[k] ? 'personalizado (apague para voltar ao automático)' : 'automático pela transformação de coordenadas'));
  };
  const md = fluentSetupMD(pkg, keys);
  return h('div', null,
    pageHead(`Fluent Setup & Reference Values — ${pkg.name}`, 'Valores para configurar manualmente no Fluent e no Workbench. Nenhuma integração automática com o ANSYS.'),
    h('div', { class: 'grid g2' },
      card('Escoamento e Reference Values', h('div', { class: 'fields' },
        numField({ label: 'Vel_ref → parâmetro de entrada Uinf', unit: 'm/s', value: f.Uinf, required: true, key: 'uinf', onChange: (v) => set('Uinf', v, 'Uinf') }),
        numField({ label: 'Densidade ρ', unit: 'kg/m³', value: f.rho, key: 'rho', onChange: (v) => set('rho', v ?? 1.225, 'ρ') }),
        numField({ label: 'Viscosidade μ', unit: 'kg/(m·s)', value: f.mu, key: 'mu', onChange: (v) => set('mu', v ?? 1.7894e-5, 'μ') }),
        numField({ label: 'Temperatura T', unit: 'K', value: f.T, key: 'T', onChange: (v) => set('T', v ?? 288.16, 'T') }),
        pkg.config.mode === '2D' ? numField({ label: 'Profundidade (Depth, 2D)', unit: 'm', value: f.depth, key: 'depth', onChange: (v) => set('depth', v ?? 1, 'profundidade') }) : h('div', { class: 'field' }, h('label', null, 'Envergadura (3D)'), h('div', null, pkg.config.span_mm ? `${pkg.config.span_mm} mm (Geometria)` : badge('não informada', 'err'))),
        selectField({ label: 'A_ref', value: f.arefBasis, options: [['porDP', 'Σ cordas do DP × profundidade'], ['fixo', 'valor fixo']], onChange: (v) => set('arefBasis', v, 'A_ref') }),
        f.arefBasis === 'fixo' ? numField({ label: 'A_ref fixo', unit: 'm²', value: f.arefFixed, required: true, key: 'arefF', onChange: (v) => set('arefFixed', v, 'A_ref fixo') }) : null,
        selectField({ label: 'A_ref nos coeficientes por elemento', value: f.arefMode, options: [['global', 'global (mesma A_ref)'], ['elemento', 'por elemento (chord_n × profundidade)']], onChange: (v) => set('arefMode', v, 'A_ref por elemento') }),
        selectField({ label: 'L_ref', value: f.lrefMode, options: [['soma', 'Σ cordas'], ['principal', 'corda do elemento 1']], onChange: (v) => set('lrefMode', v, 'L_ref') }),
        textField({ label: 'Modelo de turbulência', value: f.viscous, onChange: (v) => set('viscous', v, 'turbulência') }),
        textField({ label: 'Solver', value: f.solver, onChange: (v) => set('solver', v, 'solver') })),
      h('h3', null, 'Valores calculados (referência do pacote)'),
      h('div', { class: 'kv' },
        h('dt', null, 'A_ref'), h('dd', null, `${fv(ref.Aref, 6)} m²`), h('dt', null, 'L_ref'), h('dd', null, `${fv(ref.Lref, 6)} m`),
        h('dt', null, 'q∞ = ½ρU²'), h('dd', null, `${fv(ref.q, 6)} Pa`), h('dt', null, 'Re (L_ref)'), h('dd', null, Number.isFinite(ref.Re) ? ref.Re.toExponential(3) : '—'),
        h('dt', null, 'A_ref por elemento'), h('dd', null, ref.Ael.map((a) => `${fv(a, 4)}`).join(' / ') + ' m²')),
      msgs([...ref.errors.map((m) => ({ level: 'erro', msg: m })), ...ref.notes.map((m) => ({ level: 'info', msg: m })), ...(!(Number(f.Uinf) > 0) ? [{ level: 'erro', msg: 'Informe Uinf.' }] : [])])),
      card('Direções e nomes', h('div', { class: 'fields' },
        vecField('Vetor de sustentação (Lift)', 'liftVector', vec.lift), vecField('Vetor de arrasto (Drag)', 'dragVector', vec.drag),
        textField({ label: 'Parâmetro de velocidade', value: f.names.uinf, onChange: (v) => store.update(() => { f.names.uinf = v; }) }),
        textField({ label: 'Sustentação total', value: f.names.liftTotal, onChange: (v) => store.update(() => { f.names.liftTotal = v; }) }),
        textField({ label: 'Arrasto total', value: f.names.dragTotal, onChange: (v) => store.update(() => { f.names.dragTotal = v; }) }),
        textField({ label: 'Sustentação por elemento ({n} = nº)', value: f.names.liftEl, onChange: (v) => store.update(() => { f.names.liftEl = v.includes('{n}') ? v : `${v}{n}`; }) }),
        textField({ label: 'Arrasto por elemento ({n} = nº)', value: f.names.dragEl, onChange: (v) => store.update(() => { f.names.dragEl = v.includes('{n}') ? v : `${v}{n}`; }) })),
        h('p', { class: 'muted' }, `Sustentação positiva no sentido ${vec.labels.liftLabel}${pkg.config.transform.sy < 0 ? ' → valores positivos = downforce' : ''}; arrasto no sentido do escoamento ${vec.labels.flowLabel}. Unidades: forças em N, áreas em m².`))),
    card('Condições de contorno', table([{ label: 'Named Selection', get: (b) => h('code', null, b.name) }, { label: 'Tipo', get: (b) => b.bc }, { label: 'Configuração', get: (b) => b.detail }], boundaryConditions(pkg))),
    card('Mapeamento dos relatórios de força (report ↔ superfícies ↔ grandeza ↔ parâmetro)',
      table([{ label: 'Report Definition', get: (r) => h('code', null, r.name) }, { label: 'Grandeza', get: (r) => r.quantity }, { label: 'Vetor', get: (r) => `(${r.vector.join('; ')})` }, { label: 'Superfícies', get: (r) => r.surfaces.join(' + ') }, { label: 'Campo no app', get: (r) => h('code', null, r.field) }, { label: 'Unid.', get: (r) => r.unit }], reps),
      h('h3', null, 'Verificação de dupla contagem'), issues.length ? msgs(issues) : msgs([{ level: 'ok', msg: 'Cada parede aparece uma vez nos totais e em exatamente um relatório por elemento; o solo não entra nas forças.' }])),
    card('Tabela de parâmetros do Workbench (rodada ativa)', table([{ label: 'P', get: (p) => p.param }, { label: 'Nome', get: (p) => h('code', null, p.name) }, { label: 'Tipo', get: (p) => p.kind }, { label: 'Unid.', get: (p) => p.unit }, { label: 'Origem', get: (p) => p.source }, { label: 'Nota', get: (p) => p.note }], parameterTable(pkg, keys)),
      h('p', { class: 'muted' }, 'Entradas = variáveis com níveis na rodada ativa (Inputs) + Uinf. A numeração P real é atribuída pelo Workbench.')),
    card('Instruções geradas', h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { onclick: () => copyText(md).then(() => toast('Instruções copiadas.')) }, 'Copiar'), h('a', { href: '#exportacao' }, 'Exportar como arquivo')), h('pre', { class: 'out' }, md)));
}
