# Code Review Method

> code-review method · PR #33 · 2026-09-09 · findings: [code review report](10-code-review.md)

## Scope Walked

Authored surface is `git diff main...HEAD` on `fix/32-pine-live-edit-loop-wrong-plot-values` at `7cc922312381b5897f72635a2a88136b79763848` (15 files, 33 hunks). Session `changed_files` was empty; the walk used that three-dot range and `changed_paths`.

Changed symbols reviewed with GitNexus `context` and `impact` `{direction: upstream, repo: tradingview-mcp}`: `getStudySeries` (LOW; `registerDataTools`, capture scripts), `findElementExpression` (LOW; `click`, `fiberAction`, `registerUiTools`), `smartCompile` (LOW; CLI pine — MCP registrar absent from the index at `a329f68`), `bindScript`, `publishScript`, `setInput`, `captureScreenshot`, `classifyUiDialog`. The GitNexus index is the main checkout at `a329f68`, not this worktree; caller sets are graph edges on that index plus the registrar files in the diff.

`project_type` is `other`. Substrate pallet, weight, and migration checks were not applied.

## Sweeps

- **Diff-to-symbol map.** GitNexus `detect_changes` compare vs `main` on the indexed checkout returned only `AGENTS.md` / `CLAUDE.md` sections. The authored map is the 15-file three-dot diff listed in [10-change-block-index.md](10-change-block-index.md).
- **Error handling.** Typed codes `TV_CHART_CLIP_BLOCKED` and `TV_PINE_DIRTY_BUFFER` are used on the new refuse paths. `setInput` throws on a miss. Clean: no new uncaught unwrap of page eval.
- **Close / fill / clip / bind / publish.** Each matches the ticket mechanism. Clean.
- **Producer/clearer on "study on chart" for library compile.** Producers: [smartCompile](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L819) Add click, Update click, Enter fallback. Clearer: none on this function. Unmatched on the Save-missing path — [CR-1](10-code-review.md#cr-1--library-compile-still-adds-to-chart-when-pine-save-is-missing).
- **Producer/clearer on editor buffer.** Producer: `setSource` in `bindScript`. Clearer: dirty refuse without `reload`. Matched.
- **Producer/clearer on screenshot bitmap.** Producer: CDP capture. Clearer: `TV_CHART_CLIP_BLOCKED` before the shot. Matched.
- **Rust / Substrate categories.** Not applicable.

## Compliance

| Category | Status | Score |
|----------|--------|-------|
| Substrate Framework | N/A | — |
| Architecture | ✗ | CR-1 |
