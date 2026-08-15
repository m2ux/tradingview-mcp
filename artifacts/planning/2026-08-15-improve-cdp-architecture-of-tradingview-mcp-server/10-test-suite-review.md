# Test Suite Review Report

> Improve CDP Architecture of TradingView MCP Server · #24 - Improve CDP architecture · 2026-08-15 · [Test Suite Review](https://github.com/m2ux/workflow-server/blob/workflows/work-package/resources/test-suite-review.md) Agent · what was walked: [method record](10-test-suite-review-method.md)

## Summary Assessment

**Overall Test Quality:** 4/5 — behavior-focused, well-isolated suite with strong high-value patterns (decoy-based process-matching, real-CDP stub integration, DI-seam unit tests); one diff-aware coverage gap on the change's central new machinery.

## Findings

### TR-1 — the scoped-client pool state transitions are untested

**Category:** Coverage Gap

**Severity:** Low

**Description:** The pooled-connection machinery added in [src/connection.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/connection.js#L177) — `makeScopedClient` LRU refresh, `_pruneScopedPool` eviction beyond `TV_CDP_POOL_SIZE`, the `_isLive` stale-socket drop, `acquireScopedClient` borrow/release, and `drainScopedPool` — has no test that drives its own state transitions. The existing [with_target_evaluate.test.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/tests/with_target_evaluate.test.js#L28) exercises the pool only as a side effect of `withTargetEvaluate`, against a stub that always yields a live socket; it never forces an eviction, a stale entry, or a pool overflow.

**Impact:** The pool is the work package's central change and the fix for the multi-tab connection wedge. A regression in eviction order, liveness detection, or the drain-on-disconnect path would pass the current suite and reappear only as the wedge the change was built to prevent — the highest-risk code in the diff is the least directly verified.

**Recommendation:** Add `tests/scoped_pool.test.js` using the `tests/cdp_stub.mjs` seam: assert a cache hit refreshes LRU order; the oldest entry is evicted once the pool exceeds its bound; a closed socket is dropped and re-opened rather than handed out; `drainScopedPool` closes every retained client; and `acquireScopedClient().release()` closes the borrowed socket without leaving a pool reference.

## Review Outcome

**Result:** Acceptable

**Summary:** The suite is relevant, well-organized, and free of the flagged anti-patterns — its assertions are behavior-focused and its isolation seams are used consistently. The single Low coverage gap on the pool primitives should be closed before the change is relied on, but does not block merge.
