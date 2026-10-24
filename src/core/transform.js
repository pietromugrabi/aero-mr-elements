// Transformação do referencial do perfil (x: escoamento, y: sustentação positiva/sucção)
// para o referencial do CAD.
//
// Padrão (convenção do estudo de referência): X = −x·c, Y = −y·c, plano XY.
//   ⇒ escoamento no sentido −X, sustentação no sentido −Y (asa invertida = downforce).
// As inversões de sinal são configuráveis; o escalonamento pela corda é feito uma única vez.

export const DEFAULT_TRANSFORM = Object.freeze({ sx: -1, sy: -1, plane: 'XY' });

const AXES = { XY: ['X', 'Y', 'Z'], XZ: ['X', 'Z', 'Y'], YZ: ['Y', 'Z', 'X'] };

/** Nomes dos eixos (horizontal, vertical, normal ao plano) para o plano escolhido. */
export function planeAxes(plane = 'XY') { return AXES[plane] || AXES.XY; }

/** Referencial do perfil (já em mm) → coordenadas 2D do plano do CAD. */
export function toPlane(p, t = DEFAULT_TRANSFORM) { return [t.sx * p[0], t.sy * p[1]]; }

/** Coordenadas 2D do plano → do perfil. */
export function fromPlane(p, t = DEFAULT_TRANSFORM) { return [t.sx * p[0], t.sy * p[1]]; }

/** Coordenadas 2D do plano → 3D (X, Y, Z) do CAD. */
export function to3D(p2, plane = 'XY', offset = 0) {
  switch (plane) {
    case 'XZ': return [p2[0], offset, p2[1]];
    case 'YZ': return [offset, p2[0], p2[1]];
    default: return [p2[0], p2[1], offset];
  }
}

/** Transformação direta de um ponto .dat (normalizado) com a corda: X = sx·Xdat·c, Y = sy·Ydat·c. */
export function datToCAD(p, chord, t = DEFAULT_TRANSFORM) {
  return to3D([t.sx * p[0] * chord, t.sy * p[1] * chord], t.plane);
}

/** Direções (vetores 3D unitários) do escoamento e da sustentação no CAD. */
export function directions(t = DEFAULT_TRANSFORM) {
  const flow = to3D([t.sx, 0], t.plane);
  const lift = to3D([0, t.sy], t.plane);
  return { flow, lift, flowLabel: vecLabel(flow), liftLabel: vecLabel(lift) };
}

export function vecLabel(v) {
  const names = ['X', 'Y', 'Z'];
  const i = v.findIndex((c) => c !== 0);
  if (i < 0) return '0';
  return (v[i] > 0 ? '+' : '−') + names[i];
}

/** Descrição textual das equações de transformação ativas. */
export function describeTransform(t = DEFAULT_TRANSFORM) {
  const [h, v] = planeAxes(t.plane);
  const s = (k) => (k < 0 ? '−' : '+');
  return `${h} = ${s(t.sx)}x_dat·c ;  ${v} = ${s(t.sy)}y_dat·c  (plano ${t.plane})`;
}
