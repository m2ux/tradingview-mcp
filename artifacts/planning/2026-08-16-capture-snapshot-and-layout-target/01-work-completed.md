# Work completed

Branch: `feat/capture-snapshot` (tracks `origin/feat/capture-snapshot`).
Repo: `m2ux/tradingview-mcp`. Base: `main`.

## 1. `capture_snapshot` (committed `fce6b72`)

One-call headless snapshot of the **currently displayed** chart, anchored to the visible time range.

| Piece | Location |
|-------|----------|
| Core | `src/core/capture.js` — `captureSnapshot()` |
| Tool | `src/tools/capture.js` — `capture_snapshot` |
| Tests | `tests/capture_snapshot.test.js` (7 unit tests, mocked `evaluate`) |
| Docs | `src/server.js` instructions, `CLAUDE.md`, `AGENTS.md` (87→88 tools) |

**Payload (defaults):**

- `visible_range` `{from,to}` unix seconds from `chart.getVisibleRange()`
- `price_range` `{high,low}` — high/low envelope over those bars (no priceScale API)
- `ohlcv` — bars whose time is inside the visible window
- `studies` / `study_count` — `getAllStudies()`
- `study_series` — per-bar plots aligned to `[from,to]` (`include_series`, default true)
- `drawings` — `getAllShapes()`
- `pine_graphics` — lines / labels / tables / boxes in one evaluate
- `screenshot` — `{file_path, region, size_bytes, method}` via existing `captureScreenshot` (default region `chart`)

**Params:** `region`, `filename`, `include_series`, `include_screenshot`, `wait_for_render`, `stabilize_ms`, `target`.

**Design choices (user-confirmed 2026-08-14):**

- Lives in the capture domain, not a new snapshot domain
- OHLCV = visible bars only
- All drawings: user shapes + Pine graphics
- Values + per-bar series (opt out with `include_series: false`)
- JSON result + screenshot `file_path` (no sidecar JSON file)

Three page-side readers (`SNAPSHOT_READ_JS`, `STUDY_SERIES_JS`, `PINE_GRAPHICS_JS`) run as single `evaluate()` calls against the chart model — no DOM/dialogs.

## 2. PR [#22](https://github.com/m2ux/tradingview-mcp/pull/22)

Open against `m2ux/tradingview-mcp` `main`. Head is `feat/capture-snapshot`.

**Two commits on the branch:**

| SHA | What |
|-----|------|
| `461c506` | `fix(pine): fail-loud pine_save, headless discipline, version-history tool (issue #21)` |
| `fce6b72` | `feat(capture): capture_snapshot — one-call headless chart snapshot` |

The PR is mixed. Snapshot-only files in `fce6b72`: `src/core/capture.js`, `src/tools/capture.js`, `src/server.js`, `package.json`, `AGENTS.md`, `CLAUDE.md`, `tests/capture_snapshot.test.js`.

## 3. Issue [#23](https://github.com/m2ux/tradingview-mcp/issues/23) — implemented locally, not committed

Filed after a failed live attempt to snapshot a chart by title. Code is in the working tree (plus untracked files).

### Targeting

`findTargetByRef` (`src/connection.js`) resolution order:

1. `layout:<name>` — name-only (never chart_id / URL)
2. CDP target id
3. chart_id (`/chart/<id>`)
4. URL substring
5. layout/tab name — exact (case-insensitive) then substring, against live `layout_name` then cleaned page title

Live layout name comes from `getLayoutNameForTarget`: scoped CDP evaluate of `TAB_PROBE_JS` (`currentChart()` / `metaInfo`). 1.5s timeout; degrades to `null` (then page title) if a second client cannot attach.

### `tab_list`

Each chart tab now includes `layout_name` (nullable).

### `layout_list`

For the **currently open** layout only: overwrite `symbol` / `resolution` with live chart values; set `is_current`. Adds `current_layout`. Other saved rows still carry last-save metadata.

### Structured errors

New `src/core/err.js` (`tvError` / `TV_ERROR_CODES`). Named-but-closed layout → `TV_TAB_NOT_OPEN` + hint `tab_new({ layout: "<name>" })`. Unmatched target → `TV_TARGET_NOT_FOUND`. `errorResult` surfaces `code`, `resolution`, `hint`.

### Tests (uncommitted)

- `tests/issue23_layout_target.test.js` — mocked fetch/probe
- `tests/smoke_issue23.test.js` — live CDP, skip if 9222 down (`npm run test:smoke`)
- `tests/structured_errors.test.js`
- Wired into `package.json` `test` / `test:smoke`

### Tool descriptions

`target` on `capture_snapshot`, `capture_screenshot`, `chart_get_state`, and data reads now documents layout/tab names and `layout:<name>`.

## 4. What the live session actually proved (2026-08-14)

These are facts from the failed verification, not product claims:

- `layout_switch("AF4G")` / `layout_switch("OIL_IG")` reported success but **did not retarget** the shared CDP client. Subsequent reads stayed on the previously attached tab (`BATS:SPCX`).
- `layout_list` metadata for OIL_IG was **`BATS:CLSK`** while the live layout is **`TVC:UKOIL` @ 30S**. Acting on that field set the wrong symbol.
- After correcting to `TVC:UKOIL` + `30S`, `capture_snapshot` with `include_series: true` **MCP-timed out** (`-32001`). Compact call (`include_series: false`) succeeded.
- Compact snapshot of UKOIL 30S wrote `/home/mike1/projects/dev/tradingview-mcp/screenshots/oil_ig_ukoil.png` (30,956 bytes). Data: 339 bars, price range 88.01–86.69, Volume study only, no Pine graphics/drawings.
- Cursor's **agent tool registry** can stay stale after a server restart; Desktop showed 96 tools while the chat could not see `capture_snapshot` until a later re-handshake. Reload Window is not always enough; a new chat or full Cursor relaunch is.

## 5. Out of scope for this folder

- Pine fail-loud / `pine_script_history` (#21) — already on the same branch as `461c506`; not part of the snapshot/targeting continuation unless the mixed PR is split.
- CDP architecture refactor ([#24](https://github.com/m2ux/tradingview-mcp/issues/24) / [planning](../2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server/README.md)) — separate work package.
