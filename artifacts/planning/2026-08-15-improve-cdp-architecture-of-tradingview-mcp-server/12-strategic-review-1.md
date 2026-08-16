# Strategic Review

> strategic-review · Improve CDP Architecture of TradingView MCP Server · main → chore/24-improve-cdp-architecture · 2026-08-16 · Agent · what was walked: [method record](12-strategic-review-1-method.md)

**Diff:** 23 files, +612 / -439

## Findings

### SR-1 — empty src/.gitkeep from the scaffold commit

**Category:** Orphaned Infrastructure

**Severity:** Low

**Description:** [src/.gitkeep](https://github.com/m2ux/tradingview-mcp/blob/9f560ec959a6b46e34dafa9cd84bbc3ef1db9900/src/.gitkeep) is a zero-byte add from the scaffold commit. `src/` already holds the server tree, so the file does not keep a directory and does not support R1–R5.

**Action:** Remove

**Rationale:** An empty keep-file next to a populated tree is leftover scaffold, not a required change.

### SR-2 — unused acquireScopedClient borrow helper

**Category:** Orphaned Infrastructure

**Severity:** Low

**Description:** [acquireScopedClient](https://github.com/m2ux/tradingview-mcp/blob/9f560ec959a6b46e34dafa9cd84bbc3ef1db9900/src/connection.js#L259) is exported as a borrow-and-release handle, and its comment names `withTargetEvaluate` as the caller. That caller uses `makeScopedClient` plus `evictScopedClient` instead. No other module imports the helper.

**Action:** Remove

**Rationale:** The evict-before-close path superseded the borrow API. Leaving an unused export invites a second client-lifecycle contract.

## Cleanup Actions Taken

| Action | Files Affected | Commit |
|--------|----------------|--------|
| Remove empty scaffold keep-file | src/.gitkeep | 385c7b9 |
| Remove unused borrow helper | src/connection.js | 385c7b9 |

## Review Result

**Outcome:** Minor Cleanup Completed

**Rationale:** The review-findings gate chose selective-fixes. Both named findings were already applied in 385c7b9, so no further cleanup remains.

**Next Step:** Proceed to finalize
