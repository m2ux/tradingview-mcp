# Test Suite Review Report

> TradingView MCP Security Mitigations · PR [#1](https://github.com/m2ux/tradingview-mcp/pull/1) · 2026-08-08 · [Test Suite Review](https://github.com/m2ux/workflow-server/blob/workflows/work-package/resources/test-suite-review.md) Agent

## Review Scope

| Aspect | Details |
|--------|---------|
| Module(s) Reviewed | `src/capabilities.js`, `src/tools/_format.js`, `src/core/update.js`, `src/core/health.js`, `src/core/pine.js`, `src/core/ui.js`, `src/connection.js`, `src/server.js`, CLI pine-check |
| Test Files Analyzed | 7 (4 new: capabilities, fencing, guards, server-gating; 3 touched: update, launch, cli) |
| Total Tests Reviewed | 33 in new files; ~74 across the touched surface (16 update, 11 launch, 14 cli) |
| Testing Framework | `node:test` + `node:assert/strict`, DI-seam fakes (no mock framework) |

Baseline: `npm run test:unit` → **163/163 pass** (with network; the 5 failures without network are the pre-existing live-facade pine-check CLI cases, which intentionally hit TradingView's compile API and now pass the upload opt-in env var).

## Summary Assessment

**Overall Test Quality:** 4.5/5 — Diff-aware coverage is strong: every new guard has at least one refusal-path and one acceptance-path test, and the refusal tests assert *no side effect occurred* (no git command ran, no fetch issued, no process killed) rather than merely asserting an error message — the high-value error-boundary pattern.

All 3 assessment criteria PASS, with two scope notes below (CI-yaml and CLI-flag paths are validated by inspection/manual cases PR1-TC-19..21 rather than executable tests — accepted by the test plan's own Manual typing).

## Individual Test Function Analysis

33 of 33 new-file tests clean. No always-true assertions, no mock-only passthroughs (fakes record `state.cmds`/`fetched`/`killed` and tests assert on *real code's use* of the fake), no validation theater (refusal tests use `assert.rejects`/`assert.throws` with message matchers, acceptance tests assert positive outcomes like `verified_via`).

Notable high-value cases:

- `fencing.test.js` forged-marker neutralization — a planted `UNTRUSTED_CHART_END` inside chart text must leave exactly 2 markers: proves the datamarking property, not just the wrapping.
- `launch.test.js` exact-path table — decoy rows (`TradingViewHelper` binary, `TradingView.md` document) must survive while PID 441 dies: pins the anti-substring-kill contract against regression.
- `update.test.js` refusal cases assert `!state.cmds.some(c => c.includes('fetch'|'merge'))` — proves gate-before-effect ordering, the security property that matters.
- `server-gating.test.js` composes a real `McpServer` through the production wrap — integration-level proof the funnel is total, not a unit-level approximation.
- `guards.test.js` text-strategy bypass case — asserts the css guard *does not* fire for the text strategy, pinning deliberate scope rather than accidental overreach.

## Anti-Pattern Detection Summary

Total tests analyzed: 74 · with anti-patterns: 0 · clean: 74 · rate: 0%

## Coverage Analysis

Diff-aware map (changed symbol → test callers):

| Changed symbol | Test coverage |
|----------------|---------------|
| `isGateOpen` / `isAllowed` / `wrapRegistrar` | capabilities.test.js (11) + server-gating.test.js (4, integration) |
| `wrapUntrusted` / `jsonResult` fencing | fencing.test.js (10) |
| `update()` token/origin/provenance/fail-closed | update.test.js (+9 new cases; 7 pre-existing guard/path cases re-run unchanged) |
| `launch()` kill default + exact-path + MSIX honor | launch.test.js (+4 new; MSIX suite updated for flipped default) |
| `check()` upload gate | guards.test.js (2) + cli.test.js (1 blocked-case + 2 opt-in live cases) |
| `assertLoopbackHost` | guards.test.js (3) |
| `findElement` css guard | guards.test.js (3) |

### Coverage Gaps Identified

| Area | Gap Description | Priority |
|------|-----------------|----------|
| `verifyTarget` GPG failure text path | Unsigned-tag and no-tag cases covered; GPG-tool-missing (`gpg` absent → `tag -v` throws for a *signed* tag) falls through to the same refusal — behavior correct, but no test pins the message distinguishing "unsigned" from "unverifiable" | Low |
| `killExisting` win32 wmic branch | New win32 parsing path (CSV columns, `parts.length < 3` skip) has no fake-driven test; existing MSIX suite is `{ skip: !onWindows }` so on this Linux CI it never executes — the win32 kill path is currently exercised by **no runnable test anywhere** | Medium |
| CI workflow yaml | SHA pins, permissions, blocking audit verified by reading, not by a workflow-lint test (test plan types PR1-TC-19 as Manual — accepted) | Low |
| CLI `launch` flag mapping | `src/cli/commands/health.js` `no-kill` mapping has no test; interacts with code-review M1 (default polarity) | Medium |

### Test Pyramid Assessment

Pyramid OK (unit ~90% / integration ~8% / e2e ~2% — e2e suite excluded from `test:unit` by design; new files are unit + one composed-server integration file).

## Recommendations

### 2. Near-term Improvements (Medium Priority)

| # | Action | Affected Tests | Rationale |
|---|--------|----------------|-----------|
| 2.1 | Add a win32-faked `killExisting` case (`platform: 'win32'` DI seam already exists) feeding a `wmic` CSV table with a decoy | `tests/launch.test.js` | The win32 kill rewrite is the highest-blast-radius untested branch in the authored surface; the DI seam makes it a 20-line test |
| 2.2 | When code-review M1 is fixed (CLI flag polarity), add a router-level test pinning `tv launch` → `kill_existing: false` default | `tests/cli.test.js` | Prevents the default-flip leak from regressing after the fix |

### 3. Long-term Enhancements (Low Priority)

| # | Action | Affected Tests | Rationale |
|---|--------|----------------|-----------|
| 3.1 | Pin the GPG-unavailable refusal message distinct from unsigned-tag | `tests/update.test.js` | Operator debugging: "unverifiable" and "unsigned" warrant different remediation |
| 3.2 | Optionally skip-live-gate the two facade-hitting CLI cases (`test:unit` currently needs network for them) | `tests/cli.test.js` | Suite hermeticity; pre-existing condition, not introduced here |

## Review Outcome

**Result:** Acceptable

**Summary:** The new and touched tests are behavior-focused, side-effect-asserting, and free of the catalogued anti-patterns; diff-aware coverage maps every changed guard to at least one refusal and one acceptance test. Two medium near-term gaps (win32 kill-branch test, CLI polarity test) pair with the code-review follow-ups and route with them.

**Deferred Improvements:** 3.1, 3.2 (recorded here; no routing flag).

## Re-review (fix cycle 1, commit `9801051`)

Gaps 2.1 (win32 kill-branch test) and 2.2 (CLI polarity test) are closed by this cycle: `tests/launch.test.js` gains a `platform: 'win32'` wmic/taskkill suite (exact-path match, decoy, empty-path, and blank-row cases) and `tests/cli.test.js` pins the `--kill` opt-in via launch help. Suite 166/166 green. Remaining gap table entries are Low and deferred above.
