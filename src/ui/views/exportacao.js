import { h, card, msgs, badge, download, safeName, toast } from '../dom.js';
import { needs, pageHead, wingOf, domainOf } from '../common.js';
import { exportProjectJSON, backupAll, restoreAll, importProjectJSON } from '../io.js';
import { processedDat, coordsCSV, solidworksCurve, designModelerCurve, inputsTable, outputsTable, csvOf, domainReport, namedSelectionsCSV, meshPlanMD, fluentSetupMD, workbenchParamsCSV, todoMD } from '../../core/export.js';
import { makeXlsx, makeZip } from '../../core/xlsx.js';
import { parameterTable } from '../../core/fluent.js';
import { suggestionsFor } from './malha.js';
import { runReportXlsx } from '../../core/report.js';
import { inputKeysOf } from './fluent.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Lista de arquivos exportáveis do pacote/rodada ativos: [{group, name, desc, make(): string|Uint8Array}] */
function exportItems(prj, pkg, run) {
  const w = wingOf(pkg);
  const base = safeName(pkg.name);
  const list = [];
  const plane = pkg.config.transform.plane;
  if (w.plane) {
    pkg.config.elements.forEach((el, i) => {
      const n = i + 1, pn = safeName(el.profileName || `elemento${n}`);
      list.push({ group: 'Geometria', name: `${base}_el${n}_${pn}_processado.dat`, desc: `Elemento ${n}: .dat normalizado (x/c), ${el.te?.enabled ? 'BF arredondado' : 'BF original'}, corda ${pkg.config.conventions.chordDef}`, make: () => processedDat(w.procs[i], el.profileName || `elemento ${n}`) });
      list.push({ group: 'Geometria', name: `${base}_el${n}_coordenadas_mm.csv`, desc: `Elemento ${n} montado (AoA, pivô, gap/overlap) em mm, plano ${plane}`, make: () => coordsCSV(w.plane[i], plane) });
      list.push({ group: 'Geometria', name: `${base}_el${n}_SolidWorks_XYZ.txt`, desc: `Elemento ${n}: Curva por pontos XYZ do SolidWorks (mm, fechada)`, make: () => solidworksCurve(w.plane[i], plane) });
    });
    list.push({ group: 'Geometria', name: `${base}_DesignModeler_curvas.txt`, desc: 'Todos os elementos para 3D Curve do DesignModeler (grupo, id, X, Y, Z)', make: () => designModelerCurve(w.plane, plane) });
    const dom = domainOf(pkg, w);
    list.push({ group: 'Preparação', name: `${base}_dominio.md`, desc: 'Relatório do domínio (distâncias, coordenadas, recomendações)', make: () => domainReport(pkg, w, dom) });
  }
  const keys = inputKeysOf(pkg, run);
  list.push({ group: 'Preparação', name: `${base}_named_selections.csv`, desc: 'Lista de Named Selections (nome, tipo, entidades, CC)', make: () => namedSelectionsCSV(pkg) });
  list.push({ group: 'Preparação', name: `${base}_plano_de_malha.md`, desc: 'Plano de malha (valores e sugestões rotuladas)', make: () => meshPlanMD(pkg, suggestionsFor(pkg)?.perElement ? suggestionsFor(pkg) : null) });
  list.push({ group: 'Preparação', name: `${base}_fluent_setup.md`, desc: 'CCs, Reference Values, relatórios de força, parâmetros e instruções', make: () => fluentSetupMD(pkg, keys) });
  list.push({ group: 'Preparação', name: `${base}_parametros_workbench.csv`, desc: 'Lista de parâmetros do Workbench (entradas DS_ + Uinf, saídas)', make: () => workbenchParamsCSV(pkg, keys) });
  list.push({ group: 'Preparação', name: `${base}_O_QUE_FALTA_FAZER.md`, desc: 'Checklist do que ainda precisa ser feito no SolidWorks/DM/Meshing/Fluent/Workbench', make: () => todoMD(pkg) });
  if (run) {
    const rb = safeName(`${pkg.name}_${run.name}`);
    const opts = run.outputOpts || {};
    list.push({ group: 'Estudo', name: `Relatorio_${rb}.xlsx`, desc: 'RELATÓRIO COMPLETO da rodada em Excel: resumo, entradas, saídas, um bloco por simulação (DP) e gráficos nativos do Excel', mime: XLSX, make: () => runReportXlsx(prj, pkg, run, opts) });
    list.push({ group: 'Estudo', name: `${rb}_entradas.csv`, desc: 'Design Points — entradas (nomes do app)', make: () => csvOf(inputsTable(prj, pkg, run)) });
    list.push({ group: 'Estudo', name: `${rb}_entradas_DS.csv`, desc: 'Design Points — entradas com nomes DS_ (Workbench)', make: () => csvOf(inputsTable(prj, pkg, run, { withDS: true })) });
    list.push({ group: 'Estudo', name: `${rb}_saidas.csv`, desc: 'Saídas brutas + coeficientes calculados (colunas separadas)', make: () => csvOf(outputsTable(prj, pkg, run, opts)) });
    list.push({ group: 'Estudo', name: `${rb}_estudo.xlsx`, desc: 'Excel com abas Entradas, Entradas (DS_), Saídas, Parâmetros e Named Selections', mime: XLSX, make: () => makeXlsx([
      { name: 'Entradas', ...inputsTable(prj, pkg, run) }, { name: 'Entradas DS_', ...inputsTable(prj, pkg, run, { withDS: true }) }, { name: 'Saidas', ...outputsTable(prj, pkg, run, opts) },
      { name: 'Parametros', headers: ['P', 'nome', 'tipo', 'unidade', 'origem'], rows: parameterTable(pkg, keys).map((p) => [p.param, p.name, p.kind, p.unit, p.source]) },
      { name: 'Named Selections', headers: ['nome', 'tipo', 'entidades', 'descrição', 'CC', 'notas'], rows: pkg.config.namedSelections.map((s) => [s.name, s.type, s.entities, s.description, s.bc, s.notes]) }]) });
  }
  return list;
}

