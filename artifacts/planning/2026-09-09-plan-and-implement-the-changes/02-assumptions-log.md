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

## Wrap-Up

4 assumptions — all validated/confirmed.
