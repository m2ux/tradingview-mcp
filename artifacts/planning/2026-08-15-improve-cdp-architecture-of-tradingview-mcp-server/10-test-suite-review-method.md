# Test Suite Review Method

> test-suite review method · Improve CDP Architecture of TradingView MCP Server · 2026-08-15 · findings: [test suite review report](10-test-suite-review.md)

## Review Scope

| Aspect | Details |
|--------|---------|
| Module(s) Reviewed | `src/connection.js`, `src/core/protocol.js`, `src/core/launch.js`, `src/core/update_check.js`, `src/core/health.js`, `src/wait.js`, and the registry/sleep-adopting domain modules |
| Test Files Analyzed | 24 |
| Total Tests Reviewed | 393 `it()` blocks |
| Testing Framework | `node:test` + `node:assert/strict`, with an in-process CDP stub (`tests/cdp_stub.mjs`) and `_deps` dependency-injection seams |

## Suite Baseline

The unit suite is `npm run test:unit` (23 `node --test` files). In this environment, without a live TradingView Desktop/CDP endpoint, the run reaches suite 26 with no `not ok` lines before the live-network tests (`pine_check` ×2, CLI pine check, e2e harness, npm-ci guard) block on connection and the 290 s wrapper times out — these are the session's named pre-existing failures, not regressions introduced by the branch. The session's recorded baseline against a live environment is 361/366 pass with the same 5 pre-existing failures and no new failures. The review judged coverage and quality against the changed-symbol set, not absolute project coverage.

## Assessment Criteria

All 3 assessment criteria PASS — Relevance & Business Alignment, Coverage Completeness, and Test Effectiveness — with the single exception recorded as TR-1 (pool-primitive coverage gap).

## Individual Test Function Analysis

393 of 393 tests clean — no flagged anti-patterns. Spot-checked high-value patterns: [launch.test.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/tests/launch.test.js#L194) uses decoy process rows (substring lookalikes must survive the exact-path kill match) — business-rule enforcement, not mock passthrough; [with_target_evaluate.test.js](https://github.com/m2ux/tradingview-mcp/blob/144c1b02332d50b0be151cbcda8afffaef3fc98c/tests/with_target_evaluate.test.js#L100) drives the real `chrome-remote-interface` path against a stub and asserts the structured `TV_CDP_BUSY` retryable error — error-boundary testing.

## Anti-Pattern Detection Summary

Total tests analyzed: 393 · with anti-patterns: 0 · clean: 393 · rate: 0%

## Coverage Analysis

### Coverage Gaps Identified

| Area | Gap Description | Priority |
|------|-----------------|----------|
| `connection.js` scoped pool | LRU refresh/eviction, `_isLive` stale-drop, `drainScopedPool`, `acquireScopedClient` release — no direct state-transition test | Low |

### Test Pyramid Assessment

Pyramid OK (unit ~88% / integration ~10% / e2e ~2%). The suite is unit-heavy by `_deps` injection, with a thin real-CDP stub integration layer (`with_target_evaluate`, `launch` MSIX, `e2e`) at the system boundary — the expected shape, not inverted.

## Reported-Failure Triage

No prior PR feedback carrying reported runtime failures was present in the session bag (`prior_feedback_triage` unset), so there was nothing to trace.
