# CDP Interface — Architecture Analysis & External Research

> Work package · tradingview-mcp · 2026-08-15 · **Status:** Ready for implementation (pickup doc for a fresh agent)

## Purpose

Two self-contained reports produced in a single session, intended to let an agent in a
**new chat** pick up CDP-interface refactoring work without re-deriving context:

1. **Existing-architecture analysis** — is `src/`'s CDP interface a clean, stratified
   layer stack or ad-hoc growth? (Verdict: stratified, with three localized breaches.)
2. **External research** — what the wider community has built for TradingView-via-CDP,
   what TradingView's in-page manager surface actually offers, and which of those
   capabilities we have not yet adopted.

Each report ends in a concrete, independently-mergeable set of refactors/opportunities.
The final section of `02` maps research findings onto the architecture breaches and
proposes a build order.

## Context an implementing agent needs

- Repo: `tradingview-mcp` — MCP bridge driving **TradingView Desktop** (Electron) over
  the **Chrome DevTools Protocol** on `127.0.0.1:9222` via `Runtime.evaluate` of
  `window.TradingViewApi.*`. No public TradingView API exists; CDP is the only path.
- Branch at time of writing: `feat/capture-snapshot` (issue #23 layout/tab targeting +
  structured errors already landed; connection-hardening `withTimeout` landed 2026-08-14).
- The connection layer is `src/connection.js`; the domain layer is `src/core/*.js`;
  the tool layer is `src/tools/*.js` (zod-validated MCP registrars).

## File index

| File | Contents |
|------|----------|
| `01-existing-architecture-analysis.md` | Layer-by-layer review of the CDP interface with `file:line` evidence; three named breaches; strongest/weakest points; refactor list R1–R5 |
| `02-external-research-and-opportunities.md` | Community implementations, TradingView JS-manager catalog, connection-pooling + event-driven designs, unadopted capabilities, and the research→architecture mapping + build order |

## How to use

- Read `01` before touching `src/connection.js`, `src/core/tab.js`, or `src/core/capture.js`.
- Read `02` before adding any new tool that reaches a new TradingView manager
  (hotlists, accounts, deep backtesting, toast events) or before adopting the
  connection-pool / event-driven designs.
- Treat both as read-only analysis: they cite evidence but change no code. The build
  order in `02` §6 is the recommended entry point.
