# Requirements Elicitation: Improve CDP Architecture of TradingView MCP Server

> 2026-08-15 · Confirmed

## Problem Statement

The CDP channel carrying every one of the server's 88 tools has drifted from its intended stratified layering: three sites open private CDP clients instead of sharing the managed transport, TradingView page paths are hard-coded across ~10 modules instead of read from the `KNOWN_PATHS` registry, low-level protocol calls and UI-settle sleeps are scattered, and `core/health.js` mixes unrelated concerns. The consequences are connection wedges under parallel tab work (observed 2026-08-14), multi-file error-prone edits when TradingView internals move, and a high cost of adopting new TradingView manager surfaces. See [issue #24](https://github.com/m2ux/tradingview-mcp/issues/24) and the [design philosophy](02-design-philosophy.md) for the breach list (R1–R5).

## Goal

A clean, stratified CDP layer stack — one transport module owning all client lifecycles, one page-path registry consumed everywhere, consolidated protocol calls and wait helpers, and a cohesive health module — that is cheaper to change, keeps the existing 88-tool surface backward compatible, and unblocks later adoption of new TradingView manager surfaces and event-driven (push) capabilities.

## Stakeholders

### Primary Users

| User Type | Needs | User Story |
|-----------|-------|------------|
| AI agent operator (MCP client driving TradingView) | Reliable parallel tab work | As an agent operator, I want background-tab reads and screenshots not to wedge the shared CDP connection so that multi-tab workflows complete without `TV_CDP_BUSY` retries |
| Maintainer of tradingview-mcp | Cheap updates when TradingView internals move | As a maintainer, I want page paths and protocol calls in one place so that a TradingView update is a one-registry edit, not a 10-file sweep |
| Contributor adding tools | A clean base for new manager surfaces | As a contributor, I want a registry entry and a transport factory to be all a new manager surface needs so that hotlists/accounts/backtesting are cheap to adopt |

### Secondary Stakeholders

- CLI users (`tv` bin) — the CLI consumes core modules beyond the public facade; the refactor must not break it
- End users of the published MCP server — the 88-tool surface and tool behaviour must stay backward compatible

## Context

### Integration Points
- TradingView Desktop (Electron) CDP endpoint on `127.0.0.1:9222` — the only control path; undocumented internals can break on app updates
- `chrome-remote-interface@0.33.3` — vendor CDP client; supports flat sessions / `sessionId` routing
- MCP clients (Claude Code, Cursor) over stdio — the consumer of the tool surface
- The `tv` CLI — second consumer of `core/*`, reaching modules the public facade omits

### Dependencies
- Live TradingView Desktop required for verification (e2e)
- Prior read-only research: [breach analysis R1–R5](../2026-08-15-tradingview-mcp-cdp-architecture/01-existing-architecture-analysis.md), [external research + build order](../2026-08-15-tradingview-mcp-cdp-architecture/02-external-research-and-opportunities.md)
- Comprehension corpus: [tradingview-mcp.md](../../../comprehension/tradingview-mcp.md) (CDP-transport depth at `4ff5104`)

### Constraints
- **Technical:** No public TradingView API — CDP is the only path; backward compatibility of the existing 88-tool surface is mandatory; loopback-only CDP default must be preserved
- **Timeline:** Agentic development; each R-refactor independently mergeable (incremental landing)
- **Resources:** Single fork repo `m2ux/tradingview-mcp`; PRs target the fork

## Scope

### In Scope

1. **R2 — Page-path registry consolidation:** route all page-path consumers through `KNOWN_PATHS` (map import or verified getters); retire the ~15 hardcoded literal sites across ~10 modules
2. **R1 — Transport breach repair:** replace the private-socket sites (`tab.js` ×3, `capture.js` `_makeScopedClient`, `withTargetEvaluate`) with a transport-provided scoped-client factory/pool; consolidate `/json/list` target listing (5 duplicated fetches in `tab.js`)
3. **R3 — Protocol-call consolidation:** move raw CDP protocol-domain calls (`Page.captureScreenshot`, `Input.dispatch*`) behind the transport/protocol layer (`core/dom.js` or `connection.js`)
4. **R4 — Wait/sleep consolidation:** route the 32 raw `setTimeout` sleeps (10 modules) onto shared wait helpers (`wait.js` / a bounded poll-or-timeout idiom), with a per-site policy
5. **R5 — Health-module cohesion:** split page-probe health (`healthCheck`/`discover`/`uiState`) from process operations (`launch`/kill/MSIX) and the git update-check
6. Backward compatibility of the 88-tool surface and the CLI throughout; unit tests updated/added per refactor; verification on live TradingView Desktop

### Out of Scope

1. New tool adoption (hotlists, alert fire history, paper-account ops, deep backtesting) — research §6 lists these as follow-on candidates on the cleaned base, not part of this package
2. Event-driven/push redesign (flat sessions, `Target`/`Inspector`/`toastManager` subscriptions, shrinking `withTimeout` to a pure RPC backstop) — explicitly a follow-up after R1 per research §6
3. Passive network capture (MaudeView-style) — research §6 defers it as optional
4. Public-API governance for `core/index.js` (whether the CLI-consumed namespaces become formally public) — a decision to record, not a refactor deliverable
5. Changing tool behaviour/output shapes (fencing, gating) — settled by the 2026-08-08 mitigations package