export default function exportacao(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const { project: prj, pkg, run } = ctx;
  const items = exportItems(prj, pkg, run);
  const w = wingOf(pkg);
  const dl = (it) => { try { const d = it.make(); download(it.name, d instanceof Uint8Array ? new Blob([d], { type: it.mime || 'application/octet-stream' }) : d, it.mime || (it.name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8')); } catch (e) { toast(`Falha ao gerar ${it.name}: ${e.message}`, true); } };
  const zipAll = () => {
    try {
      const files = items.map((it) => ({ name: it.name, data: it.make() }));
      const hasEx = run?.dps.some((d) => d.outputs?.isExample);
      files.push({ name: 'LEIA-ME.txt', data: `Exportado pelo AERO MULT-MR ELEMENTS em ${new Date().toLocaleString('pt-BR')}\nProjeto: ${prj.name}\nPacote: ${pkg.name}\nRodada: ${run?.name || '—'}\n${hasEx ? '\nATENÇÃO: esta rodada contém DADOS DE EXEMPLO (sintéticos), não resultados de CFD.\n' : ''}\nVeja *_O_QUE_FALTA_FAZER.md para os passos no SolidWorks / DesignModeler / Meshing / Fluent / Workbench.\n` });
      download(`${safeName(pkg.name)}_exportacao.zip`, new Blob([makeZip(files)], { type: 'application/zip' }));
    } catch (e) { toast(`Falha ao gerar o .zip: ${e.message}`, true); }
  };
  const groups = [...new Set(items.map((i) => i.group))];
  return h('div', null,
    pageHead(`Exportação — ${pkg.name}${run ? ` / ${run.name}` : ''}`, 'Arquivos gerados a partir do pacote e da rodada ativos. Nada é enviado para fora do seu computador.',
      run ? h('button', { onclick: () => dl(items.find((x) => x.name.startsWith('Relatorio_'))) }, 'Relatório completo da rodada (Excel)') : null,
      h('button', { onclick: () => { try { const files = prj.packages.flatMap((k) => k.runs.map((r) => ({ name: safeName(`Relatorio_${k.name}_${r.name}`) + '.xlsx', data: runReportXlsx(prj, k, r, r.outputOpts || {}) }))); if (!files.length) { toast('Nenhuma rodada no projeto.', true); return; } download(`${safeName(prj.name)}_relatorios_excel.zip`, new Blob([makeZip(files)], { type: 'application/zip' })); } catch (e) { toast(`Falha: ${e.message}`, true); } } }, 'Relatórios Excel de todas as rodadas (.zip)'),
      h('button', { class: 'primary', onclick: zipAll }, `Baixar tudo (.zip, ${items.length + 1} arquivos)`)),
    !w.plane ? msgs([{ level: 'aviso', msg: 'Geometria incompleta: os arquivos de coordenadas não estão disponíveis.' }]) : null,
    run?.dps.some((d) => d.outputs?.isExample) ? msgs([{ level: 'aviso', msg: 'A rodada ativa contém DADOS DE EXEMPLO; as exportações de saídas os marcam como "SIM (sintético)".' }]) : null,
    h('div', { class: 'grid g2' }, groups.map((g) => card(g, h('div', { class: 'stack' }, items.filter((i) => i.group === g).map((it) => h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'nowrap' } },
      h('div', { style: { minWidth: 0 } }, h('div', null, h('code', null, it.name)), h('small', { class: 'muted' }, it.desc)), h('button', { class: 'small', onclick: () => dl(it) }, 'Baixar'))))))),
    h('div', { class: 'grid g2' },
      card('Projeto e backup', h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('button', { onclick: () => exportProjectJSON(prj) }, 'Exportar projeto (.json)'), h('button', { onclick: importProjectJSON }, 'Importar projeto (.json)')),
        h('div', { class: 'row' }, h('button', { onclick: backupAll }, 'Backup completo (.json)'), h('button', { onclick: restoreAll }, 'Restaurar backup')),
        h('small', { class: 'muted' }, 'O JSON do projeto inclui os textos .dat originais, todas as configurações, DPs, resultados brutos, gráficos salvos e o histórico.'))),
      card('Situação', h('ul', null,
        h('li', null, badge('feito aqui', 'ok'), ' preparação da geometria, montagem, domínio, plano de malha, Named Selections, setup e tabela de DPs; importação e análise de resultados.'),
        h('li', null, badge('fora do app', 'warn'), ' CAD (SolidWorks), DesignModeler, malha (Meshing), solução (Fluent) e execução dos Design Points (Workbench).')))),
    card('O que ainda precisa ser feito fora deste aplicativo', h('pre', { class: 'out' }, todoMD(pkg))));
}
