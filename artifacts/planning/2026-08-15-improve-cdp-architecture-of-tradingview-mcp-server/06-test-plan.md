# Test Plan: Improve CDP Architecture of TradingView MCP Server

> **ADR:** [0001](../../adr/0001-transport-owned-scoped-cdp-client-pool.md) · **Ticket:** [#24](https://github.com/m2ux/tradingview-mcp/issues/24) · **PR:** [#25](https://github.com/m2ux/tradingview-mcp/pull/25)

## Overview

This test plan validates the five-slice CDP-architecture repair (R1–R5): transport-owned scoped-client pool, `KNOWN_PATHS` adoption, protocol-call consolidation, wait-helper adoption, and the health split — with a behaviour-identical 88-tool surface and CLI.

Key changes validated:
1. [`listTargets`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L131) / [`makeScopedClient`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L234) — one target listing, LRU-8 pool, retry/`TV_CDP_BUSY` preserved
2. [`verifyAndReturn`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L377) / [`getChartApi`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L385) — one registry, verified-on-read
3. [`captureScreenshot`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/protocol.js#L11) / [`dispatchMouse`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/protocol.js#L15) — `Page.*`/`Input.*` confined to `protocol.js`
4. [`waitForChartReady`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/wait.js#L13) — poll when a condition exists; shared sleep otherwise
5. [`healthCheck`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/health.js#L15) / [`launch`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/launch.js#L97) / [`checkForUpdate`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/update_check.js#L15) — probes, process, and git-compare split

## Test Cases

| Test ID | Objective | Steps | Expected Result | Type |
|---------|-----------|-------|-----------------|------|
| [PR25-TC-01](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L185) | Zero unsanctioned CDP opens in `src/core/*` (SC-1) | 1. `rg "chrome-remote-interface\|CDP\(\{" src/core/`  <br>2. Confirm only factory-sanctioned sites | No domain-module raw opens | Unit |
| [PR25-TC-02](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/with_target_evaluate.test.js#L28) | `withTargetEvaluate` factory path + `TV_CDP_BUSY` | 1. Stub CDP  <br>2. Targeted evaluate  <br>3. Force close-on-connect | Marker eval succeeds; busy path is retryable `TV_CDP_BUSY` | Unit |
| PR25-TC-03 | Pool reuse / LRU / `closed` eviction (SC-1) | No dedicated suite — [TR-1](10-test-suite-review.md#tr-1--the-scoped-client-pool-state-transitions-are-untested) | Coverage gap remains | Unit |
| [PR25-TC-04](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L377) | Zero `window.TradingViewApi._*` literals outside `connection.js` (SC-2) | 1. `rg "window\.TradingViewApi\._" src/ --glob '!src/connection.js'` | No literal bindings | Unit |
| [PR25-TC-05](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js#L377) | Verified getters raise when paths absent | 1. Read `verifyAndReturn`  <br>2. Confirm named-error path | Path miss is a named error | Unit |
| [PR25-TC-06](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/protocol.js#L11) | `Page.*`/`Input.*` confined to protocol module (SC-3) | 1. `rg "Page\.\|Input\.\|Emulation\." src/core/` | Hits only `protocol.js` (plus helper wrappers) | Unit |
| [PR25-TC-07](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/dom.test.js#L54) | Domain modules consume protocol helpers | 1. Stub `Input.dispatchKeyEvent`  <br>2. [`pressKey`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/dom.test.js#L54)  <br>3. [`captureScreenshot({ target })`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/target_reads.test.js#L179) | Key events and targeted capture go through helpers/factory | Unit |
| [PR25-TC-08](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/ui_verbs.test.js#L66) | Pollable waits use shared helpers (SC-4) | 1. Inject evaluate into [`waitFor`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/ui_verbs.test.js#L66)  <br>2. Confirm timeout/interval | Poll succeeds or times out without a raw sleep | Unit |
| [PR25-TC-09](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/launch.test.js#L65) | Health split: launch + update-check still pass (SC-5) | 1. [`launch.test.js`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/launch.test.js#L65)  <br>2. [`update.test.js`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/update.test.js#L56) | Existing launch/update units pass from new modules | Unit |
| [PR25-TC-10](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/package.json) | Unit pass count does not regress (SC-6) | 1. `npm run test:unit` | 364/366 pass; 2 env-gated `guards.test.js` failures pre-existing | Unit |
| [PR25-TC-11](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/tests/e2e.test.js#L76) | Live Desktop e2e smoke (SC-6) | 1. TradingView on `:9222`  <br>2. `node --test tests/e2e.test.js` | Chart read, screenshot, tab list succeed | Manual |
| PR25-TC-12 | Parallel-tab no `TV_CDP_BUSY` (SC-7) | 1. Background-tab read  <br>2. Screenshot  <br>3. Tab switch | Completes without `TV_CDP_BUSY` — smoke, not in CI | Manual |

## Acceptance Criteria Matrix

| Requirement | Acceptance Criterion | Verifying Test Cases |
|-------------|----------------------|----------------------|
| SC-1 | Zero unsanctioned CDP opens; factory path tested | PR25-TC-01, PR25-TC-02; PR25-TC-03 gap ([TR-1](10-test-suite-review.md#tr-1--the-scoped-client-pool-state-transitions-are-untested)) |
| SC-2 | Zero literals outside `connection.js` | PR25-TC-04, PR25-TC-05 |
| SC-3 | Protocol calls confined to the protocol module | PR25-TC-06, PR25-TC-07 |
| SC-4 | Raw sleeps on shared helpers or recorded rationale | PR25-TC-08 |
| SC-5 | `health.js` probes-only; launch/update-check units pass | PR25-TC-09 |
| SC-6 | 88-tool surface + CLI behaviour-identical | PR25-TC-10, PR25-TC-11 |
| SC-7 | No `TV_CDP_BUSY` on the parallel-tab scenario | PR25-TC-12 |
| SC-8 | Five slices independently mergeable R2→R1→R3→R4→R5 | PR25-TC-10 (per-slice unit runs) |

## Running Tests

```bash
npm run test:unit
node --test tests/with_target_evaluate.test.js
node --test tests/dom.test.js tests/target_reads.test.js tests/ui_verbs.test.js
node --test tests/launch.test.js tests/update.test.js
# Live Desktop required:
node --test tests/e2e.test.js
```

Source baselines: [implementation analysis](05-implementation-analysis.md#baseline-metrics). Validation: 364/366 unit pass; 2 `guards.test.js` failures env-dependent and pre-existing. Suite review: [TR-1](10-test-suite-review.md#tr-1--the-scoped-client-pool-state-transitions-are-untested) (pool state transitions untested).
