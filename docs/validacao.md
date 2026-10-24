# Validação

## Testes automatizados

55 testes (`tests/geometry.test.js`, `tests/data.test.js`, `tests/slat-gurney.test.js`), todos aprovados
em 24/10/2026 no navegador (`tests/index.html` → `OK 55/55`). Não há Node.js nesta máquina; `tests/run-node.mjs` usa
os mesmos arquivos e roda com `node tests/run-node.mjs` onde houver Node ≥ 18.

## Comparação com o modelo SolidWorks de referência

Referência: peças `Asa3E_S1223*.SLDPRT` / `Asa3E_NACA23012*.SLDPRT` (mesma lógica do
`Elementos-E423_v2.SLDPRT`), com as cotas DS_ padrão 140/90/60 mm, 3/18/33°, gap 7/4,5,
overlap 3,5/2,5, pivôs 7/122, 5/77, 3/51 mm, BF r = 0,2 % c. Valores do SolidWorks lidos dos
relatórios de construção/verificação daquelas peças.

| Grandeza | SolidWorks | AERO MULT-MR ELEMENTS | Tolerância do teste |
|---|---|---|---|
| BA / BF / pivô dos 3 elementos (9 pontos, mm) | log de construção | idênticos | 0,001 mm |
| Área do elemento 1 (S1223, c = 140) | 1321,243 mm² | dentro de 1 % | 1 % |
| Folga real das fendas S1223 | 3,2 / 2,9 mm | 3,15 / 2,84 mm | 0,1 mm |
| Folga real das fendas NACA 23012 | 4,2 / 3,4 mm | 4,22 / 3,39 mm | (informativo) |
| Distância pivô–superfície S1223 | 7,4 / 4,8 / 3,4 mm | 7,43 / 4,82 / 3,31 mm | 0,1 mm |
| Distância pivô–superfície NACA | 2,7 / 1,4 / 1,3 mm | 2,72 / 1,41 / 1,30 mm | (informativo) |
| Centro do círculo do BF S1223 (x/c, y/c) | 0,981345; 0,013520 | 0,98173; 0,01324 | 6·10⁻⁴ |
| Corda geométrica S1223 / rotação | 0,983455 / 0,789° | 0,98381 / 0,773° | 1,5·10⁻³ / 0,06° |
| Altura efetiva do Gurney (el. 3, h = 2, t = 0,6) S1223 / NACA | 2,11 / 1,82 mm | dentro de 0,03 mm | 0,03 mm |
| Interseção com gap12 = 2 mm (mínimo ≈ 3,51 mm) | interseção | detectada | — |

As posições de BA, BF e pivô dependem só das cotas e das convenções, por isso coincidem. As pequenas
diferenças de forma (≤ 0,1 mm) vêm da curva usada entre os pontos do `.dat`: o SolidWorks usa uma
B-spline cúbica pelos pontos; o app usa a polilinha dos pontos, com refinamento Catmull-Rom só perto
do BA e do BF.

## Fluxo completo executado (3 elementos, a partir do zero)

No navegador, pela própria interface (eventos reais dos botões e campos):

1. Novo projeto e pacote em branco com 3 elementos.
2. Upload de `S1223.dat` (elementos 1 e 2) e `NACA23012.dat` (elemento 3) pelo botão
   *Carregar .dat…*; preenchimento das 16 cotas de referência. Resultado: 80/80/61 pontos,
   "geometria OK", sem interseções; folgas 3,147 e 3,622 mm.
3. Domínio: erro até informar a folga ao solo; com h = 60 mm → 4909,7 × 1606,0 mm.
4. Fluent: erro até informar Uinf; com 33,3 m/s → A_ref = 0,29 m², q = 679,195 Pa.
5. DOE fatorial AoA_2 × AoA_3 (3 × 3) → 9 DPs, todos com geometria verificada sem erro;
   exportação CSV (nomes DS_) e XLSX.
6. Importação de um CSV no formato do Workbench (valores SINTÉTICOS marcados como exemplo) com uma
   linha repetida, um DP inexistente e uma coluna desconhecida: 9 DPs associados e os três
   problemas apontados no relatório.
7. Coeficientes conferidos à mão: CL(DP 0) = 418,8469 / (679,195 × 0,29) = 2,1265.
8. Gráficos: Lift/Drag × AoA_2 agrupado por AoA_3, mapa de calor, superfície de resposta
   (R² = 0,9999 sobre os dados sintéticos), exportação SVG, PNG e CSV.
9. Exportação "Baixar tudo (.zip)": 21 arquivos; todos os CRCs conferem e os XML internos do
   `.xlsx` são bem formados.
10. Persistência: `dados/estado.json` gravado pelo servidor; tela de 375 px sem rolagem horizontal
    em todas as seções; tema escuro.

## Relatório Excel (verificado no Excel)

Três relatórios do projeto de demonstração (rodada AoA_2 × AoA_3, rodada com × sem Gurney e rodada do
slat sem resultados) foram gerados pelo próprio código do app e abertos no **Excel 16** desta máquina por
automação COM: as 9 abas carregaram, os 7 gráficos nativos de cada relatório com resultados têm o número
correto de séries e pontos (ex.: 2 séries *sem/com Gurney* × 3 pontos), e os gráficos exportados como imagem
foram conferidos visualmente. A rodada sem resultados gera o relatório sem gráficos (nenhum dado inventado).

## Slat e Gurney

- Posição do slat conferida nos eixos do escoamento e da corda do ref, e como folga mínima; os demais
  elementos não se movem quando o slat é acrescentado; interseção slat × principal detectada.
- Gurney padrão (rente ao BF, lado de pressão) mantém a altura efetiva de referência (2,11 mm S1223);
  aba afastada do BF, lado de sucção e altura medida da superfície testados; `gurney_on_n` liga/desliga por DP.

## Limitações conhecidas

- O slat não tem modelo SolidWorks de referência: a convenção de posição é a do app (documentada) e não foi
  conferida contra um CAD. Os valores do slat no projeto de demonstração são ilustrativos.
- Gurney com `pos > 0` ou no lado de sucção não existe no modelo SolidWorks de referência (só o padrão,
  rente ao BF no lado de pressão, foi conferido).

- O formato de fechamento de curva do DesignModeler não foi testado no DM (o arquivo repete o
  1º ponto).
- As sugestões de malha são heurísticas de placa plana.
- O modo "gap como folga mínima" faz ~120 avaliações de distância por elemento; em DOEs grandes a
  verificação de geometria fica mais lenta.
