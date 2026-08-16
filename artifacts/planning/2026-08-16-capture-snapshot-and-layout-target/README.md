# Capture snapshot + layout-title targeting — August 2026

> Feature + follow-up · Started 2026-08-14 · **Status:** #23 committed on `feat/capture-snapshot`; Desktop 3.3 name-probe fix in working tree; screenshot corroboration still open

> **Note:** effort estimates are agentic (AI-assisted) development time plus separate human review time.

## 🎯 Executive Summary

Adds `capture_snapshot`, a one-call headless read of the displayed chart (visible time & price range, OHLCV over visible bars, studies + series, drawings, Pine graphics, screenshot). A follow-up ([#23](https://github.com/m2ux/tradingview-mcp/issues/23)) makes read/capture tools resolve a chart by **layout/tab title** so an agent can say `target: "OIL_IG"` instead of guessing chart_ids or trusting stale `layout_list` symbols.

`capture_snapshot` and the first #23 targeting commit are on `feat/capture-snapshot` / PR [#22](https://github.com/m2ux/tradingview-mcp/pull/22). Live check on Desktop 3.3.0 showed `currentChart()` is gone, so `layout_name` was always null until the load-service `chartList` probe. Named-target **data** for OIL_IG succeeded (`TVC:UKOIL`); CDP `Page.captureScreenshot` timed out, so visual corroboration is still open.

## Problem Overview

Two stacked problems:

1. **No one-call snapshot.** Agents had to choreograph `quote_get` + `data_get_*` + `capture_screenshot` to describe a chart. That sequence is easy to desync and expensive in context.
2. **No title → tab resolution.** `target` only accepted chart_id / URL / CDP id. `tab_list` titles were generic (`TradingView`). `layout_list.symbol` is the value at last save and can be wrong (OIL_IG listed as `BATS:CLSK` while live is `TVC:UKOIL`). Acting on that metadata hijacked the wrong instrument.

## Solution Overview

- `capture_snapshot` in the capture domain: three page-side `evaluate()` readers + reuse of `captureScreenshot`. Anchored to the visible time range.
- `findTargetByRef` extended: `layout:<name>` (name-only) and bare layout/tab names, matched against a live per-tab name map.
- Desktop 3.3+: names come from `_loadChartService._state.chartList` keyed by chart_id (not `currentChart()`, which is gone).
- `tab_list` enriched with `layout_name`.
- `layout_list` overwrites symbol/resolution for the **currently open** layout with live chart values and flags `is_current`.
- Structured errors (`TV_TAB_NOT_OPEN`, `TV_TARGET_NOT_FOUND`) with a `tab_new({ layout })` hint when the named layout is saved but not open. `tab_new` prefers an exact layout-list title so `OIL_IG` does not open `OIL_IG_2`.

## 📊 Progress

| # | Item | Description | Status |
|---|------|-------------|--------|
| 1 | `capture_snapshot` core + tool | Headless one-call snapshot | ✅ committed `fce6b72` |
| 2 | Unit tests for snapshot | `tests/capture_snapshot.test.js` (7) | ✅ committed |
| 3 | Docs / tool count | server.js, CLAUDE.md, AGENTS.md (87→88) | ✅ committed |
| 4 | PR opened | [#22](https://github.com/m2ux/tradingview-mcp/pull/22) on `feat/capture-snapshot` | 🟡 open, mixed with #21 pine work |
| 5 | Issue #23 filed | Title → tab resolution | ✅ [#23](https://github.com/m2ux/tradingview-mcp/issues/23) (still open) |
| 6 | #23 implementation | name match, `tab_list.layout_name`, live `layout_list` current row, structured errors | ✅ committed `524b657` |
| 7 | #23 unit + smoke tests | `tests/issue23_layout_target.test.js`, `tests/smoke_issue23.test.js` | ✅ committed; smoke 3/4 pass (current-layout skip until 3.3 probe) |
| 8 | Desktop 3.3 name probe | `chartList` map + exact `tab_new` + strip `ELECTRON_RUN_AS_NODE` | 🟡 in working tree (this session) |
| 9 | Live named-layout data snapshot | `target: "OIL_IG"` → `gfFTnKHh` / `TVC:UKOIL` @ 15 | ✅ data path 2026-08-16 |
| 10 | Screenshot corroboration | CDP `Page.captureScreenshot` timed out (`-32001`) | ❌ still open |
| 11 | Close #23 / land PR | Push 3.3 probe; close only after screenshot matches | ⬚ pending |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked · ⊘ cancelled

## 🔗 Links

| Resource | Link |
|----------|------|
| Snapshot commit | `fce6b72` on `feat/capture-snapshot` |
| Targeting commit | `524b657` |
| Pull request | [#22](https://github.com/m2ux/tradingview-mcp/pull/22) (also carries #21 pine fail-loud) |
| Targeting issue | [#23](https://github.com/m2ux/tradingview-mcp/issues/23) |
| Completed work | [01-work-completed.md](01-work-completed.md) |
| Outstanding work | [02-outstanding.md](02-outstanding.md) |

## Continuation entry point

Start from [02-outstanding.md](02-outstanding.md). Restart the TradingView MCP server after the 3.3 probe lands so `tab_list.layout_name` is non-null. Do **not** set symbol from non-current `layout_list` metadata.
