# Code Review Report

> code-review · PR #33 · 2026-09-09 · 15 files reviewed · methodology: Node adaptation of the work-package code-review guide · what was walked: [method record](10-code-review-method.md)

## Summary

**Overall Quality:** 4/5 — Critical: 0 · High: 0 · Medium: 0 · Low: 1

## Manual Diff Review

> fix/32-pine-live-edit-loop-wrong-plot-values vs main · 15 files reviewed · reviewer: user · No Issues

## Findings

### CR-1 — library compile still adds to chart when Pine Save is missing

**Category:** Architecture

**Severity:** High

**Reachability:** conditional — the Save toolbar control is absent (`saveButton` class missing or `offsetParent` null) while Add to chart remains visible, which is the layout the ticket already names.

**Description:** [smartCompile](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L819) sets `preferSave` for a `library(` buffer, then still runs `if (addBtn) click Add` and, when no button is clicked, [presses Enter](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L827). Both paths produce a study on the chart. GitNexus impact on `smartCompile` is LOW (CLI pine command; the MCP tool is the same function, not in the stale index).

**Impact:** A library compile that cannot see Pine Save repeats the ticket failure: the library lands on a live layout and `study_added` can be true.

**Recommendation:** When `preferSave` is true, click only Pine Save. If it is missing, return `success: false` and do not click Add/Update or send Enter.

**Adjudication:** Fixed in `5b52307`. The page script returns null when Save is missing; the host refuses any non-Save click and does not send Enter.

### CR-2 — leftover process note on uiState

**Category:** Documentation

**Severity:** Low

**Reachability:** reachable — the comment is on every read of [uiState](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/health.js#L173).

**Description:** The note begins with `ponytail:` and restates that Close classification lives on `dialogs[].close_surface`. It is not a safety contract.

**Impact:** Readers treat a process leftover as current design guidance.

**Recommendation:** Drop the comment, or rewrite it as a why-note without the process tag.

## Strengths

Plot values walk full `metaInfo().plots[]` slots. `setInput` errors on a miss and skips Monaco. Close classification prefers wizard over overlay and maps delete-confirm to Cancel. `bindScript` keeps a dirty same-identity buffer unless `reload` is true. `publishScript` resumes a leftover update wizard. Chart-region capture refuses an occluded or missing pane-canvas.

## Review Outcome

**Result:** Acceptable

**Summary:** The library-compile no-study path is Save-or-error after `5b52307`. The remaining finding is a documentation Nit.
