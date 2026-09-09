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
| PL-3 | Planning | Scope Decisions | L | Resume (not refuse) is the leftover-wizard path — ticket allows either; resume keeps the publish walk the agent already started | Plan alternatives table: resume selected, refuse rejected. Challenge: stakeholder-gap confirmed; ticket text allows both | Open (stakeholder-confirmable; agent position: resume) |

## Open Assumptions

### PL-3: Leftover wizard is resumed
**Assumption:** An already-open update wizard is continued rather than failed as `blocked_dialog`.  
**Decision space:** Resume the open wizard (no second Publish click) vs refuse like `addToChart` and make the agent close it first.  
**Why not code-resolvable:** Both paths satisfy the ticket; the choice is product preference.  
**Technical context:** `addToChart` already refuses leftover dialogs; `publishScript` currently clicks Publish first.  
**Agent's position:** Resume — the wizard on screen is the walk in progress.  
**Reversibility:** easily-reversible

## Wrap-Up

7 assumptions — PL-1 and PL-2 validated in planning reconcile; PL-3 remains open for stakeholder confirm of resume vs refuse.
