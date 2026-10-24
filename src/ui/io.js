// Exportação/importação JSON de projetos e backup completo.
import { download, pickFile, toast, safeName, confirmBox } from './dom.js';
import * as store from './store.js';
import { sanitizeProject, migrate, uid, SCHEMA_VERSION, logHistory } from '../core/model.js';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function exportProjectJSON(prj) {
  const data = { tipo: 'aero-multielemento/projeto', versao: SCHEMA_VERSION, exportadoEm: new Date().toISOString(), projeto: prj };
  download(`${safeName(prj.name)}_${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

export async function importProjectJSON() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let j;
  try { j = JSON.parse(f.text); } catch (e) { toast(`JSON inválido: ${e.message}`, true); return; }
  const raw = j.projeto || (j.packages ? j : null);
  if (!raw) { toast('Arquivo não contém um projeto do AERO MULT-MR ELEMENTS.', true); return; }
  const prj = sanitizeProject(raw);
  const s = store.getState();
  if (s.projects.some((p) => p.id === prj.id)) {
    const keep = await confirmBox('Projeto já existe', `Já existe um projeto com o mesmo identificador ("${prj.name}"). Importar como cópia?`, 'Importar como cópia');
    if (!keep) return;
    prj.id = uid('prj'); prj.name += ' (importado)';
  }
  store.update((st) => { logHistory(prj, 'projeto', prj.name, 'importado', f.name); st.projects.push(prj); st.ui.active = { projectId: prj.id, packageId: prj.packages[0]?.id, runId: prj.packages[0]?.runs[0]?.id }; });
  toast(`Projeto "${prj.name}" importado.`);
}

export async function backupAll() {
  await store.flush();
  const data = { tipo: 'aero-multielemento/backup', versao: SCHEMA_VERSION, exportadoEm: new Date().toISOString(), estado: store.getState() };
  download(`aero-multielemento_backup_${stamp()}.json`, JSON.stringify(data), 'application/json');
}

export async function restoreAll() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let j;
  try { j = JSON.parse(f.text); } catch (e) { toast(`JSON inválido: ${e.message}`, true); return; }
  const st = j.estado || (j.projects ? j : null);
  if (!st) { toast('Arquivo não é um backup completo. Para um projeto, use "Importar projeto".', true); return; }
  const n = (st.projects || []).length;
  if (!(await confirmBox('Restaurar backup', `Isto substitui TODOS os dados atuais por ${n} projeto(s) do arquivo "${f.name}". Recomenda-se fazer um backup antes. Continuar?`, 'Substituir tudo', true))) return;
  store.replaceState(migrate(st));
  toast('Backup restaurado.');
}
