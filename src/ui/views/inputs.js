import { h, card, msgs, badge, checkField, seg, confirmBox, modal, toast, copyText, download, safeName } from '../dom.js';
import * as store from '../store.js';
import { needs, pageHead, wingOf } from '../common.js';
import { doeVariables, derivedColumns, parseLevels, countDesigns, generateDesigns, makeDesignPoints, findDuplicates, LIMITS, dpViolations, filterValidRows, doeRules } from '../../core/doe.js';
import { referenceInputs, withDerivedPivots } from '../../core/wing.js';
import { uid } from '../../core/model.js';
import { parseNum, fmt } from '../../core/num.js';
import { parseCSV, toTSV } from '../../core/csv.js';
import { detectMapping } from '../../core/outputs.js';
import { inputsTable, csvOf, xlsxOf } from '../../core/export.js';

function groupedColumns(pkg) {
  const vars = doeVariables(pkg), der = derivedColumns(pkg);
  const groups = [];
  pkg.config.elements.forEach((_, i) => {
    const n = i + 1;
    groups.push({ name: `Elemento ${n}`, cols: [...vars.filter((v) => v.element === n), ...der.filter((d) => d.element === n)] });
  });
  groups.push({ name: 'Escoamento', cols: vars.filter((v) => v.element == null) });
  return groups;
}

/** Validação geométrica de um DP (interseções, folgas, pivôs, cotas SolidWorks). */
function checkDP(pkg, dp) {
  const w = wingOf(pkg, dp.inputs);
  const rule = dpViolations(pkg, dp.inputs).map((m) => `DP inválido pelas regras: ${m}`);
  if (!w.plane) return { level: 'erro', msgs: [...rule, ...w.errors] };
  const e = w.asm.checks.filter((c) => c.level === 'erro'), a = w.asm.checks.filter((c) => c.level === 'aviso');
  return { level: e.length || rule.length ? 'erro' : a.length ? 'aviso' : 'ok', msgs: [...rule, ...w.asm.checks.map((c) => c.msg)], clearance: w.asm.slots.map((s) => s.clearance) };
}

async function pasteDialog(pkg, run) {
  const ta = h('textarea', { placeholder: 'Cole aqui linhas copiadas de uma planilha (com ou sem cabeçalho). Sem cabeçalho, as colunas devem seguir a ordem das colunas editáveis da tabela.' });
  const mode = { v: 'acrescentar' };
  const r = await modal('Colar Design Points', h('div', null, ta, h('div', { class: 'row', style: { marginTop: '8px' } }, seg([['acrescentar', 'Acrescentar'], ['substituir', 'Substituir todos']], mode.v, (v) => { mode.v = v; ta.closest('.modal').querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.textContent.startsWith(v === 'acrescentar' ? 'Acres' : 'Subst'))); }))),
    [{ label: 'Cancelar', value: null }, { label: 'Colar', value: 'ok', primary: true }]);
  if (r !== 'ok' || !ta.value.trim()) return;
  const p = parseCSV(ta.value);
  const editable = doeVariables(pkg).map((v) => v.key);
  const map = detectMapping(p.headers, pkg);
  const hasHeader = map.some((m) => m.field?.startsWith('in:'));
  const rowsData = hasHeader ? p.rows : [p.headers, ...p.rows].filter((row) => row.some((c) => c));
  const ref = referenceInputs(pkg);
  const out = [], bad = [];
  rowsData.forEach((row, ri) => {
    const inp = { ...ref };
    let name = null;
    if (hasHeader) {
      map.forEach((m) => { if (m.field === 'dp') name = row[m.index]; else if (m.field?.startsWith('in:')) { const v = parseNum(row[m.index]); if (Number.isFinite(v)) inp[m.field.slice(3)] = v * m.factor; else bad.push(`linha ${ri + 1}, ${m.header}`); } });
    } else {
      editable.forEach((k, j) => { if (row[j] == null || row[j] === '') return; const v = parseNum(row[j]); if (Number.isFinite(v)) inp[k] = v; else bad.push(`linha ${ri + 1}, coluna ${j + 1}`); });
    }
    out.push({ inp, name });
  });
  store.update(() => {
    if (mode.v === 'substituir') run.dps = [];
    const start = run.dps.length;
    out.forEach((o, i) => run.dps.push({ id: uid('dp'), name: o.name || `DP ${start + i}`, status: 'pendente', notes: '', inputs: withDerivedPivots(pkg, o.inp, run.doe.pivotScaling !== false), outputs: null }));
    run.doe.method = 'manual';
  }, ['DOE', run.name, `${out.length} DP(s) colado(s)`, mode.v]);
  toast(`${out.length} linha(s) colada(s)${hasHeader ? ' (colunas pelo cabeçalho)' : ' (colunas pela ordem)'}.${bad.length ? ` ${bad.length} célula(s) inválida(s) mantiveram o valor de referência.` : ''}`, bad.length > 0);
}

