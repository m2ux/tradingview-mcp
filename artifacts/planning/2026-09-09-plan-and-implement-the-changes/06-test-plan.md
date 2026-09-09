# Test Plan: Pine live-edit loop

> **Ticket:** [#32](https://github.com/m2ux/tradingview-mcp/issues/32) · **PR:** [#33](https://github.com/m2ux/tradingview-mcp/pull/33)

## Overview

This test plan validates that a live Pine library update on TradingView Desktop reads the right plot slots, persists a library without adding it to the chart, fills the publish wizard without writing the editor, classifies Close surfaces, preserves a dirty bind buffer, resumes a leftover update wizard, and refuses overlay chart clips.

Key changes to validate:
1. `getStudySeries` — filtered ids keep full-meta slot values
2. `setInput` — missed match errors; Monaco is not a fallback
3. `captureScreenshot` — covering overlay is not a successful chart clip
4. Close classification — overlay vs wizard vs delete-confirm
5. `smartCompile` — library clicks Pine Save
6. `bindScript` — dirty buffer refused without `reload`
7. `publishScript` — leftover wizard is resumed

## Planned Test Cases

| Test ID | Objective | Type |
|---------|-----------|------|
| PR33-TC-01 | Verify filtered `plot_9` equals unfiltered `plot_9` on the same fixture row | Unit |
| PR33-TC-02 | Verify `setInput` errors when `match` misses and does not commit Monaco `textarea.inputarea` | Unit |
| PR33-TC-03 | Verify chart-region capture fails when a covering dialog occludes `pane-canvas` | Unit |
| PR33-TC-04 | Verify Close by aria-label hits wizard Close, not overlay Close, and Cancel is the delete control | Unit |
| PR33-TC-05 | Verify `smartCompile` on a `library(` buffer clicks Pine Save and does not report `study_added` | Unit |
| PR33-TC-06 | Verify `smartCompile` on an indicator still prefers Add to chart | Unit |
| PR33-TC-07 | Verify `bindScript` with a dirty same-identity buffer refuses without `reload: true` | Unit |
| PR33-TC-08 | Verify `bindScript` with `reload: true` injects facade source | Unit |
| PR33-TC-09 | Verify `publishScript` with an open `pine_publish_wizard` does not click Publish script again | Unit |
| PR33-TC-10 | Verify unchanged published version still returns `TV_PINE_PUBLISH_STALE` | Unit |
| PR33-TC-11 | Verify filtered series + library Save + wizard fill on a published private library | Manual |

*Detailed steps, expected results, and source links will be added after implementation.*

## Acceptance Criteria Matrix

| Requirement | Acceptance Criterion | Verifying Test Cases |
|-------------|----------------------|----------------------|
| Filtered series values | `plot_N` matches unfiltered same id | PR33-TC-01 |
| Library compile persist | `persisted: true`, `study_added: false`, Pine Save | PR33-TC-05, PR33-TC-06 |
| Wizard input | Cannot write Monaco; notes match change-description only | PR33-TC-02 |
| Dialog classify | Overlay Close, wizard Close, Delete this publication distinct; Cancel safe | PR33-TC-04 |
| Bind vs dirty buffer | No facade overwrite without explicit reload | PR33-TC-07, PR33-TC-08 |
| Leftover update wizard | Resumes; no stacked wizard; stale snapshot still fails | PR33-TC-09, PR33-TC-10 |
| Chart screenshot | Covering overlay is not a successful chart capture | PR33-TC-03 |

## Running Tests

*Commands will be added after implementation. Expected gate:*

```bash
node --test tests/study_series.test.js tests/ui_verbs.test.js tests/pine_workflow.test.js tests/pine_write_path.test.js
```
