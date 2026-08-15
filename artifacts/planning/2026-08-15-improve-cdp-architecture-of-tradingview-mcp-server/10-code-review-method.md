# Code Review Method

> code-review method · PR #25 (chore/24-improve-cdp-architecture) · 2026-08-15 · findings: [code review report](10-code-review.md)

## Scope Walked

The reviewed surface is the branch diff `main...HEAD` (base `8bd6843`, head `144c1b0`): 23 files, 611 insertions, 439 deletions, enumerated by the [change-block index](10-change-block-index.md) (23 blocks / 114 hunks). The changed-symbol set was mapped with `gitnexus detect_changes` (scope `compare`, base `main`): 161 changed symbols, 138 affected, 27 files, risk level critical — the reading expected for an 8-commit architectural refactor whose blast radius spans the shared transport. The blast radius rests on graph edges from the index, not a hand-derived caller set; the highest-fanout changed symbols are the connection.js transport exports (`makeScopedClient`, `listTargets`, `withTargetEvaluate`, `KNOWN_PATHS`), whose upstream callers are the domain modules the refactor rewired.

Because the project is JavaScript/Node rather than Rust/Substrate, the Rust- and Substrate-specific criteria (ownership/borrowing, pallets, weights, storage, extrinsics) do not apply; the review walked the applicable categories — Architecture, Documentation, Testing, Security, and general code-quality idioms — against the changed files.

## Sweeps

- **Layering / transport-confinement sweep** — verified raw `Page.*`/`Input.*`/`Emulation.*` calls live only in `core/protocol.js`, and `/json/list` fetches only in `connection.js#listTargets`. Clean: domain modules consume named helpers; no transport bypass remains.
- **Registry-adoption sweep** — verified chart-API path expressions interpolate `KNOWN_PATHS` rather than embedding `window.TradingViewApi...` literals across chart.js, data.js, indicators.js, pine.js, pine_ui.js, alerts.js, drawing.js, pane.js, replay.js, stream.js, batch.js, health.js. Clean: no stray literals in the adopted files.
- **Borrow/close invariant sweep** — traced every scoped-client acquisition to its close. `withTargetEvaluate` and `capture.js` both `evictScopedClient` before `close()` in a `finally`; `acquireScopedClient` deletes the pool reference before handing out the client. Clean: the pool retains no reference to a caller-closed socket.
- **Sleep-consolidation sweep** — verified local `setTimeout`-promise one-liners route through `wait.js#sleep` (or a named condition-based poll). Clean in the adopted modules.
- **Error-handling sweep** — `update_check.js` never throws (failures resolve to `null`); launch early-failure detection resolves an error string or `null`; `withTargetEvaluate` marks transient CDP-busy errors `retryable` with code `TV_CDP_BUSY`. Clean.
- **Security sweep** — `assertLoopbackHost` non-loopback refusal retained; `safeString`/`requireFinite` guards unchanged; MSIX copy-local confined to `LOCALAPPDATA`. Clean.
- **Test-coverage sweep (diff-aware)** — mapped changed symbols to test callers. `launch.js` (MSIX fallback, kill-existing) and `withTargetEvaluate` (real-CDP stub path) are directly covered. **Returned the finding:** the scoped-pool primitives (`makeScopedClient` LRU/eviction/stale-drop, `acquireScopedClient`, `drainScopedPool`, `evictScopedClient`) and the `protocol.js` helpers have no direct unit test — covered only indirectly (CR-1, Low).

## Compliance

| Category | Status | Score |
|----------|--------|-------|
| Testing | ✗ | 80% |

Architecture, Documentation, and Security pass. Testing diverges on the single pool-primitive coverage gap recorded as CR-1; the rest of the changed surface is covered directly or through preserved injection seams.
