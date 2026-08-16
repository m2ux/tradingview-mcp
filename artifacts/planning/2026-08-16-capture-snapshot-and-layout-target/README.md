# Capture snapshot + layout-title targeting — August 2026

> Feature + follow-up · Started 2026-08-14 · **Status:** Implementation in working tree; live verification and landing still open

> **Note:** effort estimates are agentic (AI-assisted) development time plus separate human review time.

## 🎯 Executive Summary

Adds `capture_snapshot`, a one-call headless read of the displayed chart (visible time & price range, OHLCV over visible bars, studies + series, drawings, Pine graphics, screenshot). A follow-up ([#23](https://github.com/m2ux/tradingview-mcp/issues/23)) makes read/capture tools resolve a chart by **layout/tab title** so an agent can say `target: "OIL_IG"` instead of guessing chart_ids or trusting stale `layout_list` symbols.

The snapshot tool is committed on `feat/capture-snapshot`. The #23 targeting work is implemented in the working tree but **not committed**. The original live check — snapshot a named chart and corroborate the screenshot against the data — has not been completed.

## Problem Overview

Two stacked problems:

1. **No one-call snapshot.** Agents had to choreograph `quote_get` + `data_get_*` + `capture_screenshot` to describe a chart. That sequence is easy to desync and expensive in context.
2. **No title → tab resolution.** `target` only accepted chart_id / URL / CDP id. `tab_list` titles were generic (`TradingView`). `layout_list.symbol` is the value at last save and can be wrong (OIL_IG listed as `BATS:CLSK` while live is `TVC:UKOIL`). Acting on that metadata hijacked the wrong instrument.

## Solution Overview

- `capture_snapshot` in the capture domain: three page-side `evaluate()` readers + reuse of `captureScreenshot`. Anchored to the visible time range.
- `findTargetByRef` extended: `layout:<name>` (name-only) and bare layout/tab names, matched against a live per-tab probe (`currentChart()` / page title).
- `tab_list` enriched with `layout_name`.
- `layout_list` overwrites symbol/resolution for the **currently open** layout with live chart values and flags `is_current`.
- Structured errors (`TV_TAB_NOT_OPEN`, `TV_TARGET_NOT_FOUND`) with a `tab_new({ layout })` hint when the named layout is saved but not open.

## 📊 Progress

| # | Item | Description | Status |
|---|------|-------------|--------|
| 1 | `capture_snapshot` core + tool | Headless one-call snapshot | ✅ committed `fce6b72` |
| 2 | Unit tests for snapshot | `tests/capture_snapshot.test.js` (7) | ✅ committed |
| 3 | Docs / tool count | server.js, CLAUDE.md, AGENTS.md (87→88) | ✅ committed |
| 4 | PR opened | [#22](https://github.com/m2ux/tradingview-mcp/pull/22) on `feat/capture-snapshot` | 🟡 open, mixed with #21 pine work |
| 5 | Issue #23 filed | Title → tab resolution | ✅ [#23](https://github.com/m2ux/tradingview-mcp/issues/23) (still open) |
| 6 | #23 implementation | `findTargetByRef` name match, `tab_list.layout_name`, live `layout_list` current row, structured errors | 🟡 **in working tree, uncommitted** |
| 7 | #23 unit + smoke tests | `tests/issue23_layout_target.test.js`, `tests/smoke_issue23.test.js` | 🟡 uncommitted |
| 8 | Live named-layout snapshot + screenshot corroboration | Original user request (AF4G then OIL_IG) | ❌ not done — blocked by targeting until #23 lands and MCP client sees it |
| 9 | Close #23 / land PR | Commit, push, close issue | ⬚ pending |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked · ⊘ cancelled

## 🔗 Links

| Resource | Link |
|----------|------|
| Snapshot commit | `fce6b72` on `feat/capture-snapshot` |
| Pull request | [#22](https://github.com/m2ux/tradingview-mcp/pull/22) (also carries #21 pine fail-loud) |
| Targeting issue | [#23](https://github.com/m2ux/tradingview-mcp/issues/23) |
| Completed work | [01-work-completed.md](01-work-completed.md) |
| Outstanding work | [02-outstanding.md](02-outstanding.md) |

## Continuation entry point

Start from [02-outstanding.md](02-outstanding.md). Do **not** trust `layout_list.symbol` for a closed layout. Target by name (`target: "OIL_IG"` or `layout:OIL_IG`) after the #23 work is committed and the MCP server/client have re-handshaked.
