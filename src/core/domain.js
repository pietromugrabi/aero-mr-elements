// Domínio computacional 2D (retângulo) medido a partir dos extremos da montagem.
// C_soma = Σ chord_n. Distâncias padrão: montante 6·C, jusante 10·C, acima 5·C, abaixo 5·C.

export const DEFAULT_DOMAIN = Object.freeze({
  upstream: 6, downstream: 10, above: 5, below: 5,
  groundEnabled: true, groundClearance: null, groundMoving: true,
  chordBasis: 'soma', // 'soma' (Σ cordas) | 'principal' (corda do elemento 1)
});

const REC = { upstream: 6, downstream: 10, above: 5, below: 5 };

/**
 * @param bb bbox da montagem no plano do CAD {xmin,xmax,ymin,ymax} (mm)
 * @param chords lista de cordas (mm)
 * @param sx sinal do escoamento no eixo horizontal (−1 = escoamento em −X)
 */
export function computeDomain(bb, chords, settings = DEFAULT_DOMAIN, sx = -1) {
  const s = { ...DEFAULT_DOMAIN, ...settings };
  const C = s.chordBasis === 'principal' ? chords[0] : chords.reduce((a, b) => a + b, 0);
  const warnings = [], recs = [], errors = [];
  let inletX, outletX;
  if (sx < 0) { inletX = bb.xmax + s.upstream * C; outletX = bb.xmin - s.downstream * C; }
  else { inletX = bb.xmin - s.upstream * C; outletX = bb.xmax + s.downstream * C; }
  const topY = bb.ymax + s.above * C;
  const h = Number(s.groundClearance);
  const bottomY = s.groundEnabled ? bb.ymin - h : bb.ymin - s.below * C;

  if (s.upstream < REC.upstream) recs.push(`Recomenda-se ≥ ${REC.upstream}·C a montante (atual ${s.upstream}·C) para que a entrada não sinta o campo de pressão dos perfis.`);
  if (s.downstream < REC.downstream) recs.push(`Recomenda-se ≥ ${REC.downstream}·C a jusante (atual ${s.downstream}·C) para que a esteira se desenvolva antes da saída de pressão.`);
  if (s.above < REC.above) recs.push(`Recomenda-se ≥ ${REC.above}·C acima da montagem (atual ${s.above}·C).`);
  if (!s.groundEnabled && s.below < REC.below) recs.push(`Recomenda-se ≥ ${REC.below}·C abaixo da montagem (atual ${s.below}·C).`);
  if (s.groundEnabled) {
    if (!(h > 0)) errors.push('Informe a folga ao solo h > 0 (distância do ponto mais baixo da montagem ao solo). Sem ela o domínio não é definido.');
    else {
      const hc = h / chords[0];
      if (hc < 0.05) warnings.push(`Folga ao solo muito pequena (h/c₁ = ${hc.toFixed(3)}): recomenda-se verificar o refinamento de malha entre asa e solo.`);
      if (hc > 2) recs.push(`Folga ao solo grande (h/c₁ = ${hc.toFixed(2)}): o efeito solo é pequeno; considere se o solo é necessário.`);
    }
    if (s.groundMoving) recs.push('Recomenda-se solo como parede móvel (moving wall) com velocidade igual a Uinf no sentido do escoamento, para não criar camada-limite artificial no solo.');
    else recs.push('Solo como parede estacionária gera camada-limite que não existe na pista; considere parede móvel com Uinf.');
  }
  const rect = { xmin: Math.min(inletX, outletX), xmax: Math.max(inletX, outletX), ymin: bottomY, ymax: topY };
  return {
    C, rect, inletX, outletX, topY, bottomY,
    dist: {
      upstream: s.upstream * C, downstream: s.downstream * C, above: s.above * C,
      below: s.groundEnabled ? h : s.below * C,
    },
    length: rect.xmax - rect.xmin, height: rect.ymax - rect.ymin,
    assembly: bb, warnings, recommendations: recs, errors, settings: s,
  };
}
