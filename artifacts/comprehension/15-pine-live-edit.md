# Pine live-edit loop — Comprehension

The tools an agent uses to read plot series, compile, bind, publish, fill, close, and screenshot a live Pine library on TradingView Desktop.

work-package · codebase-comprehension · 2026-09-09

## Structure

This area is the Pine editor walk plus the two read/capture tools that sit on the same live-update path. Transport, fencing, and the CDP singleton live in the sibling [tradingview-mcp](tradingview-mcp.md) corpus.

### Overview

Tool registrars stay thin. Behaviour lives in five core modules that talk to the chart page through `evaluate`. Study rows, toolbar buttons, wizard surfaces, and screenshot clips are all page-side facts the Node process does not own.

```
agent
  ├─ data_get_study_series  → getStudySeries (data.js)
  ├─ pine_smart_compile     → smartCompile (pine.js)
  ├─ pine_bind              → bindScript (pine.js)
  ├─ pine_publish           → publishScript (pine.js) → pine_ui helpers
  ├─ ui_set_input / ui_click → setInput / click (ui.js) → findElementExpression (dom.js)
  ├─ tv_ui_state            → uiState (health.js) + getVisibleDialogs (pine_ui.js)
  └─ capture_screenshot     → captureScreenshot (capture.js)
           │
           ▼
     connection.evaluate / scoped CDP  →  TradingView Desktop page
```

### Project

