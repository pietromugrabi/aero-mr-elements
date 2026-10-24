import { h, card, msgs, badge, fv, table, exampleBanner } from '../dom.js';
import * as store from '../store.js';
import { wingOf, domainOf, pageHead, projectHasExample, hero } from '../common.js';
import { buildDemoProject } from '../../core/demo.js';
import { newProject } from '../../core/model.js';
import { validateNamedSelections } from '../../core/namedsel.js';
import { reportDefinitions, checkReports, referenceValues } from '../../core/fluent.js';
import { collectRecords, filterRecords, ranking } from '../../core/chartdata.js';

export function loadDemo() {
  const existing = store.getState().projects.find((p) => p.isDemo);
  if (existing) { store.setActive({ projectId: existing.id }); return; } // só um projeto de exemplo
  store.update((s) => {
    const p = buildDemoProject();
    s.projects.push(p);
    s.ui.active = { projectId: p.id, packageId: p.packages[0].id, runId: p.packages[0].runs[0].id };
  });
}

function welcome() {
  return h('div', null,
    hero('Prepare, organize e analise estudos CFD de perfis multielemento — asas, flaps, slats e Gurney flaps — feitos com SolidWorks + ANSYS Workbench/Fluent.'),
    pageHead('Bem-vindo', 'Comece pelo projeto de exemplo ou crie um projeto novo.'),
    h('div', { class: 'grid g2' },
      card('Começar com o exemplo', h('p', null, 'Carrega um projeto de exemplo com uma asa de 3 elementos S1223 (cotas do estudo de referência), 3 rodadas de DOE e resultados. Os resultados são ', h('strong', null, 'sintéticos'), ' e ficam marcados como dados de exemplo em todas as telas.'),
        h('button', { class: 'primary', onclick: loadDemo }, 'Carregar projeto de exemplo')),
      card('Começar do zero', h('p', null, 'Crie um projeto vazio e defina os elementos, os arquivos .dat e as cotas de referência.'),
        h('button', { onclick: () => store.update((s) => { const p = newProject('Novo projeto'); s.projects.push(p); s.ui.active = { projectId: p.id }; }), }, 'Novo projeto'),
        ' ', h('a', { href: '#projetos' }, 'ou importar um projeto (.json)'))),
    storageCard());
}

export function storageCard() {
  const p = store.persist;
  return card('Onde os dados ficam',
    h('ul', null,
      h('li', null, h('strong', null, 'Navegador (IndexedDB)'), ': banco "aero-multielemento" desta origem (', location.origin, '). ', p.idb ? badge('ativo', 'ok') : badge('indisponível', 'warn'), h('br'), h('small', null, 'Trocar de porta/navegador ou limpar dados do site cria um armazenamento separado.')),
      h('li', null, h('strong', null, 'Arquivo local'), ': ', p.server ? h('code', null, p.serverFile || 'dados/estado.json') : 'servidor local não detectado', ' ', p.server ? badge('ativo', 'ok') : badge('inativo', 'warn'), h('br'), h('small', null, 'Gravado pelo iniciar.ps1/server.mjs a cada alteração (com cópia anterior em estado.anterior.json).')),
      h('li', null, 'Backup completo e JSON por projeto em ', h('a', { href: '#exportacao' }, 'Exportação'), ' / ', h('a', { href: '#projetos' }, 'Projetos'), '.')),
    p.error ? msgs([{ level: 'aviso', msg: p.error }]) : null);
}

