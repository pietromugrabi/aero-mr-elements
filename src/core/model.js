// Modelo de dados: Projeto → Pacotes (configuração geométrica/CFD) → Rodadas → Design Points.

import { DEFAULT_TRANSFORM } from './transform.js';
import { DEFAULT_CONV, resolveTopology } from './assembly.js';
import { DEFAULT_DOMAIN } from './domain.js';
import { DEFAULT_FLUENT } from './fluent.js';
import { defaultMeshPlan } from './mesh.js';
import { defaultNamedSelections } from './namedsel.js';

export const SCHEMA_VERSION = 1;

export const STATUS = ['rascunho', 'em preparação', 'pronto para rodar', 'rodando', 'concluído', 'arquivado'];
export const DP_STATUS = ['pendente', 'resolvido', 'falhou', 'importado'];

let counter = 0;
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export const nowISO = () => new Date().toISOString();
export const clone = (o) => JSON.parse(JSON.stringify(o));

/** type: 'principal' | 'flap' | 'slat'; ref: índice (0-based) do elemento de referência (null = padrão). */
export function defaultElement(type = 'flap') {
  return {
    type, ref: null, upAnchor: 'bf', profileName: '', datText: '', datFileName: '', inputMode: 'normalizado', alignChord: true,
    chord_ref: null, aoa_ref: null, gap_ref: null, overlap_ref: null, pivot_off_ref: null, pivot_dTE_ref: null,
    te: { enabled: true, mode: 'pct', value: 0.2, arcPoints: 16 },
    gurney: { enabled: false, h: null, t: null, pos: 0, side: 'pressao', hRef: 'corda' },
  };
}

export function defaultPackageConfig(n = 3) {
  const elements = Array.from({ length: n }, (_, i) => defaultElement(i === 0 ? 'principal' : 'flap'));
  return {
    nElements: n, mode: '2D', span_mm: null,
    transform: { ...DEFAULT_TRANSFORM },
    conventions: { ...DEFAULT_CONV },
    elements,
    domain: { ...DEFAULT_DOMAIN },
    mesh: defaultMeshPlan(n, { ground: true }),
    namedSelections: defaultNamedSelections(n, { ground: true }),
    fluent: { ...clone(DEFAULT_FLUENT), Uinf: null },
    reports: null,
  };
}

/** Ajusta o número de elementos preservando os existentes e regenerando listas dependentes. */
export function setElementCount(cfg, n) {
  n = Math.max(1, Math.min(8, Math.round(n)));
  while (cfg.elements.length < n) cfg.elements.push(defaultElement(cfg.elements.length ? 'flap' : 'principal'));
  cfg.elements.length = n;
  cfg.nElements = n;
  syncDependentLists(cfg);
  return cfg;
}

/** Regenera NS e planos de malha mantendo edições do usuário nas linhas que continuam existindo. */
export function syncDependentLists(cfg) {
  const n = cfg.elements.length;
  const gur = cfg.elements.map((e) => !!e.gurney?.enabled || (Number(e.gurney?.h) > 0 && Number(e.gurney?.t) > 0));
  const kinds = resolveTopology(cfg.elements).kinds;
  const fresh = defaultNamedSelections(n, { ground: cfg.domain.groundEnabled, gurney: gur, dim: cfg.mode, groundMoving: cfg.domain.groundMoving, kinds });
  const old = new Map((cfg.namedSelections || []).map((s) => [s.name, s]));
  const keepCustom = (cfg.namedSelections || []).filter((s) => s.custom);
  cfg.namedSelections = fresh.map((s) => {
    const o = old.get(s.name);
    if (!o || !o.edited) return s;
    return { ...s, ...o };
  }).concat(keepCustom);
  const freshMesh = defaultMeshPlan(n, { gurney: gur, ground: cfg.domain.groundEnabled });
  const m = cfg.mesh || freshMesh;
  const es = new Map((m.edgeSizing || []).map((e) => [e.target, e]));
  const inf = new Map((m.inflation || []).map((e) => [e.surface, e]));
  m.edgeSizing = freshMesh.edgeSizing.map((e) => es.get(e.target) || e);
  m.inflation = freshMesh.inflation.map((e) => inf.get(e.surface) || e);
  m.refinements = { ...freshMesh.refinements, ...(m.refinements || {}) };
  m.refinements.gurney = { ...m.refinements.gurney, enabled: gur.some(Boolean) };
  m.refinements.ground = { ...m.refinements.ground, enabled: !!cfg.domain.groundEnabled };
  cfg.mesh = m;
  cfg.reports = null;
}

/** Acrescenta um slat (sem valores de referência: o usuário informa tudo). */
export function addSlat(cfg) {
  const principal = Math.max(0, cfg.elements.findIndex((e) => e.type === 'principal'));
  const el = defaultElement('slat');
  el.ref = principal;
  cfg.elements.push(el);
  cfg.nElements = cfg.elements.length;
  syncDependentLists(cfg);
  return cfg.elements.length - 1;
}

