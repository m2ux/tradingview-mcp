# Pine live-edit loop — Implementation Plan

> plan · MEDIUM · Planning · 2-3h agentic + 45m review · 2026-09-09

## Overview

### Problem & Scope

Problem, scope, and success criteria: [design philosophy](02-design-philosophy.md#success-criteria) (elicitation skipped). Out of scope: application-script edits named in #32.

## Inputs

- [Design philosophy](02-design-philosophy.md#problem-classification) — cause-known / simple; conventional local fixes; seven acceptance checks
- [Pine live-edit corpus](../../comprehension/15-pine-live-edit.md#invariant-alignment) — seven producer/consumer gaps and the in-tree leftover-dialog pattern on add-to-chart
- [Assumptions log](02-assumptions-log.md) — DP-1/DP-2 validated the slot-map and Add-before-Save click order

## Proposed Approach

### Solution Design

Seven independent traps, one conventional fix each. No transport rewrite. GitNexus impact on the named symbols is LOW; edit each core function, then its unit tests.

1. **Series slots.** [getStudySeries](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/data.js#L626-L649) indexes `it.value` by full `metaInfo().plots` order, then emits only requested ids. Filtered `plot_N` matches the unfiltered read.
2. **Compile persist.** [smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L770-L788) clicks Pine Save when the open script is a library (`library(` in the buffer, or facade `kind`). Add / Update stay the path for indicators. `persisted: true`, `study_added: false`.
3. **Wizard fill.** [setInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/ui.js#L60) never falls back to the first visible field. A missed `match` errors. Widen default match to include “changes you made”. Skip Monaco `textarea.inputarea`.
4. **Close classify.** [findElementExpression](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/dom.js#L168-L170) / click helpers take a surface (wizard vs Pine overlay vs delete-confirm), not the first `aria-label="Close"`. Cancel remains the safe delete control. [uiState](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/health.js#L102) reports that classification.
5. **Bind dirty buffer.** [bindScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L696) compares Monaco to facade **before** `setSource`. On mismatch, refuse unless `reload: true`.
6. **Leftover wizard.** [publishScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L1231) reads [getVisibleDialogs](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L369) first (same pattern as [addToChart](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L866-L877)). An open `pine_publish_wizard` resumes that walk; it does not click Publish script again.
7. **Chart clip.** [captureScreenshot](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/capture.js#L104-L115) for `region: chart` uses `[data-name="pane-canvas"]` only. A covering dialog or missing pane fails rather than clipping the first `canvas`.

### Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Seven local fixes in existing functions | Matches DP-3; LOW blast radius | Seven test surfaces | **Selected** |
| Merge `setInput` into `fillDialogInput` | One fill path | Overfits a generic verb; ticket is “cannot write Monaco” | Rejected |
| CDP / Pine architecture rewrite | Would remove several chokepoints | Out of scope; sibling corpus already covers transport | Rejected |
| Refuse leftover wizard (like add-to-chart) | Simpler | Agent must close and restart publish | Rejected — resume is the ticket’s other allowed path and keeps the walk |

### Assumptions

Assumptions underlying the approach: [assumptions log](02-assumptions-log.md).

## Implementation Tasks

### Task 1: Series slot map (20-30 min)

**Goal:** Filtered plot ids carry the same values as an unfiltered read.  
**Depends on:** none  
**Deliverables:**
- `src/core/data.js` — index by full meta, then key the subset
- `tests/study_series.test.js` — in-page loop fixture: `plots: ['plot_9']` ≠ slot 0

### Task 2: Generic fill does not write Monaco (15-25 min)

**Goal:** `ui_set_input` fills a matched wizard field or errors.  
**Depends on:** none  
**Deliverables:**
- `src/core/ui.js` — drop first-field fallback; skip Monaco inputarea; extend default match
- `tests/ui_verbs.test.js` — missed match errors; Monaco textarea is not committed

### Task 3: Chart-region clip is the pane (15-25 min)

**Goal:** Overlay/account-menu bitmaps are not successful chart captures.  
**Depends on:** none  
**Deliverables:**
- `src/core/capture.js` — pane-canvas only; fail when a covering dialog occludes it
- `tests/` capture unit — covering dialog → not `success` with that clip

### Task 4: Close surface classification (25-40 min)

**Goal:** Overlay Close, wizard Close, and Delete this publication are distinct.  
**Depends on:** none  
**Deliverables:**
- `src/core/dom.js` / `src/core/ui.js` / `src/core/pine_ui.js` / `src/core/health.js` — classify Close by ancestor; `tv_ui_state` exposes it
- tests for first-vs-intended Close and Cancel-on-delete

### Task 5: Library compile persists without Add (20-30 min)

**Goal:** `pine_smart_compile` on a library clicks Pine Save.  
**Depends on:** none (same file as 6–7; land before them)  
**Deliverables:**
- `src/core/pine.js` — library → Save; indicator → Add/Update
- tests: library buffer clicks Save; indicator still Add

### Task 6: Bind preserves a dirty buffer (15-25 min)

**Goal:** `pine_bind` does not inject facade source over unsaved Monaco unless `reload: true`.  
**Depends on:** Task 5 (shared `pine.js`)  
**Deliverables:**
- `src/core/pine.js` — pre-`setSource` equality; optional `reload`
- `src/tools/pine.js` — `reload` argument
- tests: dirty same-identity buffer refused; `reload: true` injects

### Task 7: Publish resumes an open update wizard (20-30 min)

**Goal:** Leftover update wizard is the walk in progress.  
**Depends on:** Task 5–6 (shared `pine.js`)  
**Deliverables:**
- `src/core/pine.js` — pre-check `pine_publish_wizard`; skip extra Publish click
- tests: open wizard → no second Publish; unchanged snapshot still `TV_PINE_PUBLISH_STALE`

## Success Criteria

Success criteria: [design philosophy](02-design-philosophy.md#success-criteria). Task-level: each task’s unit test locks the gap named in the corpus invariant table.

## Testing Strategy

Test cases and acceptance matrix: [test plan](06-test-plan.md). Unit tests with injected `evaluate` are the gate; live Desktop is visual confirm only.

## Dependencies & Risks

### Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Live Close / screenshot selectors drift vs Desktop chrome | MEDIUM | MEDIUM | Classify by dialog kind already in `getVisibleDialogs`; pane-canvas is a stable `data-name` |
| Library detection misses a untitled buffer | MEDIUM | LOW | Treat `library(` in source as sufficient; facade `kind` as backup |
| Seven edits in `pine.js` conflict | LOW | LOW | Land Tasks 5→7 in order on one branch |

**Status:** Ready for implementation
