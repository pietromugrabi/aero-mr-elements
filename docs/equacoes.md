# Convenções e equações

Todas as convenções abaixo são configuráveis em **Geometria → Convenções e equações**. Os padrões
reproduzem o modelo SolidWorks de referência (cotas `DS_`), ver [validacao.md](validacao.md).

## 1. Referenciais

- **Referencial do perfil** (interno): BA em (0, 0), BF em (c, 0), escoamento em +x, extradorso
  (sucção) em +y. Toda a montagem é feita nele, em mm.
- **CAD**: `X = sx·x`, `Y = sy·y`, padrão `sx = sy = −1` (plano XY). Assim o escoamento fica em −X e
  a sustentação positiva em −Y (asa invertida → downforce). Planos XZ e YZ apenas trocam os eixos 3D.
- Para um ponto do `.dat` (já normalizado): `X = sx·x_dat·c`, `Y = sy·y_dat·c`.

## 2. Importação e normalização do .dat

1. Leitura: a 1ª linha de texto é o nome; linhas com texto, um só número ou valores inválidos são
   ignoradas com aviso; 3+ colunas usam as duas primeiras. Formato Lednicer (contagens na 1ª linha
   numérica) é convertido para Selig.
2. Duplicados consecutivos são removidos; 1º = último indica BF fechado; duplicados não
   consecutivos geram aviso. A ordem é forçada para anti-horária (BF → extradorso → BA → intradorso).
3. **BA**: ponto da curva (spline Catmull-Rom centrípeta pelos pontos originais) mais distante do BF;
   se não coincide com um vértice, é inserido. **BF**: ponto médio entre o 1º e o último ponto (ou o
   próprio ponto, se fechado).
4. **Normalização**: translada o BA para a origem, gira para a corda BA–BF ficar em +x (opcional) e
   divide pela corda medida. Como a escala usa sempre a corda medida, um arquivo em mm nunca é
   escalado duas vezes; o modo "normalizado/físico" serve para conferência (há aviso se o arquivo não
   corresponder ao modo escolhido) e para mostrar a corda do arquivo.

## 3. Arredondamento do bordo de fuga

Círculo de raio `r` (em % da corda ou mm; mm é convertido por `chord_ref` e depois escala com a corda,
como a spline proporcional do SolidWorks) tangente ao extradorso e ao intradorso:

1. Os trechos da cauda (x/c ≥ 1 − 15·r) são refinados com pontos **sobre a spline** dos pontos
   originais.
2. As duas superfícies são deslocadas para dentro por `r`; a interseção das curvas deslocadas mais
   próxima do BF é o centro `C`.
3. As tangências `Tu`, `Tl` são os pés das perpendiculares de `C` às superfícies.
4. Os pontos a jusante das tangências são substituídos pelo arco; todos os outros pontos ficam
   idênticos. O contorno original é guardado (reverter = desmarcar).
5. Validações: existência do círculo (BF aberto com `r` < metade da espessura → inválido), resíduo da
   tangência, região alterada (aviso se começa antes de 90 % da corda), raio > 2 % c, auto-interseção.

**Corda geométrica** (padrão, = `DS_chordN`): do BA ao ponto do arco mais distante do BA,
`P_ext = C + r·(C − BA)/|C − BA|`. O perfil é re-normalizado para essa corda (o ângulo de ataque é
medido em relação a ela). Ex.: S1223 com r = 0,2 % → corda = 0,9838 da original, girada ≈ 0,77°.

## 4. Gurney flap (por elemento)

Parâmetros: `h` (altura, mm; também mostrada em % da corda), `t` (espessura ao longo da corda),
`pos` (distância da face de jusante ao BF, ao longo da corda), lado (pressão = −y, padrão; sucção = +y)
e referência da altura (linha da corda/BF, padrão = `DS_gurney_h`; ou superfície local na face de jusante).

- `pos = 0` (padrão): face de jusante no BF, de comprimento `h`; topo paralelo à corda com `t`; face de
  montante normal à corda até a superfície, que é aparada (Gurney e perfil = um único contorno).
- `pos > 0`: aba retangular sobre a superfície entre `x = c − pos − t` e `x = c − pos`.
- Altura efetiva = quanto a face de montante sobressai da superfície. Inválido se ≤ 0 em qualquer face.
- DOE: `gurney_on_n` (0/1) liga/desliga por DP; `gurney_h_n`, `gurney_t_n`, `gurney_pos_n` variam a
  geometria. `gurney_on_n` não é cota DS_ (use configurações/peças separadas no SolidWorks).

