# Assumptions Log

> Pine live-edit loop · #32 · updated 2026-09-09

## Log

One row per assumption, updated in place. IDs: two-letter phase prefix + sequence
(DP-1, RE-1, RS-1, IA-1, PL-1) or task number (1.1, 2.3).

| ID | Phase/Task | Category | Risk | Assumption — rationale | Resolution | Outcome |
|----|------------|----------|------|------------------------|------------|---------|
| DP-1 | Design Philosophy | Problem Interpretation | M | Filtered `getStudySeries` still maps `it.value[vi+1]` by the filtered plot-id list, so skipped IDs read earlier slots — the ticket named this as the plot-slot bug and the worktree should still carry it | Code: `src/core/data.js:628-648` — `wantPlots` filters `plotIds`, then `raw = it.value[vi + 1]` indexes the subset, not full meta order | Validated |
| DP-2 | Design Philosophy | Problem Interpretation | M | `smartCompile` still prefers Add to chart over Pine Save, so compiling an open library can insert a study — the ticket's compile-persist trap | Code: `src/core/pine.js:770-788` — after scanning buttons, `if (addBtn)` clicks before `saveBtn`; `persisted` is true only when `clicked === 'Pine Save'` | Validated |
| DP-3 | Design Philosophy | Complexity Assessment | L | Conventional local fixes on the named tools are enough; the Pine tool surface does not need an architectural rewrite — skip-optional / simple path | User (workflow-path-selected: skip-optional) | Confirmed |
| DP-4 | Design Philosophy | Workflow Path | M | Ticket #32 acceptance criteria are complete enough to plan against without elicitation or research | User (workflow-path-selected: skip-optional) | Confirmed |
| PL-1 | Planning | Design Approach | M | An open library is detectable from `library(` in the Monaco buffer or facade `kind`, so `smartCompile` can choose Pine Save without a new API — `scriptKind()` and the `library` new-script template already exist | Code: `src/core/pine.js:1387-1389` `scriptKind()`; `src/core/pine.js:945` library template; `getEditorBufferInfo` reads Monaco source | Validated |
| PL-2 | Planning | Test Strategy | L | Injected-`evaluate` unit tests are enough to lock slot-map, click-order, fill, bind, publish, and clip; live Desktop is visual confirm only — matches the design-philosophy dependency row | Code: `tests/study_series.test.js` `mockDeps`; `tests/ui_verbs.test.js`; `tests/pine_workflow.test.js`; `tests/pine_write_path.test.js` already inject evaluate | Validated |
| PL-3 | Planning | Scope Decisions | L | Resume (not refuse) is the leftover-wizard path — ticket allows either; resume keeps the publish walk the agent already started | User (residual-assumption-batch: accept-agent-positions) | Confirmed |
| 1.1 | Task 1 | Test Strategy | L | Executing the generated getStudySeries IIFE in Node against a stub TradingViewApi locks the slot map — the expression is the same page JS, so extracting a helper would duplicate it | Code: `tests/study_series.test.js` in-page plot slot map; commit `8a91c50` | Validated |
| 2.1 | Task 2 | Behavioral | L | Monaco's editor textarea is identified by class `inputarea` — that is the class the ticket names for the accidental fill target | Code: `src/core/ui.js` `isMonaco`; commit `035a3f7` | Validated |
| 3.1 | Task 3 | Behavioral | L | An overlapping dialog or `elementFromPoint` miss at the pane centre is enough to refuse a chart clip — overlay menus that cover the pane fail rather than clipping chrome | Code: `src/core/capture.js` chart-region bounds; commit `0a5a41c` | Validated |
| 4.1 | Task 4 | Interface | L | Unscoped Close prefers wizard then overlay and never the delete-confirm X; `surface: delete_confirm` resolves Cancel — that matches the ticket's three-way distinguish | Code: `src/core/dom.js` `pickClose`; commit `d70e25f` | Validated |
| — | Task 5 | — | — | No significant assumptions (library detection from `library(` / facade kind is PL-1) | — | — |
| 6.1 | Task 6 | Behavioral | L | A dirty buffer is any current Monaco source that is not newline-equal to the fetched facade — `pineSourcesEqual` is the same comparison save already uses | Code: `src/core/pine.js` `bindScript` dirty check; commit `25f3e17` | Validated |
| — | Task 7 | — | — | No significant assumptions (leftover-wizard resume is PL-3) | — | — |

## Wrap-Up

12 assumptions — all validated/confirmed.
