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
   `pivot_off_ref_n`, `pivot_dTE_ref_n` e, se houver, o Gurney (h, t). Em 3D informe a envergadura
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
- Para experimentar slat e Gurney, use *+ Adicionar slat* e *+ Definir Gurney flap* em Geometria (o exemplo padrão não traz slat nem Gurney).

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
