# Codebase Comprehension — Pine live-edit loop

> 2026-09-09-plan-and-implement-the-changes · 2026-09-09 · settled · coverage: Pine live-edit path at `38fb58a` (`data.js` series reader, `pine.js` / `pine_ui.js` compile-bind-publish, `ui.js` / `dom.js` fill and Close, `capture.js` chart clip, `health.js` uiState)

This file is the questions this pass asked, the traces that answered them, and the items left for later. Settled facts live in [15-pine-live-edit.md](../../comprehension/15-pine-live-edit.md).

## Open Questions

Every named trap in #32 maps to a concrete page-side index, click-order, or selector in this worktree. Nothing in that set remains open for another comprehension pass.

| # | Question | Status | Resolution | Deep-Dive Section |
|---|----------|--------|------------|-------------------|
| 1 | Does filtered `plots` index the subset list against full-meta row slots? | Resolved | Yes — `wantPlots` filters `plotIds`, then `it.value[vi + 1]` uses subset position | [Study-series slot map](#study-series-slot-map--2026-09-09) |
| 2 | Does `smartCompile` prefer Add to chart over Pine Save on a library? | Resolved | Yes — Add is clicked before Save; `persisted` is true only for Pine Save | [Compile click order](#compile-click-order--2026-09-09) |
| 3 | How does `ui_set_input` write Monaco when the update wizard is open? | Resolved | Default regex misses the library change-description placeholder; first visible textarea fallback, and dialog scope widens to `document` when the wizard is not `role=dialog` / `class*="dialog"` | [Wizard fill vs specialised fill](#wizard-fill-vs-specialised-fill--2026-09-09) |
| 4 | Why does Close by aria-label raise Delete this publication? | Resolved | `findElementExpression` uses first `querySelector` on `aria-label`; overlay Close, wizard Close, and delete confirm share that label | [Close first-match](#close-first-match--2026-09-09) |
| 5 | Does `pine_bind` replace a dirty same-identity buffer? | Resolved | After header match it always `setSource`s facade body; equality is checked after inject, not before | [Bind overwrite](#bind-overwrite--2026-09-09) |
| 6 | Does `pine_publish` resume an already-open update wizard? | Resolved | No — it always clicks Publish script first. `addToChart` is the in-tree pattern that pre-checks dialogs | [Leftover wizard](#leftover-wizard--2026-09-09) |
| 7 | Can a chart-region screenshot succeed on a covering overlay? | Resolved | Yes — first `pane-canvas` / `chart-container` / `canvas` box becomes the clip; `success` does not mean the pane was visible | [Chart-region clip](#chart-region-clip--2026-09-09) |

## Deep-Dive Sections

### Study-series slot map — 2026-09-09

In-page loop in [getStudySeries](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/data.js#L626-L649):

1. `plotMeta = meta2.plots`
2. Keep ids whose `id` is in `wantPlots` (or keep all)
3. For each kept id at subset index `vi`, read `it.value[vi + 1]`

`value[0]` is time. `value[1]` is always plot_0’s slot in the full meta. Filtering plot_9–plot_18 makes `vi=0` still read `value[1]`.

`tests/study_series.test.js` mocks the **host-side** payload. The `plots: ['plot_1']` case only asserts `wantPlots` is interpolated. It does not run the in-page loop, so it cannot catch the slot map.

Call sites (GitNexus cypher `CALLS` → `getStudySeries`):

| Caller | Path |
|--------|------|
| `registerDataTools` | `src/tools/data.js` |
| `captureOnce` | `scripts/capture_study_series.mjs` |
| (file) | `scripts/diff_study_series.mjs` |
| tests | `study_series.test.js`, `data_entity_id.test.js`, `structured_errors.test.js`, `target_reads.test.js` |

Impact on `getStudySeries` upstream: LOW (three production callers, two processes).

### Compile click order — 2026-09-09

[smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L770-L788) scan order:

1. If text matches `/save and add to chart/i` → click immediately, return that label
2. Else remember first `/^add to chart/i`, `/^update on chart/i`, and visible `saveButton`
3. Click Add, else Update, else Pine Save

`persisted: clicked === 'Pine Save'`. `study_added` is a study-count diff after a 2.5s sleep. No pre-check of open dialogs (unlike `addToChart`).

Call sites (`CALLS` → `smartCompile`): `registerPineTools` (`src/tools/pine.js`), `src/cli/commands/pine.js`. GitNexus `impact` listed only the CLI; cypher recovered the MCP registrar.

### Wizard fill vs specialised fill — 2026-09-09

Two fills:

| Helper | Used by | Dialog ancestor required? | Fallback |
|--------|---------|---------------------------|----------|
| [setInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/ui.js#L60) | `ui_set_input` | Optional; `[role="dialog"], [class*="dialog"], [class*="modal"]` else `document` | First visible `input[type=text\|search]` or `textarea` |
| [fillDialogInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L473) | `publishScript` (`fillFn`) | Yes — `js-dialog` / `role=dialog` / `aria-modal` | Largest visible dialog `TEXTAREA` ≥ 1000px² on a publish wizard |

Default `setInput` match: `name|script|title|search|description`. Ticket placeholder “Describe the changes you made to your library” does not match. `fillDialogInput`’s publish regex is `description|about|summary|release notes` — also misses that phrasing, but its fallback stays inside the wizard.

`CALLS` → `setInput`: `registerUiTools` only (LOW impact). `CALLS` → `fillDialogInput`: `ui_verbs.test.js` only on the graph; `publishScript` binds it via `_deps.fillDialogInput || fillDialogInput` (indirect, not a CALLS edge).

### Close first-match — 2026-09-09

[findElementExpression](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/dom.js#L168-L170) for `aria-label`: exact `querySelector`, then substring `querySelector`. First DOM node wins. `ui_click` uses that. [clickVisibleButton](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L349) iterates buttons **last-to-first** and can take a different Close.

`tv_ui_state` lists visible buttons by region but does not classify Close into overlay / wizard / delete-confirm. [classifyUiDialog](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L79) kinds are Open picker and publish wizard, not delete-publication.

`CALLS` → `click`: `registerUiTools`, `src/cli/commands/ui.js`.

### Bind overwrite — 2026-09-09

[bindScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L645-L711):

1. Facade lookup + fetch source
2. `openScript` for header identity; mismatch → refuse (issue #26)
3. `setSource` with fetched body — no dirty-buffer compare
4. `pineSourcesEqual` after inject to set `bound`

[pine_save](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L542) already skips persist when the buffer equals cloud. Bind does not reuse that pre-check.

Cypher `CALLS` → `bindScript`: `registerPineTools`, `issue26_pine_friction.test.js`, `smoke_issue26_live.mjs`. `impact` listed only the smoke file.

### Leftover wizard — 2026-09-09

[publishScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L1231-L1254) order: click Publish script → sleep 800ms → classify `getVisibleDialogs`. No `preDialogs` guard.

[addToChart](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L866-L877) is the existing leftover-dialog pattern: if `preDialogs.length > 0`, return `blocked_dialog` without clicking.

`openScript` leftover handling is Open-picker only (`kind === 'pine_open_dialog'`), not publish wizard.

Cypher `CALLS` → `publishScript`: `registerPineTools`, CLI pine, `issue26_pine_friction.test.js`, `smoke_issue26_live.mjs`.

### Chart-region clip — 2026-09-09

[captureScreenshot](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/capture.js#L104-L115) for `region === 'chart'`:

```
[data-name="pane-canvas"] || [class*="chart-container"] || canvas
```

then `getBoundingClientRect` → `Page.captureScreenshot` clip. No occlusion test. `success: true` whenever CDP returns bytes.

Same first-canvas selector appears in `src/core/ui.js` (scroll) and a tighter `pane-canvas canvas` in `src/wait.js`.

Cypher `CALLS` → `captureScreenshot` (`src/core/capture.js`): `registerCaptureTools`, `captureSnapshot`, CLI capture, `target_reads.test.js`. A same-name protocol helper in `src/core/protocol.js` is a different symbol.

## Challenge Lenses

### Pedagogy — 2026-09-09

| Item | Outcome | Evidence |
|------|---------|----------|
| Q1–Q7 mechanisms | confirmed | Each row names a function and an index/click/selector; a fixer can open the blob link |
| Word “overlay” overloaded | weakened then repaired | Pine overlay editor, overlay Close, covering UI clip, and study overlay were one word; glossary split them in the corpus |
| GitNexus `impact` misses some tool-registrar CALLS | confirmed (index, not code) | cypher recovered `registerPineTools` → `smartCompile` / `bindScript`; impact did not |
| Default placeholder string not in repo | irreducible-for-this-tree | Ticket text is runtime UI; the regex miss is in-repo regardless of the exact phrase |

### Rejected-paths — 2026-09-09

| Candidate | Outcome | Evidence |
|-----------|---------|----------|
| CDP transport rewrite | rejected | Sibling [tradingview-mcp.md](../../comprehension/tradingview-mcp.md) already covers it; #32 is seven local traps |
| Merge `setInput` into `fillDialogInput` as the first move | rejected as required path | Ticket acceptance is “cannot write Monaco”; specialised fill already has a dialog ancestor. Tightening generic fallback is enough |
| Elicitation / research | rejected | `skip_optional_activities`; DP-4 confirmed ticket criteria |
| Application-script edits (RSIZones / RSIHeat / RSIZGen) | rejected | #32 non-goal |
| Wait on TradingView API changes | rejected | DP-3: conventional local fixes |

No newly surfaced agent-resolvable questions. Residual opens: none that block planning.

## Follow-up items (out of scope)

| Item | What it would take |
|------|--------------------|
| Live confirm Monaco `textarea.inputarea` is `vis()` when the wizard is open | Desktop session; the fallback path is already enough to plan a refuse-or-scope fix |
| GitNexus CALLS completeness for `_deps` defaults | Reindex / graph issue, not a product defect |
| Classify Delete this publication in `classifyUiDialog` | Implementation, not a comprehension gap |