### Deferred
Deferred scope items: [deferred-items register](deferred-items.md) — record each item there, not here.

## Success Criteria

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| SC-1 | No module outside the transport layer opens a CDP client: zero `CDP({...})` / `chrome-remote-interface` imports in `src/core/*` except via the transport-provided factory | `rg "chrome-remote-interface" src/core/` returns only factory-sanctioned sites; unit tests pass |
| SC-2 | All page-path reads route through `KNOWN_PATHS` (map or verified getters): zero remaining hardcoded `window.TradingViewApi._*` literals outside `connection.js` | `rg "window.TradingViewApi._" src/ --glob '!src/connection.js'` returns no literal bindings |
| SC-3 | Raw CDP protocol-domain calls (`Page.*`, `Input.*`, `Emulation.*`) exist only in the designated protocol module(s) | `rg "Page\.|Input\.|Emulation\." src/core/` confined to the protocol layer |
| SC-4 | Raw fixed-duration sleeps are consolidated: the 32 identified sites either use a shared helper or carry a recorded per-site rationale | `rg "setTimeout" src/core/` shows only helper-sanctioned sites; per-site policy recorded in the plan |
| SC-5 | `core/health.js` exports only page-probe health operations; launch/kill/MSIX and update-check live in their own modules | Module layout inspection; existing health/launch unit tests pass |
| SC-6 | The 88-tool surface and CLI are behaviour-identical: all existing unit tests pass unmodified in behaviour (imports may move), and e2e smoke passes on live TradingView Desktop | `node --test` green; e2e smoke (chart read, screenshot, tab list, background-tab read) on live Desktop |
| SC-7 | Parallel-tab contention is measurably reduced: a background-tab read + screenshot + tab-switch sequence completes without `TV_CDP_BUSY` on live Desktop | Manual/e2e scenario run on live Desktop |
| SC-8 | Each R-refactor lands as an independently mergeable PR slice in the research build order (R2 → R1 → R3 → R4 → R5) | Commit history on `chore/24-improve-cdp-architecture` |

## Assumptions

Assumptions surfaced during elicitation: [assumptions log](02-assumptions-log.md) — record each there (categories: Requirement Interpretation, Scope Boundaries, Implicit Requirements, Success Criteria), not here.

## Elicitation Log

**Limitation:** stakeholder discussion was skipped at the `stakeholder-transcript` gate; elicitation is agent-led, derived from issue #24, the prior research reports, and the comprehension corpus. Requirements carry pending-confirmation status until reviewed.

### Questions Asked

| Domain | Question | Response Summary |
|--------|----------|------------------|
| Problem Exploration | What problem are we solving; what triggers it now? | Layer drift in the CDP channel: private-socket bypasses wedged parallel tab work on 2026-08-14; path duplication makes TradingView updates 10-file edits; new manager surfaces are costly. Derived from issue #24 + research 01 |
| Stakeholder Identification | Who is affected and what does each need? | Agent operators (reliable parallel tabs), maintainers (cheap internal-move updates), contributors (cheap new surfaces); secondary: CLI users, end users of the 88-tool surface. Derived from comprehension corpus domain mapping |
| Context & Environment | What does this interact with; what constraints? | TradingView Desktop CDP (only path, undocumented), chrome-remote-interface 0.33.3 (flat sessions available), MCP stdio clients, the `tv` CLI; backward compatibility mandatory; incremental landing per R. From design philosophy constraints |
| Scope Definition | What is definitely in / explicitly out / deferred? | In: R1–R5 refactors + compatibility + verification. Out: new tool adoption, event-driven push redesign, passive capture, public-API governance, output-shape changes. Per research §6 boundaries |
| Success Criteria | How will we know each refactor worked? | Per-R structural greps (SC-1..SC-5), behaviour-identical surface with green tests + live e2e smoke (SC-6), no `TV_CDP_BUSY` on a parallel-tab scenario (SC-7), independently mergeable slices in build order (SC-8) |

### Clarifications Made
- Registry consumption idiom: the corpus shows two working channels (map import in `data.js`; verified getters in `drawing`/`batch`/`replay`) — consolidation extends the getter/map convention rather than inventing one (SC-2)
- Sleep consolidation is adoption, not invention: `wait.js` structured waits and `dom.js` `sleep` already exist; the 32 raw sites are the un-migrated tail (SC-4)
- The CLI already consumes core namespaces the public facade omits (tab/stream/pane/capture/study/dom), so those modules are de-facto public and in the refactor's blast radius

### Open Questions Resolved
- "Is KNOWN_PATHS genuinely unused?" — used via verified getters in 3 modules; the gap is the ~10 literal-binding modules (comprehension log Q13)
- "Must a new reader learn three client idioms?" — yes today; the scoped-client factory subsumes them behind existing exports (comprehension log Q9)

## Confirmation

**Confirmed by:** User
**Date:** 2026-08-15
**Notes:** Stakeholder discussion was skipped; elicitation was agent-led from issue #24, the prior research reports, and the comprehension corpus, and confirmed at the elicitation-complete gate.
