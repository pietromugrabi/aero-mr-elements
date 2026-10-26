# AERO MULT-MR ELEMENTS

![Mauá Racing](src/ui/assets/maua-racing.png)

Ferramenta da **Mauá Racing** (aerodinâmica). Identidade visual preta, vermelha e branca; tema claro opcional na barra superior.

Aplicativo web local para **preparar, organizar e analisar** estudos CFD de perfis multielemento
(asas e flaps de Fórmula SAE, Gurney flaps) feitos com **SolidWorks + ANSYS Workbench / Fluent**.
Interface em português (Brasil), sem dependências externas e sem acesso à internet.

> O aplicativo **não** executa CAD, malha nem CFD e não se conecta ao ANSYS. Ele gera os números,
> tabelas, curvas e instruções; a execução continua no SolidWorks, DesignModeler, Meshing, Fluent e
> Workbench. Cada tela indica o que ainda precisa ser feito fora dele.

## Como rodar

O app usa módulos JavaScript, então precisa ser aberto por um servidor local (não funciona com
duplo clique no `index.html`).

**Windows, sem instalar nada** (usa o PowerShell do próprio Windows):

```bash
iniciar.bat
```

ou, num PowerShell nesta pasta:

```bash
powershell -ExecutionPolicy Bypass -File iniciar.ps1
```

Abre `http://localhost:8765/` no navegador. Outra porta: `iniciar.ps1 -Porta 8766`. Para encerrar,
feche a janela do PowerShell (ou Ctrl+C).

**Com Node.js ≥ 18** (opcional):

```bash
node server.mjs
```

**Com Python** (sem gravação em arquivo, só no navegador):

```bash
python -m http.server 8765
```

Navegadores testados: Chromium/Edge (o painel de navegador do Claude). Firefox e Chrome atuais
devem funcionar (só APIs padrão: IndexedDB, Blob, SVG, canvas).

## Onde os dados ficam

1. **No navegador (IndexedDB)**: banco `aero-multielemento`, da origem `http://localhost:8765`.
   Mudar a porta ou o navegador cria um armazenamento separado.
2. **Em arquivo** (quando aberto pelo `iniciar.ps1` ou `server.mjs`): `dados/estado.json`, com a
   versão anterior em `dados/estado.anterior.json`. A cada alteração os dois são atualizados; na
   abertura vale a cópia mais recente.
3. **Exportações manuais**: *Projetos → Exportar JSON* (um projeto, com os `.dat` originais, DPs,
   resultados brutos, gráficos salvos e histórico) e *Backup completo / Restaurar backup*.

A barra superior mostra o horário do último salvamento e onde ele foi gravado.

## Testes

Abra `http://localhost:8765/tests/index.html` com o servidor rodando (o título da aba mostra
`OK 55/55`). Com Node.js: `node tests/run-node.mjs` (ou `npm test`).

Os 55 testes cobrem: importação `.dat` (Selig/Lednicer, cabeçalhos, linhas inválidas/incompletas,
duplicados, ordem horária, vírgula decimal, entrada física), transformações de coordenadas,
arredondamento do bordo de fuga, fórmulas e posição dos pivôs, montagem (comparada com o modelo
SolidWorks de referência), Gurney, DOE (níveis, contagem, fatorial, OAT, duplicatas, pivôs
escalados), importação de saídas (cabeçalhos do Workbench, unidades, DPs repetidos/desconhecidos),
coeficientes, domínio, y+, Named Selections, dupla contagem de relatórios, superfície de resposta,
ZIP/XLSX, relatório Excel com gráficos, slat, Gurney parametrizado e migração de JSON. Ver [docs/validacao.md](docs/validacao.md).

## Fluxo de trabalho (exemplo com 3 elementos)

1. **Dashboard → Carregar projeto de exemplo** para conhecer o app: uma asa de 3 elementos S1223
   (pacote único, 3 rodadas de DOE). Os resultados do exemplo são **sintéticos** e aparecem marcados
   como *dados de exemplo* em todas as telas e exportações. Existe no máximo um projeto de exemplo;
   exemplos antigos ("DEMO — …", com vários pacotes) são reduzidos automaticamente a esse formato.
