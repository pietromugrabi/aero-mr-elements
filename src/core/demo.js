// Projeto de demonstração. Os RESULTADOS são SINTÉTICOS (função analítica inventada) e ficam
// marcados como dados de exemplo (isExample = true). NÃO são resultados de CFD.

import { newProject, newPackage, newRun, syncDependentLists, logHistory, uid, addSlat, clone } from './model.js';
import { S1223_DAT, NACA23012_DAT } from './samples-data.js';
import { generateDesigns, makeDesignPoints } from './doe.js';
import { referenceInputs } from './wing.js';
import { referenceValues } from './fluent.js';
import { gurneyOn } from './chartdata.js';

/** Valores das cotas DS_ do estudo de referência (3 elementos). */
export const REFERENCE_STUDY = Object.freeze({
  chords: [140, 90, 60], aoa: [3, 18, 33], gap: [null, 7, 4.5], overlap: [null, 3.5, 2.5],
  pivotOff: [7, 5, 3], pivotDTE: [122, 77, 51], gurney: { h: 2.0, t: 0.6 }, Uinf: 33.3, rho: 1.225,
});

/** Slat de EXEMPLO (valores ilustrativos inventados — não existe referência para o slat). */
export const EXAMPLE_SLAT = Object.freeze({
  chord_ref: 35, aoa_ref: -20, gap_ref: 8, overlap_ref: 1, pivot_off_ref: 1.5, pivot_dTE_ref: 30,
  te: { enabled: true, mode: 'pct', value: 0.2, arcPoints: 16 },
});

/** Preenche um pacote com os valores do estudo de referência (perfil informado). */
export function applyReferenceStudy(pkg, datText, profileName, { gurneyOn = false } = {}) {
  const R = REFERENCE_STUDY, c = pkg.config;
  c.elements.forEach((el, i) => {
    if (i > 2) return;
    Object.assign(el, {
      profileName, datText, datFileName: `${profileName}.dat`, inputMode: 'normalizado', alignChord: true,
      chord_ref: R.chords[i], aoa_ref: R.aoa[i], gap_ref: R.gap[i], overlap_ref: R.overlap[i],
      pivot_off_ref: R.pivotOff[i], pivot_dTE_ref: R.pivotDTE[i],
      te: { enabled: true, mode: 'pct', value: 0.2, arcPoints: 16 },
      gurney: { enabled: gurneyOn && i === 2, h: gurneyOn && i === 2 ? R.gurney.h : null, t: gurneyOn && i === 2 ? R.gurney.t : null, pos: 0, side: 'pressao', hRef: 'corda' },
    });
  });
  c.fluent.Uinf = R.Uinf; c.fluent.rho = R.rho;
  syncDependentLists(c);
  return pkg;
}

// ruído determinístico pequeno, para as curvas não parecerem perfeitas
function noise(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return (x - Math.floor(x)) - 0.5; }

/** Saídas sintéticas (N) para um DP. Fórmula arbitrária, apenas para demonstrar o fluxo. */
export function syntheticOutputs(pkg, inputs, seed = 1) {
  const g = gurneyOn(pkg, inputs) ? 1 : 0;
  const a1 = inputs.AoA_1 ?? 3, a2 = inputs.AoA_2 ?? 18, a3 = inputs.AoA_3 ?? 33;
  const g2 = inputs.Gap_2 ?? 7, o2 = inputs.Overlap_2 ?? 3.5, g3 = inputs.Gap_3 ?? 4.5;
  const Cl = 2.45 + 0.06 * (a1 - 3) + 0.035 * (a2 - 18) - 0.0018 * (a2 - 18) ** 2 + 0.022 * (a3 - 33) - 0.0014 * (a3 - 33) ** 2
    - 0.012 * (g2 - 6.2) ** 2 - 0.01 * (o2 - 3) ** 2 - 0.015 * (g3 - 4) ** 2 + 0.16 * g + 0.01 * noise(seed);
  const Cd = 0.105 + 0.0025 * (a2 - 18) + 0.0004 * (a2 - 18) ** 2 + 0.002 * (a3 - 33) + 0.00035 * (a3 - 33) ** 2 + 0.0015 * Math.abs(g2 - 6.5) + 0.02 * g + 0.002 * noise(seed + 7);
  const ref = referenceValues(pkg, inputs);
  const qa = ref.q * ref.Aref;
  // Partição arbitrária entre elementos (soma = 1, nunca média). Com 3 elementos: 52/29/19 % e 38/32/30 %.
  const n = pkg.config.elements.length;
  const norm = (w) => { const s = w.reduce((a, b) => a + b, 0); return w.map((x) => x / s); };
  const shareL = norm(Array.from({ length: n }, (_, i) => [0.52, 0.29, 0.19][i] ?? 0.12));
  const shareD = norm(Array.from({ length: n }, (_, i) => [0.38, 0.32, 0.30][i] ?? 0.15));
  const raw = { lift_total: Cl * qa, drag_total: Cd * qa };
  pkg.config.elements.forEach((_, i) => { raw[`lift_el_${i + 1}`] = Cl * qa * shareL[i]; raw[`drag_el_${i + 1}`] = Cd * qa * shareD[i]; });
  return raw;
}

