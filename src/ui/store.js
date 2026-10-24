// Estado da aplicação e persistência local.
// 1) IndexedDB do navegador (banco "aero-multielemento", store "estado", chave "app") — sempre.
// 2) Arquivo dados/estado.json via servidor local (iniciar.ps1 / server.mjs), quando disponível.
// Na abertura, carrega a cópia mais recente (campo savedAt) entre as duas.

import { migrate, emptyState, logHistory, nowISO } from '../core/model.js';

const DB = 'aero-multielemento', STORE = 'estado', KEY = 'app';
let state = emptyState();
const listeners = new Set();
let saveTimer = null;
export const persist = { idb: false, server: false, serverFile: null, lastSaved: null, error: null, saving: false };

function idb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB indisponível'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet() { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(KEY); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function idbPut(v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, KEY); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

async function serverGet() {
  try {
    const info = await fetch('/api/info', { cache: 'no-store' });
    if (info.ok) { persist.server = true; persist.serverFile = (await info.json()).arquivo; }
    const r = await fetch('/api/estado', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.projects ? j : null;
  } catch { persist.server = false; return null; }
}

export async function load() {
  let local = null, remote = null;
  try { local = await idbGet(); persist.idb = true; } catch (e) { persist.error = String(e.message || e); }
  if (!local) { try { const ls = localStorage.getItem('aero-multielemento'); if (ls) local = JSON.parse(ls); } catch { /* sem localStorage */ } }
  remote = await serverGet();
  const pick = [local, remote].filter(Boolean).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))[0];
  state = migrate(pick || emptyState());
  persist.lastSaved = state.savedAt;
  return state;
}

async function saveNow() {
  persist.saving = true; emit('save');
  state.savedAt = nowISO();
  const json = JSON.stringify(state);
  try { await idbPut(JSON.parse(json)); persist.idb = true; persist.error = null; }
  catch (e) { try { localStorage.setItem('aero-multielemento', json); } catch (e2) { persist.error = `Falha ao salvar localmente: ${e2.message}`; } }
  if (persist.server) {
    try { const r = await fetch('/api/estado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json }); if (!r.ok) throw new Error(r.status); }
    catch (e) { persist.server = false; persist.error = 'Servidor local indisponível — salvo só no navegador.'; }
  }
  persist.lastSaved = state.savedAt; persist.saving = false;
  emit('save');
}

export function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
export const flush = () => { clearTimeout(saveTimer); return saveNow(); };

export const getState = () => state;
export function replaceState(s) { state = migrate(s); scheduleSave(); emit('all'); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { listeners.forEach((fn) => fn(kind)); }

// --- seleção ativa ---
export function activeProject() { return state.projects.find((p) => p.id === state.ui.active.projectId) || state.projects[0] || null; }
export function activePackage() { const p = activeProject(); if (!p) return null; return p.packages.find((k) => k.id === state.ui.active.packageId) || p.packages[0] || null; }
export function activeRun() { const k = activePackage(); if (!k) return null; return k.runs.find((r) => r.id === state.ui.active.runId) || k.runs[0] || null; }
export function setActive(patch) {
  const a = state.ui.active;
  Object.assign(a, patch);
  if (patch.projectId) { const p = activeProject(); a.packageId = p?.packages[0]?.id; a.runId = p?.packages[0]?.runs[0]?.id; }
  if (patch.packageId && !patch.runId) { a.runId = activePackage()?.runs[0]?.id; }
  scheduleSave(); emit('all');
}

/**
 * Altera o estado. fn(state, ctx) recebe {project, pkg, run}. log = [entidade, nome, ação, detalhe].
 * opts.silent: não re-renderiza (usado em edições "ao vivo").
 */
export function update(fn, log = null, opts = {}) {
  const ctx = { project: activeProject(), pkg: activePackage(), run: activeRun() };
  fn(state, ctx);
  const now = nowISO();
  if (ctx.pkg) ctx.pkg.updatedAt = now;
  if (ctx.run && opts.touchRun !== false) ctx.run.updatedAt = now;
  if (log && ctx.project) logHistory(ctx.project, ...log);
  scheduleSave();
  if (!opts.silent) emit('all');
}