2. **Projetos → + Novo projeto → + Novo pacote** (em branco com N elementos, ou "Estudo de
   referência" com as cotas DS_ padrão).
3. **Geometria → Elementos e .dat**: carregue um `.dat` por elemento (há `samples/S1223.dat` e
   `samples/NACA23012.dat`), informe `chord_ref_n`, `AoA_ref_n`, `Gap_ref_n`, `Overlap_ref_n`,
   `pivot_off_ref_n`, `pivot_dTE_ref_n` e, se houver, o Gurney (h, t). **Gap_n e Overlap_n são
   entre o elemento n e o elemento n+1** (Gap_1 = entre os elementos 1 e 2, nome DS_ `DS_gap12`);
   o campo fica no cartão do elemento n+1, que é o que se move. Pares não consecutivos (slat,
   upperflap) usam os dois números: `Gap_41`, `Gap_14`. Em 3D informe a envergadura
   (o app nunca a estima).
4. **Geometria → Bordo de fuga**: raio em % da corda ou mm, com pré-visualização e validação. O
   contorno original fica guardado; desmarcar a opção reverte.
5. **Geometria → Montagem**: vista 2D interativa (zoom/arrasto), medições de gap/overlap nos dois
   eixos, folga real das fendas, pivôs, verificações e ajuste ao vivo. **Convenções e equações**
   mostra e permite mudar cada convenção.
6. **Domínio**: C_soma, múltiplos de C (6/10/5/5 por padrão), solo e folga ao solo.
7. **Mesh**, **Named Selections**, **Fluent Setup**: plano de malha com sugestões rotuladas, lista
   de Named Selections, CCs, valores de referência, relatórios de força e tabela de parâmetros.
8. **Inputs / Design Points**: níveis por variável (ex.: `AoA_2 = 14; 18; 22`, `AoA_3 = 28; 33; 38`),
   contagem antes de gerar, tabela editável, verificação geométrica de todos os DPs, exportação
   CSV/XLSX (com nomes do app ou `DS_`).
9. **Outputs**: importe o CSV exportado pelo Workbench (ou cole). Para testar sem ANSYS:
   `samples/EXEMPLO_SINTETICO_saidas_workbench.csv` corresponde ao passo 8 com o pacote "Estudo de
   referência" (marque *dados de exemplo* ao importar).
10. **Gráficos**, **Comparação**, **Exportação** (inclui *Baixar tudo (.zip)*).
11. **Relatório completo em Excel**: botão *Baixar relatório completo (Excel)* em **Outputs** (ou em **Exportação**, que também gera um .zip com o relatório de todas as rodadas). Ver abaixo.

## Slat e Gurney flap

- **Tipo de elemento** (Geometria → Elementos): *principal* (ancorado), *flap* (a jusante do elemento de referência) ou *slat* (a montante). *+ Adicionar slat* cria um elemento sem nenhum valor preenchido — o app não inventa valores para o slat. Convenção do slat: `BF_slat = BA_ref + (+Overlap, +Gap)`: Overlap > 0 = BF do slat a jusante do BA do ref; Gap > 0 = lado de sucção. Nomes DS_: `DS_gap{slat}{ref}`, ex.: `DS_gap41`.
- **Gurney flap** por elemento: ligado/desligado, altura `h` (mm e % da corda), espessura `t`, distância ao BF `pos` (0 = rente ao BF), lado (pressão/sucção) e referência da altura (linha da corda/BF, como `DS_gurney_h`, ou superfície local). Com h e t definidos, o DOE ganha `gurney_on_n` (0/1), `gurney_h_n`, `gurney_t_n` e `gurney_pos_n`, então *com × sem Gurney* cabe numa única rodada (gráficos agrupados por *gurney*). Ligar/desligar não é cota DS_: no SolidWorks use configurações/peças separadas.
- **Upperflap**: elemento acima do elemento de referência (padrão: o principal), criado com *+ Adicionar upperflap*. Cada upperflap escolhe o ponto de referência:
  - **pelo BF**: `BA_up = BF_ref + (−Overlap, −Gap)` (Overlap > 0 = BA a montante do BF do ref);
  - **pelo BA**: `BA_up = BA_ref + (+Stagger, −Gap)` (Stagger, guardado em Overlap_n, > 0 = a jusante do BA do ref).
  Gap > 0 = acima (lado de pressão na asa invertida). Nomes DS_: `DS_gap{ref}{n}`, `DS_overlap{ref}{n}` ou `DS_stagger{ref}{n}`.
- Para experimentar slat, upperflap e Gurney, use os botões *+ Adicionar slat*, *+ Adicionar upperflap* e *+ Definir Gurney flap* em Geometria (o exemplo padrão não traz nenhum deles).

## Gap/Overlap em fração da corda

Em Geometria, cada elemento escolhe **Gap / Overlap em**: mm ou **fração da corda (x/c)**. Em fração, informe por exemplo `Gap_ref_1 / chord_1 = 0,01` (1 % da corda) e escolha a corda base: a do elemento de referência (padrão), a do próprio elemento ou a do principal. O app converte para mm (`Gap_1 = Gap_1/c · chord_base`) na montagem, nas cotas DS_ e nas exportações. No DOE, a variável passa a ser `Gap_1/c` e o `Gap_1` em mm vira coluna derivada: se a corda variar, o gap acompanha.

## DPs inválidos

Em Inputs / Design Points, as combinações em que um flap tem **corda maior** (`chord_n > chord_(n−1)`) ou **AoA menor** (`AoA_n < AoA_(n−1)`) que o seu elemento de referência não são geradas; o app avisa quantas foram descartadas. Ao gerar, o app também monta cada combinação e descarta as com **erro de geometria** (elementos se atravessando, auto-interseção, cota inválida). As três regras podem ser desligadas na mesma tela. Slat e upperflap não entram nas regras de corda/AoA. Na tabela, **Remover DPs com erro** e **Remover DPs com aviso** (ex.: folga da fenda abaixo do mínimo) verificam todos os DPs e removem os do nível escolhido, com confirmação.

## Fórmulas

As equações (Geometria → Convenções e equações, Geometria → Configuração geral, Outputs e Fluent) são desenhadas com frações empilhadas, raízes, matrizes, índices e Σ (`src/ui/math.js`, sem biblioteca externa). O texto continua sendo o texto digitado: selecionar e dar Ctrl+C (ou o botão **Copiar** de cada bloco) copia exatamente o texto original, por exemplo `CL = L / (q·A_ref)`.

## Celular

Em pé: cabeçalho em duas linhas (marca e tema; projeto › pacote › rodada), uma coluna de campos, abas roláveis na horizontal e menu deslizante com fundo escurecido. Deitado: barra numa linha só que rola junto com a página, carimbo compacto e duas colunas. Em telas de toque os controles têm pelo menos 44 px e as margens respeitam o entalhe da tela.

## Gráficos (ECharts) e vista 3D (Three.js)

A aba **Gráficos** usa o Apache ECharts: roda do mouse dá zoom nos eixos, os ícones no canto fazem zoom por área, restauram a vista e salvam PNG. Se o ECharts não carregar, o app volta para os gráficos SVG próprios. Em Geometria → Montagem, **Abrir vista 3D** mostra os elementos montados extrudados (Three.js): pela envergadura em estudos 3D; em 2D, com uma profundidade só visual (1,5 × a maior corda). As bibliotecas ficam em `src/vendor/` (ver `LEIA-ME.txt` lá) e funcionam sem internet.

## Mapa de conflito

Geometria → aba **Mapa de conflito**. Escolha 2 variáveis (ex.: Gap_2 × Overlap_2 ou AoA_2 × Gap_2), as faixas e a resolução (15, 25 ou 40 pontos por eixo); as demais ficam no valor de referência. O app monta a asa em cada ponto e pinta: verde = OK, amarelo = aviso (folga da fenda abaixo do mínimo, pivô fora do perfil...), cinza = regra do DOE (corda/AoA), vermelho = erro (elementos se atravessando, auto-interseção, cota inválida). Mostra as faixas sem erro na linha e na coluna da referência; clicar numa célula mostra o motivo e permite gravar aqueles valores como referência. Uma grade 25 × 25 leva poucos segundos.

## Otimização alternada

Inputs / Design Points → Planejamento → método **Otimização alternada** (ao lado de Fatorial completo, Um fator por vez e Manual), no formato da planilha "Otimização Alternada". A rodada é feita em **etapas**:

1. **Etapa 1**: 1–2 variáveis com seus níveis (ex.: AoA_1 × AoA_2, 5 níveis cada) → fatorial (25 DPs). Rode no Fluent e importe os resultados: a etapa vira uma **tabela** como a da planilha (linhas = variável 1, colunas = variável 2), com o **máximo** em vermelho e os **vizinhos** em verde.
2. **+ Adicionar etapa**: entra outra variável (ex.: AoA_3, 5 níveis), cruzada só com as melhores combinações da etapa anterior: o **máximo e seus vizinhos** (um nível acima ou abaixo em cada variável; ex.: 9 combinações × 5 níveis = 45 DPs). A tabela da etapa tem linhas = combinações que vieram da etapa anterior e colunas = níveis da variável nova.
3. E assim por diante (Gap, Overlap...). Cada etapa só pode ser gerada depois que a anterior tem resultados; regerar uma etapa substitui os DPs dela e das seguintes.

- **Melhor resultado**: maior |lift| (Lift_force), maior |Cl| ou maior |Cl|/Cd (em módulo: a downforce sai negativa no Fluent). A tabela pode mostrar |lift|, Cl, Cd ou Cl/Cd.
- **Seguem para a próxima etapa**: o máximo + todos os vizinhos, ou só os vizinhos a até uma faixa % do máximo.
- As variáveis fora das etapas ficam no valor de referência. As regras de validade (corda/AoA) e a verificação de geometria valem em cada etapa.
- Avisos: máximo na borda dos níveis (o ótimo pode estar fora da faixa), DPs sem resultado ("–"), dados de exemplo. Na tabela de DPs, o selo E1, E2... indica a etapa.

## Sugestões de chord, AoA, Gap e Overlap

Geometria → aba **Sugestões**. Faixas editáveis por tipo (flap, slat, upperflap), relativas ao elemento de referência: `chord_n = razão · chord_ref`, `AoA_n = AoA_ref + ΔAoA`, `Gap/Overlap = fração · chord_ref`. Opcionalmente, informe a corda total disponível para dividi-la entre os elementos. Os padrões de flap e slat são faixas típicas de partida, não valores otimizados; o upperflap vem vazio. Botões: **Aplicar valores centrais na geometria** (os pivôs escalam com a corda) e **Níveis no DOE** (mín; centro; máx de AoA, Gap e Overlap na rodada ativa).

## Fonte dos títulos (Longhaul)

Os títulos usam a fonte **Longhaul**, de James Barnardo, pelo arquivo `src/ui/assets/fonts/Longhaul.ttf` (ou pela fonte instalada no computador). Sem ela, o site usa Bahnschrift (Windows). Os termos do autor estão em `src/ui/assets/fonts/YOU DECIDE PRICE OF LICENSE.txt`; o uso comercial exige licença paga ao autor.

## Relatório Excel de cada rodada

Um arquivo `.xlsx` por rodada (simulação/estudo), com as abas:

| Aba | Conteúdo |
|---|---|
| Resumo | identificação, valores de referência, elementos (tipo, cotas, BF, Gurney), convenções, domínio, melhores DPs e verificações |
| Entradas / Entradas DS_ | tabela de Design Points (nomes do app e nomes das cotas do SolidWorks) |
| Saidas | dados brutos importados + coeficientes calculados, em colunas separadas |
| Relatorio por DP | um bloco por simulação: entradas, saídas totais, coeficientes por elemento, folgas das fendas, Gurney e verificações |
| Graficos | tabela de dados + 7 gráficos **nativos do Excel** (Cl, Cd, Cl/Cd, Lift, Drag × variável do DOE, polar Cl × Cd, Cl por elemento) |
| Relatorios de forca, Parametros, Named Selections | mapeamento para o Fluent/Workbench |

O eixo X dos gráficos é a variável que mais varia na rodada; as séries são separadas por *com/sem Gurney* ou pela segunda variável. Dados de exemplo aparecem marcados no resumo, nos títulos dos gráficos e nas colunas. Os relatórios foram abertos no Excel 16 desta máquina (via automação COM): todas as abas e gráficos carregaram com as séries corretas.

## O que funciona, o que é só documentado

| Funciona no app (testado) | Só documentado / fora do app |
|---|---|
| Importação e validação de `.dat`, transformações, BF arredondado, Gurney | Construção do modelo no SolidWorks (o app exporta curvas XYZ e valores DS_) |
| Montagem com pivôs, gap/overlap (convenções configuráveis), interferências | Importação no DesignModeler, Boolean do domínio, criação das Named Selections |
| Domínio (dimensões, coordenadas, recomendações) | Geração e qualidade da malha (o app só faz o **plano** e sugestões heurísticas) |
| Plano de malha, Named Selections, CCs, valores de referência, relatórios de força com checagem de dupla contagem | Configuração do Fluent e dos relatórios (o app gera as instruções) |
| DOE (fatorial, OAT, manual), CSV/XLSX, copiar/colar | Execução dos Design Points no Workbench |
| Importação de saídas, coeficientes, gráficos, comparação, exportação, JSON/backup | Formato de fechamento de curva do DesignModeler (o arquivo repete o 1º ponto; confira na sua versão) |

Os arquivos XLSX são gerados sem bibliotecas (Office Open XML). O relatório completo foi aberto no
Excel 16 desta máquina e os gráficos foram exportados como imagem para conferência.

## Estrutura

```
index.html            casca da aplicação
iniciar.bat/.ps1      servidor local (PowerShell) + gravação em dados/estado.json
server.mjs            servidor alternativo (Node.js)
src/core/             lógica de engenharia, sem DOM (testável no Node)
  dat.js profile.js transform.js pivots.js assembly.js wing.js   geometria
  domain.js mesh.js namedsel.js fluent.js                          preparação CFD
  doe.js outputs.js chartdata.js                                   estudo e análise
  csv.js xlsx.js export.js report.js                               arquivos e relatório Excel
  model.js demo.js samples-data.js num.js geom.js                  dados e utilitários
src/ui/               interface (store/persistência, gráficos SVG, telas em views/)
tests/                testes (navegador: tests/index.html; Node: run-node.mjs)
samples/              S1223.dat, NACA23012.dat, CSV de saídas SINTÉTICO
docs/                 equações, convenções, validação e arquitetura
```

Documentação: [docs/equacoes.md](docs/equacoes.md) (convenções e equações),
[docs/validacao.md](docs/validacao.md) (comparação com o modelo SolidWorks),
[docs/arquitetura.md](docs/arquitetura.md).
