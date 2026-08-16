# Outstanding work — continuation brief

Do these in order. The working tree on `feat/capture-snapshot` is dirty: #23 targeting plus unrelated edits (pine, study, watchlist, e2e, docs). **Stage only the targeting files** unless the user asks to bundle more.

## Must do

### 1. Land issue #23 (uncommitted)

Commit and push the targeting work, then close [#23](https://github.com/m2ux/tradingview-mcp/issues/23) when it is on the PR.

**Intended files (verify with `git diff` before staging):**

- `src/connection.js` — `LAYOUT_TARGET_PREFIX`, `TAB_PROBE_JS`, `getLayoutNameForTarget`, name resolution in `findTargetByRef`
- `src/core/err.js` (new)
- `src/core/tab.js` — `layout_name` on `tab_list`
- `src/core/ui.js` — live overwrite for current `layout_list` row
- `src/tools/_format.js` — surface `code` / `resolution` / `hint`
- `src/tools/capture.js`, `src/tools/chart.js`, `src/tools/data.js`, `src/tools/ui.js`, `src/tools/tab.js` — `target` / `layout_list` copy
- `tests/issue23_layout_target.test.js`, `tests/smoke_issue23.test.js`, `tests/structured_errors.test.js`
- `package.json` — `test` + `test:smoke`
- Docs only if they describe the new `target` contract (`AGENTS.md` / `CLAUDE.md` / `docs/tool-registry.md`)

**Do not blindly add** the other dirty files (`src/core/pine.js`, `pine_ui.js`, `study.js`, `watchlist.js`, `data.js` beyond target-param copy, `tests/e2e.test.js`, `.engineering` submodule bump) unless they are required for #23.

Suggested commit:

```
fix(target): resolve read/capture tools by layout/tab name (#23)
```

PR: either amend [#22](https://github.com/m2ux/tradingview-mcp/pull/22) or open a dedicated PR if the mixed #21+#22+#23 branch is too large. Target fork `m2ux/tradingview-mcp`, REST only (`gh api --method POST repos/m2ux/tradingview-mcp/pulls`). Host shell + unset `GH_TOKEN`/`GITHUB_TOKEN`.

### 2. Live corroboration (the original request)

After the server **and** this chat's MCP client see the new tools:

```
tab_list                         → confirm OIL_IG (or AF4G) has layout_name
capture_snapshot({
  target: "OIL_IG",              // or "layout:OIL_IG"
  region: "chart",
  include_series: false,         // full series timed out on 30S once
  wait_for_render: true
})
```

Then compare **screenshot vs data**:

- Header symbol/timeframe vs `symbol` / `resolution`
- Last candle OHLC vs last `ohlcv` row
- Visible high/low vs `price_range`
- Legend studies vs `studies`
- Any visible lines/labels/boxes vs `pine_graphics` / `drawings`

If the named layout is **not open**, expect `TV_TAB_NOT_OPEN` and open it with `tab_new({ layout: "OIL_IG" })` — that path is **not headless** (layout picker). Do **not** `chart_set_symbol` from `layout_list.symbol`.

Prefer **OIL_IG** (user's last instruction). AF4G has two saved rows; do not guess.

### 3. Close the loop

- Comment on #23 with the live result (pass/fail + screenshot path).
- Close #23 only if `target: "<layout name>"` captured that chart and the screenshot matches the payload.

## Should do (same continuation if time)

| Item | Why |
|------|-----|
| `layout_switch` does not retarget the shared CDP client | Reported success on AF4G/OIL_IG; subsequent `chart_get_state` stayed on `BATS:SPCX`. Either reconnect after switch or document that `target`/`tv_attach` is required. |
| `layout_list` live-corrects **only the current** layout | Closed layouts still show last-save symbol/resolution. Agents must not set symbol from those fields. Either probe open tabs or label non-current rows `stale: true`. |
| `capture_snapshot` + `include_series: true` MCP timeout | Hit `-32001` on UKOIL 30S (~339 bars × N studies). Cap series depth, default `include_series` false on dense TFs, or stream/chunk. |
| Mixed PR #22 | Snapshot + pine #21 + (soon) #23 on one branch. Split if review is blocked. |

## Nice to have

| Item | Why |
|------|-----|
| Screenshot quality | `region: chart` clip was washed-out / hard to read. Consider `full` default for corroboration, or a higher scale. |
| `layout` param alias | Issue asked for `capture_snapshot({ layout: "OIL_IG" })`. Today it is `target: "OIL_IG"` / `layout:OIL_IG`. An explicit `layout` field would match the ticket wording. |
| Agent MCP cache | After server restart, this chat can miss new tools until Reload Window / new chat / Cursor relaunch. Operational, not a server bug. |
| Unit-test screenshot path | `captureScreenshot` no-target uses module-level `getClient()` (not injectable). Snapshot tests use `include_screenshot: false`. |

## Hard constraints for the next agent

- Never set symbol/timeframe from `layout_list` metadata for a layout that is not `is_current`.
- Never treat `layout_switch` success as “I am now reading that chart” until `chart_get_state` / `tab_list.layout_name` agrees.
- `tab_new({ layout })` is the open-a-closed-layout path; it is DOM/picker, not headless.
- GitHub: REST only, `--repo m2ux/tradingview-mcp`, host permissions, no `GH_TOKEN` unless a known PAT.
- Do not open a PR against `tradesdontlie/tradingview-mcp` unless asked.

## Suggested first commands

```bash
cd /home/mike1/projects/dev/tradingview-mcp
git status -sb
git diff --stat
node --test tests/issue23_layout_target.test.js tests/capture_snapshot.test.js tests/structured_errors.test.js
# then stage the #23 files only, commit, push, live smoke:
npm run test:smoke
```