function fillExample(pkg, run, skipEvery = 0) {
  run.dps.forEach((dp, i) => {
    if (skipEvery && i % skipEvery === skipEvery - 1) return; // alguns DPs ficam pendentes
    dp.outputs = { raw: syntheticOutputs(pkg, dp.inputs, i + 1), rawRow: {}, source: 'EXEMPLO SINTÉTICO (gerado pelo app, não é CFD)', importedAt: new Date().toISOString(), isExample: true };
    dp.status = 'importado';
  });
}

function addRun(pkg, name, levels, method = 'fatorial', skipEvery = 0) {
  const run = newRun(name);
  run.doe = { method, levels, pivotScaling: true };
  const rows = generateDesigns(method, levels, referenceInputs(pkg));
  run.dps = makeDesignPoints(pkg, rows, { pivotScaling: true, uid: () => uid('dp') });
  fillExample(pkg, run, skipEvery);
  run.status = 'concluído';
  run.notes = 'Resultados SINTÉTICOS de demonstração — não são CFD.';
  pkg.runs.push(run);
  return run;
}

export const EXAMPLE_NAME = 'Asa dianteira 3 elementos — exemplo';
const MAIN_EXAMPLE_PACKAGE = 'S1223 3E — sem Gurney';

/**
 * Projeto de exemplo. Padrão: um único pacote (S1223 3E sem Gurney, 3 rodadas).
 * `completo: true` acrescenta os pacotes com Gurney, NACA 23012 e slat (usado nos testes).
 */
