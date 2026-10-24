import { h, card, msgs, badge, checkField, seg, confirmBox, toast, pickFile, download, safeName, fv, exampleBanner } from '../dom.js';
import * as store from '../store.js';
import { needs, pageHead, hasExample } from '../common.js';
import { mathBlock } from '../math.js';
import { readOutputsText, planImport, computeDP, expectedOutputFields } from '../../core/outputs.js';
import { doeVariables, derivedColumns } from '../../core/doe.js';
import { outputsTable, csvOf, xlsxOf } from '../../core/export.js';
import { runReportXlsx } from '../../core/report.js';

function fieldOptions(pkg) {
  const o = [['', '— ignorar —'], ['dp', 'Identificação do DP']];
  expectedOutputFields(pkg).forEach((f) => o.push([f, `saída: ${f} [N]`]));
  [...doeVariables(pkg), ...derivedColumns(pkg)].forEach((v) => o.push([`in:${v.key}`, `entrada (conferência): ${v.label} [${v.unit}]`]));
  return o;
}

function reportView(rep) {
  if (!rep) return null;
  const L = [];
  L.push({ level: rep.matched ? 'ok' : 'erro', msg: `${rep.matched} DP(s) associados${rep.when ? ` em ${new Date(rep.when).toLocaleString('pt-BR')}` : ''}${rep.file ? ` (${rep.file})` : ''}.` });
  rep.warnings.forEach((m) => L.push({ level: 'aviso', msg: m }));
  if (rep.unmatchedRows.length) L.push({ level: 'aviso', msg: `Linhas sem DP correspondente (ignoradas): ${rep.unmatchedRows.slice(0, 15).join(', ')}${rep.unmatchedRows.length > 15 ? '…' : ''}` });
  if (rep.duplicates.length) L.push({ level: 'aviso', msg: `DPs repetidos no arquivo: ${rep.duplicates.join('; ')}` });
  if (rep.dpsWithout.length) L.push({ level: 'info', msg: `DPs da rodada sem linha no arquivo: ${rep.dpsWithout.slice(0, 20).join(', ')}${rep.dpsWithout.length > 20 ? '…' : ''}` });
  if (rep.unknownColumns.length) L.push({ level: 'aviso', msg: `Colunas desconhecidas (não importadas): ${rep.unknownColumns.join(', ')}` });
  if (rep.missingFields.length) L.push({ level: 'aviso', msg: `Campos esperados ausentes: ${rep.missingFields.join(', ')}` });
  rep.unitNotes.forEach((m) => L.push({ level: 'info', msg: `Unidade — ${m}` }));
  if (rep.emptyCells) L.push({ level: 'aviso', msg: `${rep.emptyCells} célula(s) vazia(s) ou não numérica(s) ficaram sem valor.` });
  if (rep.inputMismatch.length) L.push({ level: 'erro', msg: `Entradas do arquivo diferentes das do DP (associação suspeita): ${rep.inputMismatch.slice(0, 8).join('; ')}${rep.inputMismatch.length > 8 ? '…' : ''}` });
  return msgs(L);
}

