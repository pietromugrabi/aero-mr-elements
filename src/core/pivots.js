// Pivôs: escalonamento com a corda e posição no referencial local do elemento.
//
// Escalonamento (DOE):  pivot_off_n = pivot_off_ref_n / chord_ref_n · chord_n
//                       pivot_dTE_n = pivot_dTE_ref_n / chord_ref_n · chord_n
// Os valores de referência nunca são alterados.

/**
 * @returns {{off:number, dTE:number}} pivô escalado para a corda informada
 * @throws Error se chord_ref ≤ 0 ou valores inválidos
 */
export function scalePivot({ chord_ref, pivot_off_ref, pivot_dTE_ref }, chord) {
  const cr = Number(chord_ref), c = Number(chord);
  if (!(cr > 0) || !Number.isFinite(cr)) throw new Error('chord_ref deve ser maior que zero para escalar o pivô.');
  if (!(c > 0) || !Number.isFinite(c)) throw new Error('chord deve ser maior que zero.');
  const k = c / cr;
  return { off: Number(pivot_off_ref) * k, dTE: Number(pivot_dTE_ref) * k };
}

/**
 * Posição do pivô no referencial local (mm): BA em (0,0), BF em (c,0), sucção em +y.
 * conv.pivotDTE: 'euclidiana' (DS_pivotN_dTE = distância pivô–BF, como no SolidWorks) |
 *                'corda' (distância medida ao longo da corda a partir do BF)
 * conv.pivotSide: 'succao' (+y, padrão DS) | 'pressao' (−y)
 */
export function pivotLocal(chord, off, dTE, conv = {}) {
  const side = conv.pivotSide === 'pressao' ? -1 : 1;
  let s;
  if (conv.pivotDTE === 'corda') s = dTE;
  else {
    if (!(dTE > Math.abs(off))) return { ok: false, p: null, error: 'pivot_dTE precisa ser maior que pivot_off (distância euclidiana pivô–BF).' };
    s = Math.sqrt(dTE * dTE - off * off);
  }
  return { ok: true, p: [chord - s, side * off], alongFromTE: s, fractionFromLE: (chord - s) / chord };
}
