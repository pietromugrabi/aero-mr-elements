// Plano de malha (ANSYS Meshing). Este módulo NÃO gera malha: ele organiza valores e calcula
// sugestões heurísticas (rotuladas como tal) para o usuário aplicar no Meshing.

export const MESH_METHODS = [
  ['quadDominant', 'Quadrilateral Dominant (2D)'],
  ['triangles', 'Triângulos (All Triangles / Patch Conforming)'],
  ['multizone', 'MultiZone Quad/Tri'],
  ['tetra', 'Tetraedros Patch Conforming (3D)'],
  ['polyhexcore', 'Poly-Hexcore (Fluent Meshing, 3D)'],
];

export function defaultMeshPlan(n, { gurney = [], ground = true } = {}) {
  const walls = Array.from({ length: n }, (_, i) => `wall_element_${i + 1}`);
  return {
    method: 'quadDominant', growthRate: 1.1, globalMax: null, defeature: null, notes: '',
    edgeSizing: walls.map((w) => ({ target: w, type: 'divisoes', value: null, bias: null, enabled: true })),
    refinements: {
      le: { enabled: true, size: null, label: 'Bordo de ataque (vertex/edge sizing)' },
      te: { enabled: true, size: null, label: 'Bordo de fuga arredondado' },
      gap: { enabled: n > 1, size: null, label: 'Fendas (gap) entre elementos' },
      flap: { enabled: n > 1, size: null, label: 'Região dos flaps' },
      gurney: { enabled: gurney.some(Boolean), size: null, label: 'Gurney flap' },
      ground: { enabled: ground, size: null, label: 'Solo sob a asa' },
      wake: { enabled: true, size: null, length: 2, label: 'Esteira (body of influence)' },
    },
    inflation: walls.concat(ground ? ['ground'] : []).map((s) => ({ surface: s, enabled: s !== 'ground', layers: null, growth: 1.2, firstLayer: null })),
    yplusTarget: 1,
  };
}

/**
 * Altura da 1ª camada para um y+ alvo (estimativa de placa plana turbulenta, Schlichting):
 *   Re = ρ·U·L/μ ; Cf = (2·log10(Re) − 0,65)^(−2,3) ; τw = ½·ρ·U²·Cf ; uτ = √(τw/ρ) ; y = y+·μ/(ρ·uτ)
 * @returns valores em SI (y em m)
 */
export function firstLayerHeight({ rho, U, mu, L, yplus = 1 }) {
  const Re = (rho * U * L) / mu;
  const Cf = Math.pow(2 * Math.log10(Re) - 0.65, -2.3);
  const tau = 0.5 * rho * U * U * Cf;
  const utau = Math.sqrt(tau / rho);
  const y = (yplus * mu) / (rho * utau);
  const delta = 0.37 * L * Math.pow(Re, -0.2); // espessura da CL turbulenta no fim da placa
  return { Re, Cf, tau, utau, y, delta };
}

/** Nº de camadas para cobrir a espessura alvo com razão de crescimento g. */
export function layersToCover(y1, g, target) {
  if (!(y1 > 0) || !(target > 0)) return null;
  if (g === 1) return Math.ceil(target / y1);
  return Math.max(1, Math.ceil(Math.log(1 + (target * (g - 1)) / y1) / Math.log(g)));
}

export function inflationThickness(y1, g, N) { return g === 1 ? y1 * N : (y1 * (Math.pow(g, N) - 1)) / (g - 1); }

/**
 * Sugestões heurísticas (mm). Não substituem estudo de independência de malha.
 * @param ctx { chords:[mm], teRadius:[mm|null], slotClearance:[mm], gurney:[{h,t}|null], rho, U, mu, yplus, C,
 *              ground:{ clearance mm, upstream mm, moving }|null }
 */
export function meshSuggestions(ctx) {
  const { chords, rho, U, mu, yplus = 1 } = ctx;
  const C = ctx.C || chords.reduce((a, b) => a + b, 0);
  const perElement = chords.map((c, i) => {
    const fl = firstLayerHeight({ rho, U, mu, L: c / 1000, yplus });
    const y1mm = fl.y * 1000;
    const growth = 1.2;
    const layers = Math.min(40, Math.max(10, layersToCover(y1mm, growth, fl.delta * 1000)));
    const r = ctx.teRadius?.[i];
    return {
      surface: `wall_element_${i + 1}`, chord: c, Re: fl.Re, y1: y1mm, layers, growth,
      total: inflationThickness(y1mm, growth, layers), delta: fl.delta * 1000,
      edgeSize: c * 0.005, leSize: c * 0.001, teSize: r ? (Math.PI * r) / 12 : c * 0.0005,
      divisions: Math.round((2 * c) / (c * 0.005)),
    };
  });
  const slots = (ctx.slotClearance || []).map((d) => (d > 0 ? d / 15 : null));
  // Solo: placa plana com o comprimento percorrido da entrada até o BF da asa (montante + C).
  // Solo móvel (velocidade = Uinf) quase não forma CL; as camadas resolvem só o cisalhamento
  // induzido pela asa, então a 1ª camada é a mesma do elemento principal (y+ conservador).
  // Em ambos os casos a espessura total fica ≤ 1/4 da folga ao solo, para não encostar na malha da asa.
  let ground = null;
  if (ctx.ground) {
    const g = ctx.ground, growth = 1.2;
    const fl = firstLayerHeight({ rho, U, mu, L: ((g.upstream || 0) + C) / 1000, yplus });
    const y1 = g.moving ? perElement[0].y1 : fl.y * 1000;
    const cap = g.clearance > 0 ? g.clearance / 4 : Infinity;
    const target = Math.min(g.moving ? perElement[0].delta : fl.delta * 1000, cap);
    const layers = Math.min(30, Math.max(5, layersToCover(y1, growth, target)));
    let n = layers;
    while (n > 1 && inflationThickness(y1, growth, n) > cap) n--;
    ground = { surface: 'ground', y1, layers: n, growth, total: inflationThickness(y1, growth, n), Re: fl.Re, delta: fl.delta * 1000, cap, moving: !!g.moving };
  }
  const gur = (ctx.gurney || []).map((g) => (g ? Math.min(g.t / 4, g.h / 10) : null));
  return {
    perElement, ground, slotSize: slots, gurneySize: gur,
    globalMax: C / 20, wakeSize: C * 0.01, wakeLength: 2, groundSize: C * 0.02, flapSize: Math.min(...chords) * 0.004,
    note: 'Sugestões heurísticas (placa plana para y+, frações da corda para tamanhos). Confirme com estudo de independência de malha e verifique y+ no Fluent após a solução.',
  };
}
