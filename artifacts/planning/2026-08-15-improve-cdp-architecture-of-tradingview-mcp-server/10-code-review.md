# Code Review Report

> code-review · PR #25 (chore/24-improve-cdp-architecture) · 2026-08-15 · 23 files reviewed · methodology: [Rust/Substrate Code Review](https://github.com/m2ux/workflow-server/blob/workflows/work-package/resources/rust-substrate-code-review.md) · what was walked: [method record](10-code-review-method.md)

## Summary

**Overall Quality:** 4/5 — Critical: 0 · High: 0 · Medium: 0 · Low: 1

## Findings

### CR-1 — the scoped-client pool primitives have no direct unit test

**Category:** Testing

**Severity:** Low

**Description:** The new pooled-connection machinery in [src/connection.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/connection.js#L177) — `makeScopedClient` (LRU refresh on hit, stale-entry drop, `_pruneScopedPool` eviction of the least-recently-used entry), `acquireScopedClient` (borrow-then-release), `drainScopedPool`, and `evictScopedClient` — is exercised only indirectly through the `withTargetEvaluate` and `target_reads` stub tests. No test drives the pool's own state transitions: LRU re-ordering on a cache hit, eviction when the pool exceeds `TV_CDP_POOL_SIZE`, the stale-socket path in `_isLive`, or that `drainScopedPool` closes every retained socket.

**Impact:** The pool is the work package's central change (R1) and the fix for the 2026-08-14 multi-tab connection wedge. A regression in its eviction or liveness logic (e.g. a stale socket handed out as live, or the pool growing past its bound) would not be caught by the current suite and would surface only as the wedge the change was built to prevent.

**Recommendation:** Add a focused `tests/scoped_pool.test.js` that stubs `chrome-remote-interface` (the existing `tests/cdp_stub.mjs` seam) and asserts: a hit refreshes LRU order; the pool evicts the oldest entry beyond the bound; a closed socket is dropped and re-opened; `drainScopedPool` closes all retained clients; `acquireScopedClient().release()` closes the borrowed socket without leaving a pool reference.

## Strengths

- **Clean stratified layering.** The refactor yields a legible transport → protocol → domain stack. [src/core/protocol.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/core/protocol.js#L1) confines raw `Page.*`/`Input.*` calls to one module, so the CDP-domain footprint is greppable and future protocol changes have a single edit site.
- **The pool's borrow contract is honoured at every call site.** [withTargetEvaluate](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/connection.js#L294) and [capture.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/core/capture.js#L108) both `evictScopedClient` before closing in a `finally`, so the pool never retains a reference to a socket a caller has closed — the invariant the final commit (144c1b0) was landed to enforce.
- **Test seams preserved.** The `_deps.makeScopedClient` injection in capture.js and the `_resolveLaunchDeps` seam in [launch.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/core/launch.js#L14) keep every side effect substitutable; the launch module's MSIX fallback and kill-existing semantics are directly tested through them.
- **Fail-safe update check.** [update_check.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/src/core/update_check.js#L15) never throws — any failure (offline, detached HEAD, non-git install) resolves to `null`, so the update probe cannot break the health check.
- **Security invariant retained.** `assertLoopbackHost` still refuses a non-loopback CDP endpoint without an explicit `TV_ALLOW_REMOTE_CDP=1` opt-in, and the MSIX copy-local workaround carries a clear why-comment naming the issues it addresses.

## Review Outcome

**Result:** Acceptable

**Summary:** The refactor achieves its stated aim — a stratified CDP layer stack with the connection-wedge fix at its centre — with sound layering, honoured borrow invariants, and preserved test seams. The single Low finding (pool-primitive coverage) is a test-gap to close, not a defect; it does not block merge.