export default function dashboard(ctx) {
  const { project: prj, pkg, run } = ctx;
  if (!prj) return welcome();
  const nRuns = prj.packages.reduce((s, k) => s + k.runs.length, 0);
  const dps = prj.packages.flatMap((k) => k.runs.flatMap((r) => r.dps));
  const withRes = dps.filter((d) => d.outputs?.raw);
  const stat = (v, l) => h('div', { class: 'card' }, h('div', { class: 'stat tnum' }, v), h('div', { class: 'stat-label' }, l));

  // Situação do pacote ativo
  const steps = [];
  let checks = [];
  if (pkg) {
    const w = wingOf(pkg);
    const geoOk = w.plane && !w.asm.checks.some((c) => c.level === 'erro');
    if (!w.plane) checks.push(...w.errors.map((m) => ({ level: 'erro', msg: m })));
    else checks.push(...w.asm.checks.map((c) => ({ level: c.level, msg: c.msg })));
    const dom = domainOf(pkg, w);
    const domOk = dom && !dom.errors.length;
    if (dom) checks.push(...dom.errors.map((m) => ({ level: 'erro', msg: `Domínio: ${m}` })));
    const ns = validateNamedSelections(pkg.config.namedSelections, pkg.config.elements.length, { ground: pkg.config.domain.groundEnabled });
    const rep = checkReports(reportDefinitions(pkg), pkg.config.namedSelections, pkg.config.elements.length);
    const ref = referenceValues(pkg);
    checks.push(...ns.map((i) => ({ level: i.level, msg: `Named Selections: ${i.msg}` })), ...rep.map((i) => ({ level: i.level, msg: `Relatórios: ${i.msg}` })), ...ref.errors.map((m) => ({ level: 'erro', msg: `Fluent: ${m}` })));
    if (!(Number(pkg.config.fluent.Uinf) > 0)) checks.push({ level: 'erro', msg: 'Fluent: informe Vel_ref / Uinf.' });
    const meshSet = pkg.config.mesh.inflation.some((i) => i.firstLayer != null);
    steps.push(['geometria', 'Geometria', geoOk], ['dominio', 'Domínio', domOk], ['malha', 'Mesh (plano)', meshSet], ['named', 'Named Selections', !ns.some((i) => i.level === 'erro')],
      ['fluent', 'Fluent', !rep.some((i) => i.level === 'erro') && Number(pkg.config.fluent.Uinf) > 0 && !ref.errors.length],
      ['inputs', 'Design Points', !!run?.dps.length], ['outputs', 'Outputs', !!run?.dps.some((d) => d.outputs?.raw)]);
  }

  const recs = filterRecords(collectRecords(prj), {});
  const top = (m) => ranking(recs, m, { limit: 5 });
  const tops = [['Cl', 'Maior Cl_total'], ['ClCd', 'Maior Cl/Cd total']];

  return h('div', null,
    hero('Estudos CFD de perfis multielemento · SolidWorks + ANSYS Workbench/Fluent'),
    pageHead(prj.name, prj.description || 'Visão geral do projeto ativo.'),
    projectHasExample(prj) ? exampleBanner() : null,
    h('div', { class: 'grid g4' }, stat(prj.packages.length, 'pacotes'), stat(nRuns, 'rodadas'), stat(dps.length, 'Design Points'), stat(`${withRes.length}`, `DPs com resultados (${dps.length ? Math.round((100 * withRes.length) / dps.length) : 0} %)`)),
    pkg ? card(`Fluxo do pacote ativo — ${pkg.name}`,
      h('div', { class: 'flow' }, steps.map(([id, l, ok], i) => h('a', { href: `#${id}` }, badge(`${i + 1}. ${l} ${ok ? '✓' : '…'}`, ok ? 'ok' : 'warn')))),
      h('h3', null, `Verificações (${checks.filter((c) => c.level === 'erro').length} erro(s), ${checks.filter((c) => c.level === 'aviso').length} aviso(s))`),
      checks.length ? msgs(checks.slice(0, 12)) : msgs([{ level: 'ok', msg: 'Nenhum problema encontrado na geometria, domínio, Named Selections e relatórios.' }]),
      checks.length > 12 ? h('small', null, `… e mais ${checks.length - 12}. Veja cada seção.`) : null) : card('Pacote', h('p', null, 'Crie um pacote em ', h('a', { href: '#projetos' }, 'Projetos'), '.')),
    h('div', { class: 'grid g2' },
      ...tops.map(([m, title]) => card(title, top(m).length ? table([
        { label: 'DP', get: (e) => e.rec.dpName }, { label: 'Pacote / rodada', get: (e) => `${e.rec.pkgName} / ${e.rec.runName}` },
        { label: m === 'Cl' ? 'Cl' : 'Cl/Cd', num: true, get: (e) => fv(e.v, 4) }, { label: '', get: (e) => (e.rec.isExample ? badge('exemplo', 'example') : '') },
      ], top(m)) : h('p', { class: 'muted' }, 'Sem resultados importados.')))),
    h('div', { class: 'grid g2' },
      card('Alterações recentes', prj.history.length ? table([
        { label: 'Quando', get: (e) => new Date(e.ts).toLocaleString('pt-BR') }, { label: 'Item', get: (e) => `${e.entity}: ${e.name}` }, { label: 'Ação', get: (e) => `${e.action}${e.detail ? ' — ' + e.detail : ''}` },
      ], prj.history.slice(0, 8)) : h('p', { class: 'muted' }, 'Sem histórico.'), h('p', null, h('a', { href: '#projetos' }, 'Histórico completo'))),
      storageCard()));
}
