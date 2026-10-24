// Named Selections (DesignModeler / Meshing) e condições de contorno associadas.

export function defaultNamedSelections(n, { ground = true, gurney = [], dim = '2D', groundMoving = true, kinds = [] } = {}) {
  const ent = dim === '3D' ? 'Face' : 'Aresta';
  const list = [
    { name: 'inlet', type: ent, entities: 'Lado do domínio a montante', description: 'Entrada do escoamento', bc: 'velocity-inlet', notes: 'Velocidade = parâmetro Uinf' },
    { name: 'outlet', type: ent, entities: 'Lado do domínio a jusante', description: 'Saída', bc: 'pressure-outlet', notes: 'Pressão manométrica 0 Pa' },
    { name: 'symmetry_top', type: ent, entities: 'Lado superior do domínio', description: 'Fronteira superior', bc: 'symmetry', notes: '' },
    ground
      ? { name: 'ground', type: ent, entities: 'Lado inferior do domínio (solo)', description: 'Solo', bc: groundMoving ? 'wall (moving)' : 'wall', notes: groundMoving ? 'Parede móvel, velocidade = Uinf no sentido do escoamento' : 'Parede estacionária' }
      : { name: 'symmetry_bottom', type: ent, entities: 'Lado inferior do domínio', description: 'Fronteira inferior (sem solo)', bc: 'symmetry', notes: '' },
  ];
  for (let i = 1; i <= n; i++) {
    const g = gurney[i - 1], k = kinds[i - 1] || (i === 1 ? 'principal' : 'flap');
    list.push({
      name: `wall_element_${i}`, type: ent,
      entities: g ? `Arestas do elemento ${i} (${k}): perfil + as 3 arestas do Gurney` : `Arestas do elemento ${i} (${k}): extradorso + intradorso`,
      description: `Parede do elemento ${i} (${k})`, bc: 'wall', notes: 'No-slip, estacionária',
    });
  }
  return list;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** Validação: nomes, duplicatas, paredes obrigatórias e entidades repetidas (dupla contagem). */
export function validateNamedSelections(list, n, { ground = true } = {}) {
  const issues = [];
  const names = new Map();
  list.forEach((s, i) => {
    if (!s.name) { issues.push({ level: 'erro', msg: `Linha ${i + 1}: nome vazio.` }); return; }
    if (!NAME_RE.test(s.name)) issues.push({ level: 'aviso', msg: `"${s.name}": use só minúsculas, números, _ ou - (o Fluent converte para minúsculas e não aceita espaços).` });
    if (names.has(s.name)) issues.push({ level: 'erro', msg: `Nome "${s.name}" repetido.` });
    names.set(s.name, i);
  });
  for (let i = 1; i <= n; i++) if (!names.has(`wall_element_${i}`)) issues.push({ level: 'erro', msg: `Falta a Named Selection wall_element_${i} (necessária para os relatórios por elemento).` });
  ['inlet', 'outlet'].forEach((k) => { if (!names.has(k)) issues.push({ level: 'erro', msg: `Falta a Named Selection "${k}".` }); });
  if (ground && !names.has('ground')) issues.push({ level: 'aviso', msg: 'Solo habilitado no domínio, mas não há Named Selection "ground".' });
  const ents = new Map();
  list.forEach((s) => {
    const k = (s.entities || '').trim().toLowerCase();
    if (!k) return;
    if (ents.has(k)) issues.push({ level: 'erro', msg: `"${s.name}" e "${ents.get(k)}" referenciam as mesmas entidades: uma superfície em duas Named Selections causa dupla contagem nas forças.` });
    else ents.set(k, s.name);
  });
  return issues;
}