## 5. Pivôs

Posição local (mm): `P_local = (c − s, ±pivot_off)`, `+` = sucção (padrão), com
- `s = √(pivot_dTE² − pivot_off²)` — `pivot_dTE` é a distância pivô–BF (padrão, = `DS_pivotN_dTE`);
- ou `s = pivot_dTE` — medida ao longo da corda.

Escalonamento nos Design Points (referências inalteradas; exige `chord_ref_n > 0`):

```
pivot_off_n = pivot_off_ref_n / chord_ref_n · chord_n
pivot_dTE_n = pivot_dTE_ref_n / chord_ref_n · chord_n
```

## 6. Montagem

Rotação de cada elemento (AoA absoluto, em relação ao escoamento; σ = sinal configurável, padrão +1
= nariz para cima no referencial do perfil = mais sustentação no sentido configurado = "BF para cima"
na asa invertida, como `DS_AoAN`):

```
θ_n = −σ·AoA_n
p' = T_n + R(θ_n)·(p − P_local,n),   R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]
```

**Modo sequencial (padrão, = SolidWorks):**
- Elemento 1: `T_1 = 0` (pivô 1 na origem) ou `T_1 = R(θ_1)·P_local,1` (BA 1 na origem).
- Elemento n ≥ 2: escolhe-se `T_n` para que `BA_n = BF_(n−1) + Δ_n`, com
  `Δ_n = (−Overlap_n, −Gap_n)` nos eixos do escoamento (padrão) ou `R(θ_(n−1))·(−Overlap_n, −Gap_n)`
  nos eixos da corda do elemento n−1.
  Overlap > 0: BA_n a montante do BF_(n−1). Gap > 0: BA_n do lado de pressão do BF_(n−1)
  (acima, no CAD, para a asa invertida).
- Nesse modo o pivô dos elementos n ≥ 2 é só um ponto de referência (como no modelo SolidWorks).

**Slat** (tipo *slat*, referência padrão = principal): `BF_slat = BA_ref + Δ`, com `Δ = (+Overlap, +Gap)`
nos eixos do escoamento (ou girado por `θ_ref`). Overlap > 0: BF do slat a jusante do BA do ref; Gap > 0:
lado de sucção (no CAD padrão, abaixo do BA do principal na asa invertida). Medido e verificado da mesma
forma que os flaps (folga real, interseção). AoA do slat negativo gera **aviso** (cota angular do
SolidWorks sem sinal), não erro. Nomes DS_: `DS_gap{a}{b}` com o par de montante para jusante
(flap n com ref r → `DS_gap{r}{n}`; slat n com ref r → `DS_gap{n}{r}`).

**Upperflap** (tipo *upperflap*, referência padrão = principal), acima do ref (Gap > 0 = lado de pressão):
- pelo BF: `BA_up = BF_ref + (−Overlap, −Gap)`;
- pelo BA: `BA_up = BA_ref + (+Stagger, −Gap)`, com Stagger guardado em `Overlap_n` (> 0 = a jusante).
Nos eixos da corda do ref o vetor é girado por `θ_ref`; o gap como folga mínima também vale. Nomes DS_:
`DS_gap{ref}{n}` e `DS_overlap{ref}{n}` (ou `DS_stagger{ref}{n}` pelo BA).

**Flaps com outra referência:** cada elemento não principal tem um elemento de referência (padrão: o anterior
para flaps); a ordem de montagem é resolvida pelas dependências, e referências circulares são apontadas.

**Gap como folga mínima (opcional):** mantém o overlap e desloca BA_n na direção normal até que
`min dist(contorno_(n−1), contorno_n) = Gap_n` (varredura + bissecção).

**Modo pivô fixo:** monta com todos os AoA = 0 (cordas paralelas ao escoamento) e depois gira cada
elemento em torno do próprio pivô.

**Medições exibidas:** gap/overlap efetivos nos dois eixos, folga real da fenda (distância mínima
entre contornos, linha vermelha na vista), deflexão relativa `AoA_n − AoA_(n−1)`, pivô dentro/fora
e distância à superfície.

**Verificações:** interseção entre quaisquer elementos (o SolidWorks e o DM não detectam), folga da
fenda abaixo do mínimo configurado, pivô fora do perfil, auto-interseção, Gurney inválido e regras
de cotas do SolidWorks (gap/overlap/pivot_off ≤ 0, AoA < 0, `pivot_dTE ≤ pivot_off`).

