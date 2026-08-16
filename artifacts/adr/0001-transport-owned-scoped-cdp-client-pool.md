# 0001. Transport-owned scoped CDP client pool

> adr · Improve CDP Architecture of TradingView MCP Server · #24 · 2026-08-16

**Status:** Accepted

## Context

Every TradingView MCP tool call transits Chrome DevTools Protocol on `127.0.0.1:9222`. Domain modules opened their own sockets (`tab.js` ×3, `capture.js` ×1) instead of sharing the managed transport, so parallel tab work contended for the endpoint and produced `TV_CDP_BUSY` wedges. Page paths, protocol-domain calls, and settle delays were copied across modules; `health.js` mixed probes, process launch, and git update-check. A TradingView internal move was a multi-file edit. The 88-tool surface and CLI had to stay behaviour-identical.

Problem, scope, and success criteria: [requirements](../planning/2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server/03-requirements-elicitation.md). Alternatives and slice order: [work package plan](../planning/2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server/06-work-package-plan.md#alternatives-considered).

## Decision

The transport owns every CDP client. [`connection.js`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/connection.js) lists targets once, hands out scoped clients from an LRU-8 pool keyed by target, and tracks lifecycle with a `closed:` promise so release is not treated as socket-closed. Transient errors still retry four times and surface `TV_CDP_BUSY`. Page paths are read from `KNOWN_PATHS`. [`core/protocol.js`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/protocol.js) owns `Page.*` and `Input.*`. A wait polls when a nameable condition exists and otherwise uses the shared sleep helper. Health probes stay in [`health.js`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/health.js); launch and update-check live in their own modules.

## Consequences

The shared channel no longer competes with private sockets, so parallel tab reads and screenshots share one bounded pool. A TradingView path change is a registry edit. Flatten-session multiplexing and event-driven push stay deferred: they need unknown TradingView `sessionId` support and are a larger rewrite than this package's success criteria demand. Pool size 8 is a proven sibling default, not a measured wedge threshold; the retry/`TV_CDP_BUSY` net remains the safety valve. Internal import paths are not frozen — CLI and deep consumers follow the new modules.

## Alternatives Considered

### Flatten-session multiplexing (`Target.attachToTarget` + `sessionId`)

Canonical Chromium multi-tab pattern on one socket. Rejected because TradingView flattened-session support is unknown and the rewrite is larger than the success criteria require. Deferred as an event-driven follow-up.

### Open/close a scoped client on every call

Zero structural change. Rejected because per-call churn is the documented wedge vector under parallel tab work.

### Size the pool from a live wedge-threshold experiment

Would replace the LRU-8 default with a measured constant. Rejected as a blocker: the endpoint is undocumented and the threshold is workload-specific. Plan default plus the existing retry net instead.

## Implementation Outcome

Landed on `chore/24-improve-cdp-architecture` at [`385c7b9`](https://github.com/m2ux/tradingview-mcp/commit/385c7b9) as [PR #25](https://github.com/m2ux/tradingview-mcp/pull/25) (review attested approved; GitHub REST cannot undraft). Ten commits: R2 registry, R1 `listTargets`, R1 factory+LRU-8, R3 protocol, R4 wait, R5 health split, lean, evict-before-close, bind `checkForUpdate`, drop unused borrow helper and empty gitkeep.

Deviations from the plan: pool eviction runs before close (lifecycle race); [`checkForUpdate`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/update_check.js) is bound after the health split; the unused `acquireScopedClient` borrow helper and empty `src/.gitkeep` were removed at strategic review. Flatten-session multiplexing remains deferred. Validation and strategic review passed.
