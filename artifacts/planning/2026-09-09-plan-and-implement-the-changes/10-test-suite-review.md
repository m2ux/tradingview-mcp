# Test Suite Review Report

> Pine live-edit loop · #32 · 2026-09-09 · [Test Suite Review](10-test-suite-review-method.md) · what was walked: [method record](10-test-suite-review-method.md)

## Summary Assessment

**Overall Test Quality:** 5/5 — the Save-missing library compile path is covered after `5b52307`.

## Findings

### TR-1 — library compile untested when Pine Save is absent

**Category:** Coverage Gap

**Severity:** Medium

**Reachability:** reachable — [the suite](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L350) ships the happy path only.

**Description:** [smartCompile — library Save vs indicator Add](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/tests/issue26_pine_friction.test.js#L374) asserts Pine Save when `clicks.save` is true. It does not run a library buffer with Add visible and Save missing. The stub’s last line also returns Add in that case, so the missing path is both untested and stub-shaped.

**Impact:** [CR-1](10-code-review.md#cr-1--library-compile-still-adds-to-chart-when-pine-save-is-missing) stays green. A live layout can still gain a library study.

**Recommendation:** Add a case: library source, Save absent, Add present → `success: false`, no Add click, `study_added` not true. Point the stub at the page-script contract, not at the old cascade.

**Adjudication:** Fixed in `5b52307`. The new case asserts refuse, empty click log, and `study_added: false`.

## Review Outcome

**Result:** Acceptable

**Summary:** Baseline plus the Save-missing case is green. No remaining test finding at Minor or above.