## 7. Domínio

`C = Σ chord_n` (ou corda 1). A partir dos extremos da montagem (bounding box no CAD):
inlet a `6·C` a montante, outlet a `10·C` a jusante, topo a `5·C`, fundo a `5·C` ou solo a `h`
abaixo do ponto mais baixo. Valores menores geram **recomendações**, nunca bloqueio.

## 8. Malha (sugestões heurísticas)

Placa plana turbulenta com L = corda do elemento:

```
Re = ρ·U·L/μ        Cf = (2·log10 Re − 0,65)^(−2,3)        τw = ½·ρ·U²·Cf
uτ = √(τw/ρ)        y₁ = y⁺·μ/(ρ·uτ)                        δ ≈ 0,37·L·Re^(−0,2)
N camadas: menor N com y₁·(gᴺ − 1)/(g − 1) ≥ δ  (limitado a 10…40)
```

Tamanhos: edge 0,5 % c, BA 0,1 % c, BF π·r/12, fenda = folga/15, Gurney = min(t/4, h/10),
esteira 1 % C, global C/2. São pontos de partida, não substituem estudo de independência de malha.

## 9. Fluent: referência, relatórios e coeficientes

- `A_ref = Σ chord_n [m] × profundidade` (2D: Depth, padrão 1 m; 3D: envergadura informada) ou valor
  fixo. Por DP, usa as cordas do DP. Opcional: `A_ref,n = chord_n × profundidade` nos coeficientes
  por elemento.
- Vetores: sustentação = direção de sustentação do CAD (padrão (0, −1, 0) → positivo = downforce);
  arrasto = direção do escoamento (padrão (−1, 0, 0)).
- Relatórios: `lift_force`/`drag_force` em todas as `wall_element_n`; `lift_el{n}`/`drag_el{n}` em uma
  parede cada. A checagem acusa superfície repetida, parede em dois relatórios por elemento, total
  sem alguma parede, solo incluído e superfície inexistente.

Coeficientes (calculados, nunca gravados — os dados brutos ficam separados):

```
q = ½·ρ·U²     CL = L/(q·A_ref)     CD = D/(q·A_ref)     CL/CD só se CD ≠ 0
CL_n = L_n/(q·A_ref,n)      participação_n = L_n / L_total
```

Totais vêm do relatório total. Se ausente, o usuário pode optar por `Σ elementos` (rotulado). Nunca
há média. Se total e Σ elementos diferem mais de 1 %, há aviso (superfície faltando ou dupla).

## 10. DOE

- Níveis: `3; 5; 7`, `3 5 7`, `3, 5, 7`, `2,5; 3,5` (vírgula decimal) ou `início:passo:fim`.
- Fatorial completo: produto dos níveis. Um fator por vez: ponto base + cada variável sozinha
  (sem repetir o ponto base). Manual: linhas editadas/coladas.
- Contagem antes de gerar; aviso > 100, confirmação > 1000, bloqueio > 20000.
- Duplicatas: entradas iguais (10 algarismos significativos) são destacadas.
- Nomes `DS_`: `chord_n → DS_chordn`, `AoA_n → DS_AoAn`, `Gap_n → DS_gap(n−1)n`,
  `Overlap_n → DS_overlap(n−1)n`, `pivot_off_n → DS_pivotn_off`, `pivot_dTE_n → DS_pivotn_dTE`,
  `gurney_h/t → DS_gurney_h/t` (um Gurney) ou `DS_gurneyn_h/t`.

## 11. Importação de saídas

Cabeçalhos aceitos: `P4 - lift_force [N]`, `P1 - P3@DS_chord1@Ref@Peca.Part`, `lift_el1`, `lift_eln`
com n, `lift_element_1`, etc. Separador `,`, `;` ou tab; com `;` aceita vírgula decimal; linhas `#`
são comentários. Unidades: N, kN, lbf, mN; m/s, km/h, mph; mm, m, cm, in. Associação por nome do DP
(`DP 3`, `3`) ou pela ordem das linhas. Relatório: DPs associados, linhas sem DP, DPs repetidos
(mantém a 1ª), colunas desconhecidas, campos esperados ausentes, conversões, células vazias e
divergências entre as entradas do arquivo e as do DP.
