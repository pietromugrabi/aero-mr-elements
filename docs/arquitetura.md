# Arquitetura

- **Sem dependências e sem build.** HTML + módulos ES + CSS. Gráficos em SVG próprio; XLSX e ZIP
  gerados por `src/core/xlsx.js`.
- **`src/core/`**: toda a engenharia, sem acesso ao DOM, importável no navegador e no Node (testes).
- **`src/ui/`**: interface. `store.js` mantém o estado e a persistência; `app.js` faz o roteamento por
  hash (`#geometria`, `#inputs`…); cada tela em `views/` é uma função `(ctx) → elemento DOM` que é
  redesenhada após cada alteração (o foco e a rolagem são preservados).

## Módulos de engenharia

| Módulo | Responsabilidade |
|---|---|
| `dat.js` | leitura de `.dat` (Selig/Lednicer), limpeza, BA/BF, escrita Selig |
| `profile.js` | normalização, BA na spline, BF arredondado, corda geométrica, Gurney, contorno local |
| `transform.js` | referencial do perfil ↔ CAD (sinais, plano), direções de escoamento/sustentação |
| `pivots.js` | escalonamento do pivô com a corda e posição local |
| `assembly.js` | montagem (convenções), medições, interseções e regras do SolidWorks |
| `wing.js` | integra pacote + entradas de um DP → geometria montada no CAD (com cache) |
| `domain.js` | domínio a partir dos extremos da montagem |
| `mesh.js` | plano de malha e sugestões (y+, camadas, tamanhos) |
| `namedsel.js` | Named Selections padrão e validação |
| `fluent.js` | valores de referência, relatórios de força, dupla contagem, parâmetros, nomes DS_ |
| `doe.js` | variáveis, níveis, fatorial/OAT, duplicatas, DPs com pivôs derivados |
| `outputs.js` | leitura de CSV de saídas, mapeamento, unidades, associação aos DPs, coeficientes |
| `chartdata.js` | registros, filtros, séries, avisos de condições, mapa de calor, superfície de resposta, ranking |
| `csv.js`, `xlsx.js`, `export.js` | formatos de arquivo e relatórios |
| `model.js` | modelo de dados, padrões, duplicação, histórico, migração |
| `demo.js` | projeto de demonstração (resultados sintéticos marcados) |

## Modelo de dados

```
estado { version, savedAt, ui{theme, active{projectId, packageId, runId}}, projects[] }
Projeto { id, name, description, notes, status, isDemo, history[], chartConfigs[], packages[] }
Pacote  { id, name, notes, status, config{ nElements, mode, span_mm, transform, conventions,
          elements[{profileName, datText, inputMode, alignChord, chord_ref, aoa_ref, gap_ref,
          overlap_ref, pivot_off_ref, pivot_dTE_ref, te{}, gurney{}}], domain, mesh,
          namedSelections[], fluent }, runs[] }
Rodada  { id, name, notes, status, doe{method, levels{}, pivotScaling}, outputOpts, lastImport, dps[] }
DP      { id, name, status, notes, inputs{chord_n, AoA_n, Gap_n, Overlap_n, pivot_off_n, pivot_dTE_n,
          gurney_h_n, gurney_t_n, Uinf}, outputs{raw{lift_total, drag_total, lift_el_n, drag_el_n},
          rawRow{coluna: texto}, source, importedAt, isExample} }
```

Os valores calculados (coeficientes, geometria montada, domínio) nunca são gravados: são
recalculados a partir dos dados brutos e das configurações.