export default function inputs(ctx) {
  const miss = needs(['project', 'pkg', 'run'], ctx); if (miss) return miss;
  const { project: prj, pkg, run, ui } = ctx;
  const doe = run.doe;
  doe.levels = doe.levels || {};
  const vars = doeVariables(pkg);
  const base = referenceInputs(pkg);
  let refErr = null;
  try { withDerivedPivots(pkg, base, true); } catch (e) { refErr = e.message; }
  const count = countDesigns(doe.method, doe.levels, base);
  // DPs que violam as regras do pacote (flap com corda maior / AoA menor que o elemento anterior) não são gerados
  let split = null;
  if (doe.method !== 'manual' && count <= LIMITS.max) { try { split = filterValidRows(pkg, generateDesigns(doe.method, doe.levels, base)); } catch (e) { split = null; } }
  const nValid = split ? split.valid.length : count, nInvalid = split ? split.invalid.length : 0;
  const rules = doeRules(pkg);
  const setRule = (k, v) => store.update(() => { pkg.config.doeRules = { ...doeRules(pkg), [k]: v }; }, ['DOE', pkg.name, `regra de validade ${k}`, String(v)]);
  const groups = groupedColumns(pkg);

  // --- planejamento
  const levelRows = vars.map((v) => {
    const pl = parseLevels(doe.levels[v.key]);
    const inp = h('input', { type: 'text', value: doe.levels[v.key] || '', placeholder: 'ex.: 14; 18; 22  ou  10:2:20', style: { width: '100%' }, dataset: { k: `lv_${v.key}` } });
    inp.addEventListener('change', () => store.update(() => { doe.levels[v.key] = inp.value; }, ['DOE', run.name, `níveis de ${v.label}`, inp.value]));
    return h('tr', null, h('td', null, v.group), h('td', null, h('code', null, v.label), v.note ? h('small', { class: 'muted' }, ` (${v.note})`) : null), h('td', { class: 'num' }, v.ref == null ? badge('sem ref.', 'err') : `${fmt(Number(v.ref), 3)} ${v.unit}`),
      h('td', { style: { minWidth: '220px' } }, inp), h('td', null, pl.error ? badge(pl.error, 'err') : pl.values.length ? `${pl.values.length} nível(is): ${pl.values.map((x) => fmt(x, 3)).join('; ')} ${v.unit}` : h('span', { class: 'muted' }, 'fixo no valor de referência')));
  });
  const countMsg = doe.method === 'manual' ? { level: 'info', msg: 'Modo manual: adicione, edite ou cole linhas na tabela abaixo.' }
    : count > LIMITS.max ? { level: 'erro', msg: `${count} pontos excedem o limite de ${LIMITS.max}. Reduza os níveis.` }
      : count > LIMITS.confirm ? { level: 'aviso', msg: `${count} pontos: cada DP é uma simulação CFD completa. Será pedida confirmação.` }
        : nValid > LIMITS.warn ? { level: 'aviso', msg: `${nValid} pontos — estudo grande (cada DP é uma simulação CFD).` } : { level: 'info', msg: `${nValid} ponto(s) serão gerados.` };
  const invalidMsg = nInvalid ? { level: 'aviso', msg: `${nInvalid} combinação(ões) inválida(s) não serão geradas (ex.: ${split.invalid[0].msgs.join('; ')}).` } : null;
  const generate = async (append) => {
    if (refErr) { toast(refErr, true); return; }
    if (count > LIMITS.max) return;
    if (nValid > LIMITS.confirm && !(await confirmBox('DOE grande', `Gerar ${nValid} Design Points? Cada um é uma simulação CFD.`, 'Gerar'))) return;
    if (!append && run.dps.some((d) => d.outputs) && !(await confirmBox('Substituir DPs', 'A rodada tem DPs com resultados. Substituir apaga esses resultados. Continuar?', 'Substituir', true))) return;
    let rows, removed = 0;
    try { const s = filterValidRows(pkg, generateDesigns(doe.method, doe.levels, base)); rows = s.valid; removed = s.invalid.length; } catch (e) { toast(e.message, true); return; }
    if (!rows.length) { toast('Todas as combinações são inválidas pelas regras (corda do flap maior / AoA menor que o elemento anterior). Ajuste os níveis.', true); return; }
    if (removed) toast(`${removed} combinação(ões) inválida(s) descartada(s); ${rows.length} DP(s) gerado(s).`);
    store.update(() => {
      const start = append ? run.dps.length : 0;
      const dps = makeDesignPoints(pkg, rows, { pivotScaling: doe.pivotScaling !== false, startIndex: start, uid: () => uid('dp') });
      run.dps = append ? run.dps.concat(dps) : dps;
      run.status = run.status === 'rascunho' ? 'em preparação' : run.status;
    }, ['DOE', run.name, `${rows.length} DP(s) gerado(s)`, `${doe.method}${append ? ', acrescentados' : ''}${removed ? `, ${removed} inválido(s) descartado(s)` : ''}`]);
    ui.checks = null;
  };

  const plan = card('Planejamento (níveis por variável)',
    h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: 'lbl' }, 'Método:'),
      seg([['fatorial', 'Fatorial completo'], ['oat', 'Um fator por vez'], ['manual', 'Manual']], doe.method, (v) => store.update(() => { doe.method = v; }, ['DOE', run.name, 'método', v])),
      checkField({ label: 'Pivôs acompanham a corda (pivot_n = pivot_ref/chord_ref·chord_n)', checked: doe.pivotScaling !== false, onChange: (v) => store.update(() => { doe.pivotScaling = v; run.dps.forEach((d) => { d.inputs = withDerivedPivots(pkg, d.inputs, v); }); }, ['DOE', run.name, 'escalonamento do pivô', String(v)]) })),
    h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: 'lbl' }, 'Não gerar DPs inválidos:'),
      checkField({ label: 'flap com corda maior que o elemento anterior (chord_n > chord_(n−1))', checked: rules.chord, onChange: (v) => setRule('chord', v) }),
      checkField({ label: 'flap com AoA menor que o elemento anterior (AoA_n < AoA_(n−1))', checked: rules.aoa, onChange: (v) => setRule('aoa', v) })),
    refErr ? msgs([{ level: 'erro', msg: `${refErr} Corrija os valores de referência na Geometria.` }]) : null,
    doe.method !== 'manual' ? h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Grupo', 'Variável', 'Referência', 'Níveis', 'Interpretação'].map((t) => h('th', null, t)))), h('tbody', null, levelRows))) : null,
    doe.method !== 'manual' ? h('p', { class: 'muted' }, 'Separe níveis por ";" ou espaço (vírgula decimal aceita: "2,5; 3,5"), ou use início:passo:fim. Variáveis sem níveis ficam no valor de referência. Um fator por vez: o ponto base + cada variável variando sozinha.') : null,
    msgs([countMsg, ...(invalidMsg && doe.method !== 'manual' ? [invalidMsg] : [])]),
    doe.method !== 'manual' ? h('div', { class: 'row' }, h('button', { class: 'primary', disabled: count > LIMITS.max || null, onclick: () => generate(false) }, `Gerar ${nValid} DP(s) (substituir)`), h('button', { disabled: count > LIMITS.max || null, onclick: () => generate(true) }, 'Gerar e acrescentar')) : null);

  // --- tabela
  const editKeys = new Set(vars.map((v) => v.key));
  const allCols = groups.flatMap((g) => g.cols);
  const dups = findDuplicates(run.dps.map((d) => d.inputs), vars.map((v) => v.key));
  const q = (ui.q || '').trim().toLowerCase();
  const sel = (ui.sel = ui.sel || new Set());
  const shown = run.dps.filter((d) => !q || d.name.toLowerCase().includes(q) || allCols.some((c) => String(d.inputs[c.key]).replace('.', ',').includes(q)) || (q === 'duplicados' && dups.has(run.dps.indexOf(d))));
  const limit = ui.limit || 300;
  const editCell = (dp, col) => {
    if (!editKeys.has(col.key)) return h('td', { class: 'num derived', title: 'derivado da corda' }, fmt(Number(dp.inputs[col.key]), 3));
    const i = h('input', { type: 'text', class: 'cell', value: Number.isFinite(Number(dp.inputs[col.key])) ? String(+Number(dp.inputs[col.key]).toPrecision(10)).replace('.', ',') : '', dataset: { k: `c_${dp.id}_${col.key}` } });
    i.addEventListener('change', () => {
      const v = parseNum(i.value);
      if (!Number.isFinite(v)) { toast(`Valor inválido em ${col.label}.`, true); return; }
      store.update(() => { dp.inputs[col.key] = v; dp.inputs = withDerivedPivots(pkg, dp.inputs, doe.pivotScaling !== false); if (dp.outputs) dp.outputsStale = true; }, ['DP', `${run.name}/${dp.name}`, `${col.label} alterado`, String(v)]);
      if (ui.checks) ui.checks.delete(dp.id);
    });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
    return h('td', { class: 'num' }, i);
  };
  const chk = ui.checks;
  const thead = h('thead', null,
    h('tr', { class: 'grp' }, h('th', { colspan: 3 }, ''), groups.map((g) => h('th', { colspan: g.cols.length }, g.name)), h('th', { colspan: 2 }, '')),
    h('tr', null, h('th', null, h('input', { type: 'checkbox', checked: shown.length > 0 && shown.every((d) => sel.has(d.id)), onchange: (e) => { shown.forEach((d) => (e.target.checked ? sel.add(d.id) : sel.delete(d.id))); ctx.rerender(); } })), h('th', null, 'DP'), h('th', null, 'Status'),
      allCols.map((c) => h('th', { class: 'num', title: c.derived ? 'derivado (somente leitura)' : '' }, c.label, h('span', { class: 'th-unit' }, ` [${c.unit}]`))), h('th', null, 'Geometria'), h('th', null, 'Resultado')));
  const tbody = h('tbody', null, shown.slice(0, limit).map((dp) => {
    const idx = run.dps.indexOf(dp);
    const c = chk?.get(dp.id);
    return h('tr', { class: (dups.has(idx) ? 'dup ' : '') + (sel.has(dp.id) ? 'sel' : ''), title: dups.has(idx) ? `Duplicado de ${run.dps[dups.get(idx)].name}` : null },
      h('td', null, h('input', { type: 'checkbox', checked: sel.has(dp.id), onchange: (e) => { e.target.checked ? sel.add(dp.id) : sel.delete(dp.id); } })),
      h('td', { style: { whiteSpace: 'nowrap' } }, dp.name, dups.has(idx) ? ' ' : null, dups.has(idx) ? badge('duplicado', 'warn') : null), h('td', null, dp.status),
      allCols.map((col) => editCell(dp, col)),
      h('td', null, c ? h('span', { title: c.msgs.join('\n') }, badge(c.level === 'ok' ? 'OK' : c.level === 'erro' ? `erro (${c.msgs.length})` : `aviso (${c.msgs.length})`, c.level === 'ok' ? 'ok' : c.level === 'erro' ? 'err' : 'warn')) : h('span', { class: 'muted' }, '—')),
      h('td', null, dp.outputs?.raw ? badge(dp.outputs.isExample ? 'exemplo' : dp.outputsStale ? 'entrada alterada!' : 'sim', dp.outputs.isExample ? 'example' : dp.outputsStale ? 'warn' : 'ok') : ''));
  }));
  const qi = h('input', { type: 'text', placeholder: 'Filtrar (nome, valor ou "duplicados")', value: ui.q || '', dataset: { k: 'dpq' } });
  qi.addEventListener('input', () => { ui.q = qi.value; ctx.rerender(); });
  const exportT = (withDS) => inputsTable(prj, pkg, run, { withDS });
  const fname = safeName(`${pkg.name}_${run.name}_entradas`);
  const nErr = chk ? [...chk.values()].filter((c) => c.level === 'erro').length : 0;
  const tableCard = card(`Design Points — ${run.name} (${run.dps.length})`,
    h('div', { class: 'row', style: { marginBottom: '8px' } }, qi,
      h('button', { class: 'small', onclick: () => store.update(() => { const last = run.dps[run.dps.length - 1]; run.dps.push({ id: uid('dp'), name: `DP ${run.dps.length}`, status: 'pendente', notes: '', inputs: withDerivedPivots(pkg, { ...(last ? last.inputs : base) }, doe.pivotScaling !== false), outputs: null }); }, ['DOE', run.name, 'linha adicionada']) }, '+ Linha'),
      h('button', { class: 'small danger', disabled: !sel.size || null, onclick: async () => { if (await confirmBox('Excluir DPs', `Excluir ${sel.size} DP(s) selecionado(s)?`, 'Excluir', true)) { store.update(() => { run.dps = run.dps.filter((d) => !sel.has(d.id)); }, ['DOE', run.name, `${sel.size} DP(s) excluído(s)`]); sel.clear(); } } }, `Excluir selecionados (${sel.size})`),
      h('button', { class: 'small', disabled: !dups.size || null, onclick: () => store.update(() => { const d = findDuplicates(run.dps.map((x) => x.inputs), vars.map((v) => v.key)); run.dps = run.dps.filter((_, i) => !d.has(i)); }, ['DOE', run.name, `${dups.size} duplicado(s) removido(s)`]) }, `Remover duplicados (${dups.size})`),
      h('button', { class: 'small', onclick: () => store.update(() => { run.dps.forEach((d, i) => { d.name = `DP ${i}`; }); }, ['DOE', run.name, 'DPs renumerados']) }, 'Renumerar'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'small', onclick: () => { const t = exportT(false); copyText(toTSV(t.headers, t.rows)).then(() => toast('Tabela copiada (TSV) — cole numa planilha.')); } }, 'Copiar'),
      h('button', { class: 'small', onclick: () => pasteDialog(pkg, run) }, 'Colar…'),
      h('button', { class: 'small', onclick: () => { ui.checks = new Map(run.dps.map((d) => [d.id, checkDP(pkg, d)])); ctx.rerender(); } }, 'Verificar geometria de todos')),
    h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'lbl' }, 'Exportar:'),
      h('button', { class: 'small', onclick: () => download(`${fname}.csv`, csvOf(exportT(false)), 'text/csv') }, 'CSV'),
      h('button', { class: 'small', onclick: () => download(`${fname}_ptBR.csv`, csvOf(exportT(false), true), 'text/csv') }, 'CSV (; e vírgula)'),
      h('button', { class: 'small', onclick: () => download(`${fname}_DS.csv`, csvOf(exportT(true)), 'text/csv') }, 'CSV com nomes DS_'),
      h('button', { class: 'small', onclick: () => download(`${fname}.xlsx`, new Blob([xlsxOf([{ name: 'Entradas', ...exportT(false) }, { name: 'Entradas (nomes DS_)', ...exportT(true) }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })) }, 'Excel (.xlsx)')),
    chk ? msgs([{ level: nErr ? 'erro' : 'ok', msg: `Geometria verificada em ${chk.size} DP(s): ${nErr} com erro (interseção, cota inválida...), ${[...chk.values()].filter((c) => c.level === 'aviso').length} com aviso. Passe o mouse no selo para os detalhes.` }]) : null,
    run.dps.length ? h('div', { class: 'table-wrap tall' }, h('table', null, thead, tbody)) : h('div', { class: 'empty' }, 'Nenhum DP. Defina níveis e gere, adicione linhas ou cole de uma planilha.'),
    shown.length > limit ? h('button', { class: 'small', onclick: () => { ui.limit = limit + 500; ctx.rerender(); } }, `Mostrar mais (${shown.length - limit} ocultos)`) : null,
    h('p', { class: 'muted' }, `IDs: projeto "${prj.name}" › pacote "${pkg.name}" › rodada "${run.name}" (incluídos nas exportações). Colunas cinza = pivôs derivados da corda (referências inalteradas).`));
  return h('div', null, pageHead(`Inputs / Design Points — ${run.name}`, 'Tabela de entradas por DP, agrupada por elemento.'), plan, tableCard);
}