export default function outputs(ctx) {
  const miss = needs(['project', 'pkg', 'run'], ctx); if (miss) return miss;
  const { project: prj, pkg, run, ui } = ctx;
  const n = pkg.config.elements.length;
  run.outputOpts = run.outputOpts || { sumIfMissing: false };
  const opts = run.outputOpts;

  const analyse = (text, name) => { try { ui.imp = { ...readOutputsText(text, pkg), name, matchBy: 'nome', isExample: false }; ui.plan = null; ctx.rerender(); } catch (e) { toast(`Falha ao ler: ${e.message}`, true); } };
  const ta = h('textarea', { placeholder: 'Cole aqui a tabela exportada do Workbench (Parameter Set → Export Table) ou de uma planilha. Separadores , ; ou tab; vírgula decimal aceita.' });
  ta.value = ui.pasted || '';
  ta.addEventListener('input', () => { ui.pasted = ta.value; });

  const imp = ui.imp;
  let impBody = null;
  if (imp) {
    const opt = fieldOptions(pkg);
    const plan = planImport(imp.parsed, imp.mapping, run.dps, pkg, { matchBy: imp.matchBy, isExample: imp.isExample, source: imp.name });
    impBody = h('div', null,
      h('h3', null, `Associação de colunas — ${imp.name} (${imp.parsed.rows.length} linha(s), separador "${imp.parsed.delimiter === '\t' ? 'tab' : imp.parsed.delimiter}")`),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Coluna no arquivo', 'Campo', 'Unidade', 'Conversão'].map((t) => h('th', null, t)))),
        h('tbody', null, imp.mapping.map((m) => h('tr', null, h('td', null, h('code', null, m.header)),
          h('td', null, h('select', { onchange: (e) => { m.field = e.target.value || null; ctx.rerender(); } }, opt.map(([v, l]) => h('option', { value: v, selected: (m.field || '') === v ? true : null }, l)))),
          h('td', null, m.unit || '—'), h('td', null, m.unitNote || (m.factor !== 1 ? `× ${m.factor}` : '—'))))))),
      h('div', { class: 'row', style: { margin: '10px 0' } }, h('span', { class: 'lbl' }, 'Associar linhas por:'), seg([['nome', 'nome do DP'], ['ordem', 'ordem das linhas']], imp.matchBy, (v) => { imp.matchBy = v; ctx.rerender(); }),
        checkField({ label: 'Marcar como DADOS DE EXEMPLO (não CFD)', checked: imp.isExample, onChange: (v) => { imp.isExample = v; } })),
      h('h3', null, 'Pré-visualização do relatório'), reportView(plan.report),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !plan.updates.length || null, onclick: async () => {
          const over = plan.updates.filter((u) => run.dps.find((d) => d.id === u.dpId)?.outputs).length;
          if (over && !(await confirmBox('Sobrescrever resultados', `${over} DP(s) já têm resultados. Sobrescrever?`, 'Sobrescrever'))) return;
          const fin = planImport(imp.parsed, imp.mapping, run.dps, pkg, { matchBy: imp.matchBy, isExample: imp.isExample, source: imp.name });
          store.update(() => {
            fin.updates.forEach((u) => { const d = run.dps.find((x) => x.id === u.dpId); d.outputs = u.outputs; d.status = 'importado'; d.outputsStale = false; });
            run.lastImport = { ...fin.report, when: new Date().toISOString(), file: imp.name };
          }, ['outputs', run.name, `${fin.updates.length} resultado(s) importado(s)`, imp.name]);
          ui.imp = null; ui.pasted = '';
          toast(`${fin.updates.length} DP(s) atualizados.`);
        } }, `Importar ${plan.updates.length} DP(s)`),
        h('button', { onclick: () => { ui.imp = null; ctx.rerender(); } }, 'Cancelar')));
  }

  const importCard = card('Importar resultados (CSV ou colado)',
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('button', { onclick: async () => { const f = await pickFile('.csv,.txt,.tsv'); if (f) analyse(f.text, f.name); } }, 'Abrir arquivo CSV…'),
      h('button', { onclick: () => { if (ta.value.trim()) analyse(ta.value, 'texto colado'); else toast('Cole a tabela primeiro.', true); } }, 'Analisar texto colado'),
      h('small', { class: 'muted' }, 'Reconhece "P2 - lift_force [N]", "P3@DS_chord1@Ref@…", lift_el1/lift_eln/lift_element_1, kN/lbf.')),
    imp ? null : ta, impBody);

  // --- resultados
  const rows = run.dps.map((d) => ({ d, c: computeDP(d, pkg, opts) }));
  const withRes = rows.filter((r) => r.c.has);
  ui.view = ui.view || 'calc';
  const cell = (v, d = 4) => h('td', { class: 'num' }, fv(v, d));
  let tbl;
  if (ui.view === 'calc') {
    tbl = h('table', null,
      h('thead', null, h('tr', { class: 'grp' }, h('th', { colspan: 4 }, ''), h('th', { colspan: 5 }, 'Total'), Array.from({ length: n }, (_, i) => h('th', { colspan: 6 }, `Elemento ${i + 1}`)), h('th', null, '')),
        h('tr', null, ['DP', 'Uinf [m/s]', 'q [Pa]', 'A_ref [m²]', 'Lift_force [N]', 'Drag_force [N]', 'Cl_total', 'Cd_total', 'Cl/Cd'].map((t) => h('th', { class: 'num' }, t)),
          Array.from({ length: n }, (_, i) => [`lift_el${i + 1} [N]`, `drag_el${i + 1} [N]`, 'Cl', 'Cd', 'Cl/Cd', '% do L'].map((t) => h('th', { class: 'num' }, t))), h('th', null, 'Avisos'))),
      h('tbody', null, withRes.map(({ d, c }) => h('tr', null, h('td', null, d.name, ' ', d.outputs.isExample ? badge('exemplo', 'example') : null, d.outputsStale ? badge('entrada alterada', 'warn') : null),
        cell(c.ref.U), cell(c.ref.q), cell(c.ref.Aref), cell(c.L), cell(c.D), cell(c.Cl), cell(c.Cd), cell(c.ClCd),
        c.perEl.map((e) => [cell(e.L), cell(e.D), cell(e.Cl), cell(e.Cd), cell(e.ClCd), h('td', { class: 'num' }, e.share == null ? '—' : `${fv(100 * e.share, 3)} %`)]),
        h('td', null, c.flags.length ? h('span', { title: c.flags.join('\n') }, badge(`${c.flags.length}`, 'warn')) : '')))));
  } else {
    const headers = [...new Set(withRes.flatMap(({ d }) => Object.keys(d.outputs.rawRow || {})))];
    tbl = h('table', null, h('thead', null, h('tr', null, h('th', null, 'DP'), h('th', null, 'Origem'), headers.map((x) => h('th', null, x)))),
      h('tbody', null, withRes.map(({ d }) => h('tr', null, h('td', null, d.name), h('td', null, d.outputs.source || '—'), headers.map((x) => h('td', null, d.outputs.rawRow?.[x] ?? ''))))));
  }
  const fname = safeName(`${pkg.name}_${run.name}_saidas`);
  const resCard = card(`Resultados — ${run.name} (${withRes.length}/${run.dps.length} DPs)`,
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      seg([['calc', 'Calculados (coeficientes)'], ['raw', 'Brutos (como importados)']], ui.view, (v) => { ui.view = v; ctx.rerender(); }),
      checkField({ label: 'Sem total importado: usar Σ elementos (rotulado)', checked: opts.sumIfMissing, onChange: (v) => store.update(() => { opts.sumIfMissing = v; }, ['outputs', run.name, 'Σ elementos', String(v)]) }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'small', onclick: () => download(`${fname}.csv`, csvOf(outputsTable(prj, pkg, run, opts)), 'text/csv') }, 'CSV'),
      h('button', { class: 'small', onclick: () => download(`${fname}_ptBR.csv`, csvOf(outputsTable(prj, pkg, run, opts), true), 'text/csv') }, 'CSV (; e vírgula)'),
      h('button', { class: 'small', onclick: () => download(`${fname}.xlsx`, new Blob([xlsxOf([{ name: 'Saidas', ...outputsTable(prj, pkg, run, opts) }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })) }, 'Excel (.xlsx)'),
      h('button', { class: 'small danger', disabled: !withRes.length || null, onclick: async () => { if (await confirmBox('Apagar resultados', `Apagar os resultados importados dos ${withRes.length} DP(s) desta rodada? As entradas são mantidas.`, 'Apagar', true)) store.update(() => { run.dps.forEach((d) => { d.outputs = null; d.status = 'pendente'; }); }, ['outputs', run.name, 'resultados apagados']); } }, 'Apagar resultados')),
    withRes.length ? h('div', { class: 'table-wrap tall' }, tbl) : h('div', { class: 'empty' }, 'Sem resultados nesta rodada. Importe o CSV do Workbench acima.'),
    mathBlock('q = ½·ρ·U²   CL = L / (q·A_ref)   CD = D / (q·A_ref)   Cl/Cd só quando CD ≠ 0\nTotais = relatório total do Fluent (ou Σ elementos, se marcado). Nunca são médias. Valores calculados não são gravados: são recalculados a partir dos dados brutos.', { style: { marginTop: '10px' } }));

  const reportBtn = h('button', { class: 'primary', onclick: () => { try { download(safeName(`Relatorio_${pkg.name}_${run.name}`) + '.xlsx', new Blob([runReportXlsx(prj, pkg, run, opts)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); } catch (e) { toast(`Falha ao gerar o relatório: ${e.message}`, true); } } }, 'Baixar relatório completo (Excel)');
  return h('div', null, pageHead(`Outputs — ${run.name}`, 'Resultados por Design Point: dados brutos importados e coeficientes calculados (separados).', reportBtn),
    hasExample(run) ? exampleBanner() : null, importCard,
    run.lastImport ? card('Relatório da última importação', reportView(run.lastImport)) : null, resCard);
}
