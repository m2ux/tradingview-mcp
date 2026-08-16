# Outstanding work — continuation brief

`feat/capture-snapshot` tracks `origin/feat/capture-snapshot`. #23's first landing is `524b657`. This session's Desktop 3.3 probe / exact `tab_new` / `ELECTRON_RUN_AS_NODE` strip is **uncommitted** in the main repo working tree.

## Must do

### 1. Land the Desktop 3.3 name-probe fix

Commit and push (stage only these unless the user asks to bundle more):

- `src/connection.js` — `chartList` map, `layoutNameFromChartList`, `getLayoutNameForTarget` via `makeScopedClient`
- `src/core/ui.js` — `layout_list` live name from `chartList` when `currentChart()` is missing
- `src/core/tab.js` — exact-title-first picker + `preferExactLayoutName`
- `src/core/launch.js` — strip `ELECTRON_RUN_AS_NODE` from TV spawn env
- `tests/issue23_layout_target.test.js` — map + exact-name unit tests

Do **not** stage `AGENTS.md` / `CLAUDE.md` GitNexus comment blocks, `.worktrees/`, or an unrelated `.engineering` submodule bump unless the planning notes are meant to land with it.

Suggested commit:

```
fix(target): read layout names from load-service chartList on Desktop 3.3
```

Restart the TradingView MCP server after push — the already-running process still has the old `currentChart()` probe (`tab_list.layout_name` stays null until reload).

PR: keep amending [#22](https://github.com/m2ux/tradingview-mcp/pull/22). Target fork `m2ux/tradingview-mcp`, REST only. Host shell + unset `GH_TOKEN`/`GITHUB_TOKEN`.

### 2. Screenshot corroboration (still failing)

Named-target **data** for OIL_IG passed on 2026-08-16:

- `tab_list` (new probe): `gfFTnKHh` → `layout_name: "OIL_IG"`
- `findTargetByRef("OIL_IG")` → that chart_id
- compact `captureSnapshot({ target: "OIL_IG", include_series: false, include_screenshot: false })` → `TVC:UKOIL` @ 15, last close 88.81, 9 studies, 33 drawings

CDP `Page.captureScreenshot` hung (script 20–40s; MCP `-32001`) both with `target` and after `attachChart("gfFTnKHh")`. `method: "api"` only fires TradingView's own save UI (no `file_path`).

Retry after draining leftover CDP sockets (or a TV restart). Prefer `region: "full"`. Then compare screenshot vs the data payload above.

### 3. Close the loop

- Comment on [#23](https://github.com/m2ux/tradingview-mcp/issues/23) with the live data result and the screenshot timeout.
- Close #23 only if `target: "OIL_IG"` captures that chart **and** the screenshot matches the payload.

## Should do (same continuation if time)

| Item | Why |
|------|-----|
| `Page.captureScreenshot` hang | Blocks the original corroboration. Likely leftover debugger sessions or a background-tab clip. Bound the protocol call with `TV_CDP_TIMEOUT_MS`. |
| `layout_switch` does not retarget the shared CDP client | Reported success on AF4G/OIL_IG; subsequent `chart_get_state` stayed on `BATS:SPCX`. Either reconnect after switch or document that `target`/`tv_attach` is required. |
| `layout_list` live-corrects **only the current** layout | Closed layouts still show last-save symbol/resolution. Agents must not set symbol from those fields. Either probe open tabs or label non-current rows `stale: true`. |
| `capture_snapshot` + `include_series: true` MCP timeout | Hit `-32001` on UKOIL 30S (~339 bars × N studies). Cap series depth, default `include_series` false on dense TFs, or stream/chunk. OIL_IG @ 15 returned 1661 visible bars — do not enable series on that window. |
| Mixed PR #22 | Snapshot + pine #21 + #23 on one branch. Split if review is blocked. |
| Duplicate `chart_id` rows in `tab_list` | Live list showed `CzpBLt7Z` / `OIL_IG_2` twice (two CDP page targets, same URL). |

## Nice to have

| Item | Why |
|------|-----|
| Screenshot quality | `region: chart` clip was washed-out / hard to read. Consider `full` default for corroboration, or a higher scale. |
| `layout` param alias | Issue asked for `capture_snapshot({ layout: "OIL_IG" })`. Today it is `target: "OIL_IG"` / `layout:OIL_IG`. |
| Agent MCP cache | After server restart, a chat can miss new tools until Reload Window / new chat / Cursor relaunch. |
| Smoke test hang | `tests/smoke_issue23.test.js` finishes TAP then keeps the event loop (open CDP sockets). Call `disconnect()` in `after`. |
| Unit-test screenshot path | `captureScreenshot` no-target uses module-level `getClient()` (not injectable). |

## Hard constraints for the next agent

- Never set symbol/timeframe from `layout_list` metadata for a layout that is not `is_current`.
- Never treat `layout_switch` success as “I am now reading that chart” until `chart_get_state` / `tab_list.layout_name` agrees.
- `tab_new({ layout })` is the open-a-closed-layout path; it is DOM/picker, not headless. Exact title must win over substring.
- Launch TradingView from Cursor with `env -u ELECTRON_RUN_AS_NODE` until the launch.js strip is on the running server.
- GitHub: REST only, `--repo m2ux/tradingview-mcp`, host permissions, no `GH_TOKEN` unless a known PAT.
- Do not open a PR against `tradesdontlie/tradingview-mcp` unless asked.

## Suggested first commands

```bash
cd /home/mike1/projects/dev/tradingview-mcp
git status -sb
git diff --stat
node --test tests/issue23_layout_target.test.js tests/capture_snapshot.test.js tests/structured_errors.test.js
# then stage the 3.3 probe files only, commit, push, restart MCP, live screenshot
```