The worktree is `m2ux/tradingview-mcp` at `38fb58a37f4ccc4769bf999ab9764c866ae6eae6` on `fix/32-pine-live-edit-loop-wrong-plot-values`. ESM JavaScript, no build step. GitNexus impact on [getStudySeries](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/data.js#L592) is LOW (three direct callers). [smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L764) is LOW on the graph; [registerPineTools](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/tools/pine.js#L83) also calls it and the index does not list that edge.

#### Build units

| Unit | Path | Role |
|------|------|------|
| Study series | `src/core/data.js` | In-page plot-row reader |
| Pine core | `src/core/pine.js` | Compile, bind, save, publish |
| Pine UI | `src/core/pine_ui.js` | Dialog classify, fill, Open picker |
| Generic UI | `src/core/ui.js`, `src/core/dom.js` | Click and input fill |
| Capture | `src/core/capture.js` | Region clip + CDP screenshot |
| UI state | `src/core/health.js` | Panel/button snapshot |

#### Entry points

An MCP tool in `src/tools/{data,pine,ui,capture,health}.js` validates with zod, then calls the matching core export. The CLI reaches the same core functions. From there the call chain is expression string → `evaluate` → page DOM or widget API.

```
registerXTools → core.fn → evaluate(page JS) → JSON → jsonResult
```

### Module Map

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `data.js` | Plot series from `study._data._items` | `connection.js` |
| `pine.js` | Editor open, compile click, bind, publish walk | `pine_ui.js`, `dom.js` |
| `pine_ui.js` | Wizard/Open classify, `fillDialogInput`, facade REST | `connection.js` |
| `ui.js` | Generic `setInput` / `click` | `dom.js` |
| `dom.js` | First-match `querySelector` for aria-label | `connection.js` |
| `capture.js` | Chart-region clip from first matching canvas | `protocol.js`, `tab.js` |
| `health.js` | `uiState` button map; dialogs appended from pine_ui | `pine_ui.getVisibleDialogs` |

### Design Patterns

#### Page-script reader with host-side shaping

[getStudySeries](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/data.js#L585-L680) interpolates the `plots` filter into page JS, then the Node side only rounds and summarises whatever `plot_ids` and `bars` came back. Unit tests mock that page payload, so they never execute the in-page index loop.

#### Prefer-visible-button compile

[smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L770-L788) scans every `button`, clicks Save-and-add immediately if present, otherwise prefers Add to chart, then Update on chart, then Pine Save. `persisted` is true only when the click was Pine Save.

#### Facade-then-inject bind

[bindScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L645) looks up the saved facade, [openScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L663-L667) switches header identity, then always [setSource](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L696) with the fetched body. Header mismatch refuses; a dirty Monaco buffer that already matches the header does not.

#### Two fill paths

[fillDialogInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L473) stays inside a dialog ancestor (`js-dialog` / `role=dialog`). [setInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/ui.js#L60) uses a broader `[class*="dialog"]` scope, then falls back to the first visible text field on `document` when the regex misses.

#### First-match Close

[findElementExpression](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/dom.js#L160-L170) for `aria-label` is `querySelector`, so the first DOM match wins. Overlay Close and wizard Close share that label.

### Core Types

| Type | Role |
|------|------|
| Plot row `value[]` | `[timeSec, plot0, plot1, …]` aligned to full `metaInfo().plots` order |
| `wantPlots` / `plotIds` | Caller subset vs the IDs actually keyed into `plotsOut` |
| Editor identity | Header name + facade `scriptIdPart` the Save/Publish target |
| Classified dialog | `{ kind, step, mode, title, buttons }` from [classifyUiDialog](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L79) |
| Clip rect | `{ x, y, width, height, scale: 1 }` passed to `Page.captureScreenshot` |

### Traits and Interfaces

| Interface | Reached for |
|-----------|-------------|
| `data_get_study_series` `plots` | Subset of plot ids; values must still match the unfiltered read for those ids |
| `pine_smart_compile` `persisted` / `study_added` | Whether the click saved vs added a study |
| `pine_bind` `bound` | Buffer equals fetched facade after identity switch |
| `pine_publish` `mode` / `published_version` | Update-existing vs create; version must change |
| `tv_ui_state` `dialogs` | Wizard/Open surfaces, including ones without `role=dialog` |
| `ui_set_input` `match` | Placeholder/aria/name regex; default omits “changes you made to your library” |
| `capture_screenshot` `region: chart` | Clip to first `pane-canvas` / chart-container / canvas |

### Data Model

Study plot values live on the widget (`s._data._items`). Pine source lives in Monaco and, separately, on the pine-facade REST lists (saved vs published). Publish wizard state lives only in the page DOM. The server holds none of these; each tool re-reads.

## Behaviour

### Data Flow Map

Trust enters as tool arguments (plot ids, fill text, click selectors) and as page content (plot rows, buttons, overlays). The dangerous edges are silent: a filtered series returns plausible numbers for the wrong slots; a compile click adds a library to a production layout; a fill writes the editor.

#### Filtered study series

Caller passes `plots: ["plot_9", …]`. Page JS drops other ids from `plotIds`, then reads `it.value[vi + 1]` with `vi` over that **filtered** list. Slot 0 of the subset is `value[1]` (plot_0), not the slot for plot_9. The host maps those numbers onto the requested ids.

#### Library compile persist

[smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L764) counts studies, clicks the preferred toolbar button, sleeps 2.5s, reads Monaco markers. On an open library, Add to chart is visible and wins over Pine Save, so `study_added` can go true and `persisted` stays false.

#### Wizard fill

`ui_set_input` default match is `name|script|title|search|description`. A library change-description placeholder does not match. With `within_dialog` true, a wizard that is not `[role="dialog"]` / `[class*="dialog"]` widens scope to `document`, and the first visible textarea is Monaco.

`pine_publish` uses [fillDialogInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L473), which requires a dialog ancestor and will not take that fallback.

#### Bind overwrite

After a successful identity switch, [bindScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L696) always injects facade source. Unsaved Monaco edits on that same identity are replaced.

#### Leftover update wizard

[addToChart](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L866-L877) reads visible dialogs **before** any toolbar click and returns `blocked_dialog` when one is already open. [publishScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L1231) and [smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L764) do not. Publish always clicks Publish script first, then classifies; an already-open update wizard is not resumed. A second Publish click can stack, and an unchanged `published_version` returns `TV_PINE_PUBLISH_STALE`.

#### Chart-region clip

For `region === 'chart'`, [captureScreenshot](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/capture.js#L104-L115) takes the bounding box of the first `[data-name="pane-canvas"]`, else `[class*="chart-container"]`, else any `canvas`. A covering overlay that matches those selectors becomes the clip, and the tool still returns `success: true`.

### Design Patterns (runtime)

#### Index-by-kept-ids

The page reader filters meta first, then indexes the row by kept-list position. Correctness requires indexing by original meta index (or looking up each kept id’s slot) and then emitting only the requested keys.

#### Click-priority as product policy

Compile’s button order is the product policy for “make the chart match the buffer”. On a library that policy inserts a study. Persist-without-add needs Pine Save (or an equivalent that does not click Add).

### Invariant Alignment

| Invariant | Producer enforces? | Consumer assumes? | Gap? |
|-----------|-------------------|-------------------|------|
| Filtered plot id maps to the same slot as unfiltered | No — subset index | Agent treats `plots.plot_N` as that plot | Gap — `value[vi+1]` vs full meta |
| Library compile persists without adding a study | No — Add wins over Save | `pine_smart_compile` is compile+save | Gap |
| Generic fill cannot write Monaco | No — first-field fallback | `ui_set_input` fills the wizard notes | Gap |
| Close by aria-label is the wizard Close | No — first `querySelector` | Overlay vs wizard vs Delete this publication are distinct | Gap |
| Bind preserves a dirty buffer | No — always `setSource` | Bind only switches identity | Gap |
| Publish resumes an open update wizard | No — always clicks Publish script | Leftover wizard is the walk in progress | Gap |
| Chart-region clip is the pane, not an overlay | No — first matching node | `success` means a chart bitmap | Gap |

### Execution Context

Single-threaded MCP handlers. Page DOM is the source of truth and can show overlay editor, docked Monaco, publish wizard, Open picker, and account menus at once. A wrong click is a live mutation of a published library or a production layout. Failure returns `isError` / `success: false`; a wrong-but-successful fill or series read does not.

### Error Handling

| Error type | Consumer reaction |
|------------|-------------------|
| `TV_STUDY_NOT_FOUND` | Retry with fresh `entity_id` from `chart_get_state` |
| `TV_PINE_IDENTITY_MISMATCH` | Bind refused; open the named script first |
| `TV_PINE_PUBLISH_STALE` | Version unchanged; leftover wizard is a common cause |
| `TV_PINE_BLOCKED_DIALOG` | Leftover Open/Save dialog; close then retry |
| `TV_ELEMENT_NOT_FOUND` | Selector missed; `tv_ui_state` to inspect |
| Compile `study_added: true` | Not an error — the add already happened |

### Resource Bounds

OHLCV/series caps (500 bars default) apply to [getStudySeries](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/data.js#L594). Compile and publish use fixed sleeps (2.5s / 800ms), not `waitFor`. Screenshot writes a PNG under `screenshots/`. No bound on overlay size; a full-window clip is a successful capture.

### Operational Scenarios

| Scenario | Effect on this code path | Risk |
|----------|------------------------|------|
| Filtered `plots` on a many-plot study | Requested ids get earlier-slot values | High — silent wrong numbers |
| `pine_smart_compile` on an open library | Add to chart inserts the library as a study | High — layout pollution |
| `ui_set_input` with update wizard open | Notes land in Monaco | High — source corruption |
| `ui_click` Close by aria-label | Overlay Close or Delete this publication | High — delete prompt on a published library |
| `pine_bind` with unsaved Monaco | Facade body replaces the buffer | High — lost edits / overwrite |
| `pine_publish` with wizard already open | Stale version or stacked wizard | Medium |
| Chart screenshot under an account menu | Overlay clip returned as chart | Medium — false visual verify |

## Inferred Design Rationale

Rationale here is read out of the code, its comments, and its structure.

### Filter plots in the page to shrink the payload

[getStudySeries](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/data.js#L585-L591) documents a one-evaluate historical read and a `plots` filter so agents can ask for a subset. The cost of filtering the id list before indexing the row is the slot bug. Changing the index to full-meta order keeps the payload small and makes filtered values match unfiltered.

### Compile clicks whatever will apply the buffer to the chart

[smartCompile](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L764) and [addToChart](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L848) both prefer Add/Update. That matches an indicator workflow. A library has no chart apply step; Save is the persist path. The `persisted` flag already encodes that distinction — the click order does not honour it.

### Bind loads facade source so Save verifies against cloud identity

Comments on [bindScript](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine.js#L637-L643) state the job: establish buffer↔identity so `pine_save` can verify. Issue #26 taught it to refuse a header mismatch. The remaining cost is that identity alignment and buffer load are one call, so a dirty same-identity buffer is overwritten.

### Generic fill is the dialog-fill idiom lifted out of Pine

[setInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/ui.js#L54-L58) says it is the generic form of the Pine dialog-fill idiom. The specialised [fillDialogInput](https://github.com/m2ux/tradingview-mcp/blob/38fb58a37f4ccc4769bf999ab9764c866ae6eae6/src/core/pine_ui.js#L473) already refuses to write outside a dialog. The generic path keeps a first-field fallback so a missed regex still “works”, which is how wizard notes reach Monaco.

## Domain Concept Mapping

### Glossary

| Domain term | Technical construct | Description |
|-------------|---------------------|-------------|
| Plot slot | `it.value[i+1]` vs `metaInfo().plots[i].id` | One column of a study’s in-memory row |
| Pine Save | Toolbar `saveButton` class | Persist without Add to chart |
| Facade | pine-facade REST saved/published lists | Cloud identity and source |
| Pine overlay editor | Floating `.monaco-editor` with Publish/Add chrome | Usable editor; distinct from the docked bottom panel |
| Update wizard | `kind: pine_publish_wizard`, `mode: update` | Update-existing publish walk |
| Overlay Close | First `aria-label="Close"` on the Pine overlay editor | Not the wizard Close; not Delete this publication |
| Covering UI clip | Account menu or other surface matching the chart-region selector | Screenshot that is not the pane |
| Delete this publication | Confirm dialog after a bad Close | Destructive prompt on a published library |
| Chart-region clip | `Page.captureScreenshot` `clip` | Bitmap of the first matching canvas |

### Domain Model

A live library update is: read series → edit Monaco → persist (Save, not Add) → bind identity without clobbering dirty source → fill the update wizard → publish new version → screenshot the chart. Each named trap is one of those steps answering the wrong page surface.

## References

Coverage: Pine live-edit path (`data.js` series reader, `pine.js` / `pine_ui.js` compile-bind-publish, `ui.js` / `dom.js` fill and Close, `capture.js` chart clip, `health.js` uiState) at `38fb58a` (`fix/32-pine-live-edit-loop-wrong-plot-values`). Sibling corpus covers transport and the rest of the server.

| Reference | What it carries |
|-----------|-----------------|
| [tradingview-mcp corpus](tradingview-mcp.md) | Server-wide architecture, CDP transport, fencing |
| [Comprehension log — 2026-09-09](../planning/2026-09-09-plan-and-implement-the-changes/15-codebase-comprehension.md) | Questions, traces, caller enumerations, and challenge notes for this pass |

| Contributing work package | Dates |
|---------------------------|-------|
| 2026-09-09-plan-and-implement-the-changes (#32) | 2026-09-09 |
