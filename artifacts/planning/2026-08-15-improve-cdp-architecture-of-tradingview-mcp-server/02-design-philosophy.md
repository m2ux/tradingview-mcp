# Design Philosophy

> design-philosophy · Improve CDP Architecture of TradingView MCP Server · #24 Improve CDP architecture: centralize paths, fix transport breaches, consolidate protocol layer · 2026-08-15

## Problem Statement

The CDP interface that carries every TradingView MCP tool call has drifted from its intended stratified layering: domain modules open their own raw CDP connections instead of sharing the managed transport, TradingView page paths are hard-coded across ~13 files rather than read from one registry, and low-level protocol calls plus UI-settle delays are scattered across modules. The result is connection contention under parallel tab work and multi-file, error-prone edits whenever TradingView internals move. See [issue #24](https://github.com/m2ux/tradingview-mcp/issues/24) for the full breach list (R1–R5).

### System Context

The server is a Node MCP bridge driving TradingView Desktop (Electron) over the Chrome DevTools Protocol on `127.0.0.1:9222` via `Runtime.evaluate` of `window.TradingViewApi.*`. The intended stack is a one-directional, acyclic 4-layer flow: `server.js` → `tools/*.js` (zod-validated MCP registrars) → `core/*.js` (domain) → `connection.js` (transport) → `chrome-remote-interface` (vendor). `connection.js` owns client lifecycle, bounded calls, retries, target resolution, evaluate primitives, the `KNOWN_PATHS` registry, and loopback security. `core/dom.js` is the closest thing to a protocol layer. The breach is concentrated in three modules: `core/tab.js` and `core/capture.js` bypass the transport; page paths and CDP protocol-domain calls leak across `core/*`; `core/health.js` mixes unrelated concerns.

### Impact Assessment

| Aspect | Description |
|--------|-------------|
| Severity | High |
| Scope | All 88 tools (every call transits the CDP channel); 21 modules directly depend on `connection.js` |
| Business Impact | Connection wedges under parallel tab work (observed 2026-08-14); a TradingView internal change forces ~13-file edits; new manager surfaces (hotlists, accounts, deep backtesting, toast events) are costly to adopt |

## Problem Classification

**Type:** Inventive Goal

**Subtype:**
- [ ] Cause Known (direct fix)
- [ ] Cause Unknown (investigate first)
- [x] Improvement goal
- [ ] Prevention goal

**Complexity:** Complex

**Rationale:** Nothing is broken — the channel works today — so this is a proactive improvement of an existing capability, not a specific-problem fix. It is complex rather than moderate because it spans the transport and domain tiers with real architectural trade-offs (a transport-provided scoped-client factory versus a per-tab connection pool), reliability requirements, and a wide blast radius: `src/connection.js` alone has 21 direct importers (gitnexus impact, HIGH risk). Multiple viable approaches and inter-module dependencies put it firmly in complex territory.

## Workflow Path Decision

**Selected Path:** Full workflow (elicitation + research)

**Activities Included:**
- [x] Requirements Elicitation
- [x] Research
- [x] Implementation Analysis
- [x] Plan & Prepare

**Rationale:** A complex, high-blast-radius refactor needs its own elicited scope/success criteria and a synthesized research base to plan against. The prior read-only research (`.engineering/artifacts/planning/2026-08-15-tradingview-mcp-cdp-architecture/`) maps the breaches (R1–R5) and a build order (R2 → R1 → R3 → R4 → R5) and is the primary aid for classification, but the issue deliberately states the problem, not the solution — so the full discovery path is warranted rather than skip-optional.

## Constraints

| Constraint Type | Description |
|-----------------|-------------|
| Time | Agentic development; each R-refactor is independently mergeable (incremental landing) |
| Technical | No public TradingView API — CDP is the only path; undocumented internals can break on app updates; backward compatibility of the existing 88-tool surface is mandatory |
| Dependencies | `chrome-remote-interface@0.33.3` (supports flat sessions / `sessionId` routing); live TradingView Desktop needed for verification |
| Resources | Single fork repo `m2ux/tradingview-mcp`; base `main`; PRs target the fork |

## Success Criteria

Success criteria: [requirements](03-requirements-elicitation.md#success-criteria) once elicited.

## Notes

Prior research (read-only) is the primary aid: `01-existing-architecture-analysis.md` (breaches R1–R5 with `file:line` evidence) and `02-external-research-and-opportunities.md` (community implementations, TradingView JS-manager catalog, connection-pool and event-driven designs, build order in §6). Both cite evidence and change no code.
