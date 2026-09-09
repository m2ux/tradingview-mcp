# Change Block Index

> fix/32-pine-live-edit-loop-wrong-plot-values vs main · 15 files · 33 hunks · est. review ~17 minutes (30 sec/change)

Reviewed commit: `7cc922312381b5897f72635a2a88136b79763848` (PR [#33](https://github.com/m2ux/tradingview-mcp/pull/33)). Citations use the blob URL at that sha.

GitNexus `detect_changes` compare against the indexed main checkout (`a329f68`) does not map this worktree. Caller context below is from `context` on the named symbols in the current index. `captureScreenshot` reaches `registerCaptureTools`, `captureSnapshot`, and the capture CLI. `getStudySeries` reaches `registerDataTools`. `findElementExpression` is the locator for `click` and `fiberAction`. `publishScript` / `bindScript` / `smartCompile` are Pine tool and CLI entry points.

## Block Rationale

### [Block 1 — capture.js:104](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/capture.js#L104)

Chart-region capture used to clip the first of pane-canvas, a chart-container, or any canvas, so a covering dialog still produced a PNG of overlay chrome. The clip now requires pane-canvas with a non-empty rect, then rejects overlapping dialogs and a centre hit that is not the pane. `TV_CHART_CLIP_BLOCKED` is the typed failure so an agent retries after dismissing the cover rather than analysing a screenshot of the menu. Callers are `registerCaptureTools`, `captureSnapshot`, and the capture CLI; a false occlusion would fail those paths, a missed cover would still ship a misleading chart image.

### [Block 2 — data.js:642](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/data.js#L642)

`value[1..]` on a study bar follows `metaInfo().plots[]` order, not the filtered `plotIds` list. Walking the subset as the column index mapped `plot_9` onto `value[1]` (the first kept id) and returned the wrong number without an error. The loop now walks full `plotMeta` and skips ids that are not requested, so a filtered id keeps its unfiltered slot. `registerDataTools` and the study-series capture scripts are the live callers; a remaining off-by-subset bug would still look like a correct compact payload.

### [Block 3 — dom.js:155](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/dom.js#L155)

`ui_click` Close used the first visible `aria-label="Close"`. That node is often the Pine overlay X, which then offers Delete this publication for a published library. `findElementExpression` now classifies Close by ancestor text (wizard, overlay, delete-confirm), prefers wizard then overlay, never the delete X, and maps `surface: delete_confirm` to Cancel. Non-Close locators stay first-visible. `click` and `fiberAction` both compile this expression; a misclassified ancestor string would click the wrong Close on a live walk.

### [Block 4 — err.js:17](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/err.js#L17)

`TV_CHART_CLIP_BLOCKED` is the stable code for a chart-region clip that has no pane-canvas or is covered. Callers and tests branch on `err.code` rather than the prose message. The catalogue string states the unobstructed-pane requirement so a retry hint can stay on the throw site.

### [Block 5 — err.js:31](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/err.js#L31)

`TV_PINE_DIRTY_BUFFER` is the stable code when `pine_bind` refuses to load facade source over unsaved editor text. The bind path returns this without throwing so the tool JSON can carry `code` next to `success: false`. Agents that treat any bind failure as identity mismatch would otherwise retry Open and still lose the buffer.

### [Block 6 — health.js:170](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/health.js#L170)

`uiState` keeps Close classification on each classified dialog (`close_surface`, `safe_dismiss`) rather than a second top-level Close map. The comment records that a compact Close list can be added when a caller needs it without scanning `dialogs[]`. This hunk is documentation beside the lean drop of `close_controls`; behaviour change for Close lives in `classifyUiDialog` and `findElementExpression`.

### [Block 7 — pine.js:642](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L642)

`bindScript` takes `reload` (default false) so identity alignment and facade load are separate decisions. The previous signature always injected facade source after a successful Open, which is the overwrite the dirty-buffer guard below refuses. Tests inject `_deps`; the MCP tool forwards `reload` from Block 21.

### [Block 8 — pine.js:693](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L693)

After Open matches the requested header, the buffer is compared to the fetched facade with `pineSourcesEqual`. A dirty same-identity buffer returns `TV_PINE_DIRTY_BUFFER` and does not call `setSource` unless `reload` is true. A clean or empty buffer still skips a redundant inject. Callers are the pine tool, issue-26 unit tests, and the live smoke script; injecting on every bind would still wipe in-progress library edits.

### [Block 9 — pine.js:778](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L778)

`bufferLooksLikeLibrary` treats `kind: library` or a `library(` header as the compile target that must not land on the chart. `smartCompile` now takes `_deps` so unit tests can drive evaluate, sleep, and study count without a live page. The library check runs before the button walk so Add to chart is not the first click on a reusable library. CLI `pine` commands call this path; a false library detection would Save an indicator instead of adding it.

### [Block 10 — pine.js:816](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L816)

When `preferSave` is set, the page script clicks the visible Save toolbar control and returns `Pine Save` before Add/Update. `Save and add to chart` is ignored for that buffer so a library compile cannot insert a study. Indicator buffers keep the previous Add/Update/Save order. `study_added` later compares study counts; a Save click is what keeps that flag false on a library.

### [Block 11 — pine.js:825](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L825)

Enter-key fallback and the post-click sleep go through `_deps` so tests do not wait 2.5s or send keys. Production still uses `pressKey` and `sleep`. This hunk is the injectability seam for Block 9, not a change to the fallback order.

### [Block 12 — pine.js:843](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L843)

Study count after compile uses the same injectable `studyCount`. Library Save should not increase the count; the test in Block 33 asserts `study_added: false`. A live page that adds a study despite Save would still report `study_added: true` and remain visible in the tool result.

### [Block 13 — pine.js:1262](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L1262)

`publishScript` used to click Publish script on every call, which restarts an already-open update wizard and can reset the step the agent was filling. Classified dialogs are read first; a leftover `pine_publish_wizard` sets `publishClicked: 'resumed'` and skips the toolbar click and the not-on-chart interstitial. The not-on-chart Add-to-chart walk remains for a fresh open. Tests and the pine CLI call this; a missed leftover wizard would still double-open and lose wizard field state.

### [Block 14 — pine_ui.js:80](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine_ui.js#L80)

Delete this publication is classified before Open-my-script and the update wizard so a confirm dialog is not mistaken for a Close-able overlay. `close_surface: delete_confirm` and `safe_dismiss: Cancel` tell `ui_click` / health snapshots which control is safe. The overlay picker now also carries `close_surface: overlay`. `publishScript` and `uiState` consume classified dialogs; swapping this order would treat delete-confirm as a generic dialog.

### [Block 15 — pine_ui.js:101](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine_ui.js#L101)

Every remaining publish-wizard kind (update title, update-existing, publish-new, final-touches, release-notes) sets `close_surface: wizard`. `findElementExpression` and leftover-wizard resume both key off `kind` plus this surface. A wizard step that omitted the field would fall through to first-visible Close again.

### [Block 16 — ui.js:16](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/ui.js#L16)

`click` forwards optional `surface` into `findElementExpression` so the MCP `ui_click` argument actually selects wizard vs overlay vs delete-confirm. Without this, Block 3's classifier would only run on a default Close and could not be aimed. Trusted CDP fallback is unchanged.

### [Block 17 — ui.js:54](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/ui.js#L54)

Default `match` includes `changes you made`, the placeholder phrasing on the library update notes field. The contract is match-only: a miss errors, and Monaco `textarea.inputarea` is never a fill target. The previous first-visible fallback wrote publish notes into the Pine editor when the wizard field did not match.

### [Block 18 — ui.js:69](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/ui.js#L69)

The page script skips Monaco, drops `fallback: true`, and returns `{ set: false }` when no meta matches. The host then throws `No visible input matched`. `registerUiTools` is the only production caller; a remaining fallback would still corrupt the open library on a missed wizard field.

### [Block 19 — ui.js:120](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/ui.js#L120)

Gated `fiberAction` uses the same `surface` locator as `click`, so a dangerous-mode Close cannot bypass classification. `findElementExpression` is shared; this hunk is the second call site, not a second classifier.

### [Block 20 — tools/health.js:14](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/tools/health.js#L14)

`tv_ui_state` tool text names `close_surface` on wizard and Open-picker dialogs so agents read the classified Close from `dialogs[]` rather than a removed `close_controls` array. Description-only; payload shape comes from `uiState` / `classifyUiDialog`.

### [Block 21 — tools/pine.js:64](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/tools/pine.js#L64)

`pine_bind` documents the dirty-buffer refuse, adds optional `reload`, and passes it to `bindScript`. Default remains no overwrite. Agents that still assume bind always loads facade will see `TV_PINE_DIRTY_BUFFER` until they pass `reload: true`.

### [Block 22 — tools/pine.js:78](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/tools/pine.js#L78)

`pine_smart_compile` description states that a library buffer clicks Pine Save (`persisted: true`, `study_added: false`). The behaviour is Block 9–12; this hunk is the tool contract agents read before calling.

### [Block 23 — tools/ui.js:7](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/tools/ui.js#L7)

`ui_click` exposes `surface` (`wizard` | `overlay` | `delete_confirm`). `ui_set_input` default match documents `changes you made`. These are the public knobs for Blocks 3 and 17; omitting `surface` still prefers wizard Close over overlay and never the delete X.

### [Block 24 — issue26_pine_friction.test.js:16](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L16)

The issue-26 friction suite imports `smartCompile` so library vs indicator compile can be tested with injected `_deps`. The new describe is Block 33; this hunk is the import that makes that describe compile.

### [Block 25 — issue26_pine_friction.test.js:68](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L68)

Open-picker classification now asserts `close_surface: overlay`. A new case asserts Delete this publication is `delete_confirm` with `safe_dismiss: Cancel`. These lock Block 14 so a later kind reorder cannot silently drop the safe dismiss.

### [Block 26 — issue26_pine_friction.test.js:126](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L126)

Dirty same-identity bind refuses without `setSource`; `reload: true` injects once and binds. `setCalls` is the proof the guard is not only a flag. This is the unit lock for Blocks 7–8.

### [Block 27 — issue26_pine_friction.test.js:289](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L289)

Publish with an already-open update wizard must not click Publish script again, and must still take the Update-existing path. The existing `publishDeps` fixture supplies that leftover wizard. This locks Block 13.

### [Block 28 — issue26_pine_friction.test.js:346](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L346)

Library source plus both Save and Add buttons available must click only Pine Save and report `study_added: false`. Indicator source still prefers Add to chart. The evaluate stub keys off `preferSave` in the generated page script, which is how Block 10 is observed without a live editor.

### [Block 29 — study_series.test.js:99](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/study_series.test.js#L99)

A ten-plot study with `plot_i = i * 10` asserts filtered `plot_9` is 90, matches the unfiltered slot, and is not `plot_0`. `eval` of the in-page expression is the same path `getStudySeries` ships. This is the regression lock for Block 2; a subset-index walk would fail `notEqual(..., plot_0)` inverted.

### [Block 30 — target_reads.test.js:303](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/target_reads.test.js#L303)

Chart-region capture with an occluded pane-canvas must throw `TV_CHART_CLIP_BLOCKED`, take no bitmap, query pane-canvas, and not fall back to chart-container. That last assertion is what keeps Block 1 from clipping overlay chrome. Target-scoped client injection is the existing capture test harness.

### [Block 31 — ui_verbs.test.js:7](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/ui_verbs.test.js#L7)

`setInput` is imported so match-only and Monaco-skip cases can run without going through the MCP layer. The new describes are Blocks 32–33 of this file (Close pick and setInput).

### [Block 32 — ui_verbs.test.js:29](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/ui_verbs.test.js#L29)

The expression for Close must contain `closeSurfaceOf` / `pickClose`. A DOM stub with overlay Close first and wizard Close second must still return the wizard node; `surface: delete_confirm` must return Cancel. First-aria-label querySelector would pick overlay and fail. This locks Block 3.

### [Block 33 — ui_verbs.test.js:128](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/ui_verbs.test.js#L128)

A missed match rejects with no fallback flag. The default expression includes `changes you made`, `isMonaco`, and `inputarea`, and does not mention fallback. A lone visible Monaco textarea must keep its source and not focus. This locks Blocks 17–18: publish notes cannot land in the editor when the wizard field is absent.

## Fix-cycle blocks

Reviewed commit after [CR-1](10-code-review.md#cr-1--library-compile-still-adds-to-chart-when-pine-save-is-missing): `5b52307b7ceef50e4098baa6115284074b732baa`.

### [Block 34 — pine.js:816](https://github.com/m2ux/tradingview-mcp/blob/5b52307b7ceef50e4098baa6115284074b732baa/src/core/pine.js#L816)

When the buffer is a library, the page script clicks Pine Save or returns null. Add and Update are not in that arm. This is the page half of the no-study invariant.

### [Block 35 — pine.js:827](https://github.com/m2ux/tradingview-mcp/blob/5b52307b7ceef50e4098baa6115284074b732baa/src/core/pine.js#L827)

The host refuses when `preferSave` is set and the click was not Pine Save. Enter is not sent. A hostile or stale page script that still returned Add cannot report success.

### [Block 36 — issue26_pine_friction.test.js:361](https://github.com/m2ux/tradingview-mcp/blob/5b52307b7ceef50e4098baa6115284074b732baa/tests/issue26_pine_friction.test.js#L361)

The compile stub matches the page contract: a library with Save missing returns null and does not record an Add click.

### [Block 37 — issue26_pine_friction.test.js:396](https://github.com/m2ux/tradingview-mcp/blob/5b52307b7ceef50e4098baa6115284074b732baa/tests/issue26_pine_friction.test.js#L396)

Library source, Save absent, Add present → `success: false`, empty click log, `study_added` not true. This is the Save-missing path [TR-1](10-test-suite-review.md#tr-1--library-compile-untested-when-pine-save-is-absent) required.
