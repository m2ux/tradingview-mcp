# Implementation plan — issue #26

## Acceptance (from the issue)

- `pine_publish` on an already-published library uses Update-existing and fails if `published_version` does not change when source changed
- `tv_ui_state` lists the Pine publish wizard when it is open
- `pine_bind` refuses or switches identity; never injects into the wrong header
- `pine_open` accepts `script_id` and dismisses the Open dialog on success
- persist-match ignores CRLF/LF

## Non-goals

- Date-range **All** → `1M` interval footgun (TradingView UI)
- `diff_study_series.mjs` window-slide vs frozen overlap (harness)

## Design notes

### 1. `publishScript`

Before opening the wizard, read `published_version` from the published facade list (same merge as `pine_list_scripts`). After the wizard opens, if **Update existing script** is visible, force `mode: 'update'`.

Update path: click Update existing → fill release notes if provided → Continue → privacy → **Publish new version**.

Create path: only when no prior `published_version` and no Update control.

Fail (do not report success) when:

- `published_version` was set but Update existing was not clicked
- After completion, published list still shows the same version (when we can re-read it)

Return `{ success, mode: 'update'|'create', published_version, published_version_before, pubId, version }`.

### 2. Dialog probe (shared)

`getVisibleDialogs` currently requires `role=dialog` / `js-dialog` plus “publish new/existing script”. The leftover **Update 'RSIZoneDivEng' library** surface does not match, so `tv_ui_state` is blind.

Expand `isDialogSurface` to also match:

- `Update '…' library|script|indicator|strategy`
- `Publish new version` / `Final touches` / `Release notes`
- `Open my script`
- `Update existing script`

Classify each dialog: `{ kind, step, title, buttons, text }`.

`uiState` uses the same collector so health and pine stay in sync.

### 3. `bindScript`

`openScript` is no longer best-effort. After open, assert header == target. If mismatch, return `success: false` and **do not** call `setSource` (especially not the unguarded fallback).

### 4. `openScript`

- `name` optional when `script_id` is set (facade lookup supplies the exact name).
- Prefer fiber `scriptItem.id` match in the Open picker when `script_id` is present.
- After identity switch, `dismissBlockingDialogs` including **Close menu** by text.
- Leftover picker → throw / tool result `{ success: false, blocked_dialog }`.

HIGH-risk symbol: keep `{ name }` working for `copyScript` / `publishScript` / CLI.

### 5. Persist-match

`normalizePineNewlines` (`\r\n` / `\r` → `\n`) before every buffer↔cloud compare in `save` and `bindScript`.

`smartCompile` already returns `button_clicked: 'Pine Save'`. Also return `clicked` and `persisted: true` when that button was the compile path.

### 6. Published exports

- `readScript({ scope: 'saved'|'published', version })` — published lookup uses `filter=published` and `/get/<id>/<N>`.
- `listLibraryExports` — parse `export type|enum|method|name` from that source.
- New tool `pine_library_exports` (88 → 89 tools).

## Test plan (unit, mocked `_deps`)

- `normalizePineNewlines` / persist-match CRLF vs LF → verified
- `bindScript` refuses inject when header ≠ target
- `openScript` accepts `script_id`; leftover Open dialog → `blocked_dialog`
- `publishScript` update mode requires Update existing; same version after → fail
- `classifyPublishWizard` / dialog probe expression covers Update-library title
- `extractExportedNames` on a sample library source
- `readScript` published scope hits published list + versioned get

## Files

- `src/core/pine_ui.js` — newline helper, export parser, dialog classify, dismiss Close menu, lookup filter, open-by-id
- `src/core/pine.js` — save / bind / open / publish / smartCompile / readScript / listLibraryExports
- `src/core/health.js` — uiState uses shared dialog collector
- `src/tools/pine.js`, `src/tools/health.js`, `src/cli/commands/pine.js`
- `src/server.js`, `AGENTS.md`, `CLAUDE.md`, `docs/tool-registry.md`
- `tests/pine_write_path.test.js`, `tests/pine_workflow.test.js`, new `tests/issue26_pine_friction.test.js`