export function buildDemoProject({ completo = false } = {}) {
  const prj = newProject(EXAMPLE_NAME);
  prj.isDemo = true;
  prj.description = 'Projeto de exemplo. Geometria = valores DS_ do estudo de referência. Todos os resultados são SINTÉTICOS (não são CFD).';
  prj.notes = 'Use este projeto para conhecer o fluxo. Os resultados foram gerados por uma fórmula arbitrária e estão marcados como EXEMPLO em todas as telas e exportações.';

  const p1 = applyReferenceStudy(newPackage(MAIN_EXAMPLE_PACKAGE, 3), S1223_DAT, 'S1223');
  p1.config.domain.groundClearance = 60; // valor de exemplo
  p1.status = 'concluído';
  addRun(p1, 'Varredura AoA_2 × AoA_3', { AoA_2: '14; 18; 22', AoA_3: '28; 33; 38' });
  addRun(p1, 'Varredura Gap_2 × Overlap_2', { Gap_2: '5; 6; 7; 8', Overlap_2: '2,5; 3,5; 4,5' }, 'fatorial', 7);
  addRun(p1, 'Varredura de velocidade', { Uinf: '15:5:35' });
  prj.packages.push(p1);
  if (!completo) {
    logHistory(prj, 'projeto', prj.name, 'criado', 'projeto de exemplo (resultados sintéticos)');
    return prj;
  }

  const p2 = applyReferenceStudy(newPackage('S1223 3E — com Gurney (el. 3)', 3), S1223_DAT, 'S1223', { gurneyOn: true });
  p2.config.domain.groundClearance = 60;
  p2.status = 'concluído';
  addRun(p2, 'Varredura AoA_2 × AoA_3 (Gurney)', { AoA_2: '14; 18; 22', AoA_3: '28; 33; 38' });
  addRun(p2, 'Com × sem Gurney × AoA_3 (gurney_on_3 = 0; 1)', { gurney_on_3: '0; 1', AoA_3: '28; 33; 38' });
  addRun(p2, 'Altura do Gurney (gurney_h_3)', { gurney_h_3: '1; 1,5; 2; 3; 4' });

  const p3 = applyReferenceStudy(newPackage('NACA 23012 3E — sem Gurney', 3), NACA23012_DAT, 'NACA23012');
  p3.config.domain.groundClearance = 60;
  p3.status = 'em preparação';
  const r3 = newRun('DOE a rodar (sem resultados)');
  r3.doe = { method: 'oat', levels: { AoA_2: '14; 18; 22', Gap_2: '5; 7; 9' }, pivotScaling: true };
  r3.dps = makeDesignPoints(p3, generateDesigns('oat', r3.doe.levels, referenceInputs(p3)), { uid: () => uid('dp') });
  r3.status = 'pronto para rodar';
  p3.runs.push(r3);

  // Slat: NÃO há valores de referência para o slat. Os números abaixo são ILUSTRATIVOS, só para
  // mostrar a funcionalidade, e estão rotulados como exemplo no nome e nas notas do pacote.
  const p4 = applyReferenceStudy(newPackage('EXEMPLO ILUSTRATIVO — 3E + slat (valores do slat inventados)', 3), S1223_DAT, 'S1223');
  const k = addSlat(p4.config);
  Object.assign(p4.config.elements[k], clone(EXAMPLE_SLAT), { profileName: 'S1223', datText: S1223_DAT, datFileName: 'S1223.dat' });
  syncDependentLists(p4.config);
  p4.config.domain.groundClearance = 60;
  p4.notes = 'Slat (elemento 4) com valores ILUSTRATIVOS escolhidos só para gerar uma geometria sem interseção. Não são valores de referência nem de projeto. Sem resultados de CFD.';
  p4.status = 'rascunho';
  const r4 = newRun('Varredura do slat (sem resultados)');
  r4.doe = { method: 'fatorial', levels: { Gap_4: '6; 8; 10', Overlap_4: '1; 3' }, pivotScaling: true };
  r4.dps = makeDesignPoints(p4, generateDesigns('fatorial', r4.doe.levels, referenceInputs(p4)), { uid: () => uid('dp') });
  r4.notes = 'Exemplo de DOE do slat; valores ilustrativos.';
  p4.runs.push(r4);

  prj.packages.push(p2, p3, p4);
  logHistory(prj, 'projeto', prj.name, 'criado', 'projeto de exemplo completo (resultados sintéticos)');
  return prj;
}

/**
 * Limpa projetos de exemplo antigos ("DEMO — …", com vários pacotes) salvos por versões anteriores:
 * mantém um só, com o pacote principal, e sem "DEMO" no nome. Projetos de exemplo renomeados pelo
 * usuário e projetos do usuário não são tocados. Retorna true se algo mudou.
 */
export function trimLegacyDemos(state) {
  const legacy = state.projects.filter((p) => p.isDemo && /^DEMO\b/.test(p.name || ''));
  if (!legacy.length) return false;
  const hasNew = state.projects.some((p) => p.isDemo && !legacy.includes(p));
  const keep = hasNew ? null : legacy[0];
  state.projects = state.projects.filter((p) => !legacy.includes(p) || p === keep);
  if (keep) {
    keep.name = EXAMPLE_NAME;
    keep.description = String(keep.description || '').replace('Projeto de demonstração', 'Projeto de exemplo');
    const main = keep.packages.find((k) => k.name === MAIN_EXAMPLE_PACKAGE) || keep.packages[0];
    keep.packages = main ? [main] : [];
    logHistory(keep, 'projeto', keep.name, 'exemplo simplificado', 'mantido só o pacote principal; demais exemplos removidos');
  }
  const a = state.ui?.active;
  if (a && !state.projects.some((p) => p.id === a.projectId)) state.ui.active = {};
  else if (a && keep && a.projectId === keep.id && !keep.packages.some((k) => k.id === a.packageId)) state.ui.active = { projectId: keep.id };
  return true;
}