/** Acrescenta um upperflap (acima do principal; sem valores de referência). */
export function addUpperflap(cfg) {
  const principal = Math.max(0, cfg.elements.findIndex((e) => e.type === 'principal'));
  const el = defaultElement('upperflap');
  el.ref = principal;
  cfg.elements.push(el);
  cfg.nElements = cfg.elements.length;
  syncDependentLists(cfg);
  return cfg.elements.length - 1;
}

export function newProject(name = 'Novo projeto') {
  return { id: uid('prj'), name, description: '', notes: '', status: 'rascunho', isDemo: false, createdAt: nowISO(), updatedAt: nowISO(), packages: [], history: [], chartConfigs: [] };
}

export function newPackage(name = 'Novo pacote', n = 3) {
  return { id: uid('pkg'), name, notes: '', status: 'rascunho', createdAt: nowISO(), updatedAt: nowISO(), config: defaultPackageConfig(n), runs: [] };
}

export function newRun(name = 'Nova rodada') {
  return { id: uid('run'), name, notes: '', status: 'rascunho', createdAt: nowISO(), updatedAt: nowISO(), doe: { method: 'fatorial', levels: {}, pivotScaling: true }, dps: [], lastImport: null };
}

function reId(obj, prefix) { obj.id = uid(prefix); obj.createdAt = nowISO(); obj.updatedAt = nowISO(); return obj; }

export function duplicateRun(run) {
  const r = reId(clone(run), 'run');
  r.name = `${run.name} (cópia)`;
  r.dps.forEach((d) => { d.id = uid('dp'); });
  return r;
}

export function duplicatePackage(pkg) {
  const p = reId(clone(pkg), 'pkg');
  p.name = `${pkg.name} (cópia)`;
  p.runs.forEach((r) => { reId(r, 'run'); r.dps.forEach((d) => { d.id = uid('dp'); }); });
  return p;
}

export function duplicateProject(prj) {
  const p = reId(clone(prj), 'prj');
  p.name = `${prj.name} (cópia)`;
  p.packages.forEach((k) => { reId(k, 'pkg'); k.runs.forEach((r) => { reId(r, 'run'); r.dps.forEach((d) => { d.id = uid('dp'); }); }); });
  p.history = [{ ts: nowISO(), entity: 'projeto', name: p.name, action: 'duplicado', detail: `a partir de "${prj.name}"` }];
  return p;
}

/** Registra uma entrada no histórico de alterações do projeto (máx. 1000). */
export function logHistory(project, entity, name, action, detail = '') {
  if (!project) return;
  project.history = project.history || [];
  project.history.unshift({ ts: nowISO(), entity, name, action, detail });
  if (project.history.length > 1000) project.history.length = 1000;
  project.updatedAt = nowISO();
}

export function emptyState() {
  return { version: SCHEMA_VERSION, savedAt: null, ui: { theme: 'claro', active: {} }, projects: [] };
}

/** Migração/saneamento de dados carregados (JSON importado ou armazenamento local). */
export function migrate(state) {
  if (!state || typeof state !== 'object') return emptyState();
  const s = { ...emptyState(), ...state };
  s.ui = { ...emptyState().ui, ...(state.ui || {}) };
  s.projects = (s.projects || []).map(sanitizeProject);
  s.version = SCHEMA_VERSION;
  return s;
}

export function sanitizeProject(p) {
  const base = newProject(p.name);
  const prj = { ...base, ...p, packages: (p.packages || []).map(sanitizePackage), history: p.history || [], chartConfigs: p.chartConfigs || [] };
  return prj;
}

function sanitizePackage(k) {
  const n = k.config?.elements?.length || 3;
  const def = defaultPackageConfig(n);
  const cfg = { ...def, ...(k.config || {}) };
  cfg.transform = { ...def.transform, ...(cfg.transform || {}) };
  cfg.conventions = { ...def.conventions, ...(cfg.conventions || {}) };
  cfg.domain = { ...def.domain, ...(cfg.domain || {}) };
  cfg.fluent = { ...def.fluent, ...(cfg.fluent || {}), names: { ...def.fluent.names, ...(cfg.fluent?.names || {}) } };
  cfg.elements = (cfg.elements || def.elements).map((e, i) => ({ ...defaultElement(i === 0 ? 'principal' : 'flap'), ...e, type: e.type || (i === 0 ? 'principal' : 'flap'), te: { ...defaultElement().te, ...(e.te || {}) }, gurney: { ...defaultElement().gurney, ...(e.gurney || {}) } }));
  cfg.mesh = { ...def.mesh, ...(cfg.mesh || {}) };
  return { ...newPackage(k.name, n), ...k, config: cfg, runs: (k.runs || []).map((r) => ({ ...newRun(r.name), ...r, doe: { ...newRun().doe, ...(r.doe || {}) }, dps: r.dps || [] })) };
}
