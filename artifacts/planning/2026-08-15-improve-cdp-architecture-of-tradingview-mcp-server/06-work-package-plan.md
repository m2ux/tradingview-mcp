# Improve CDP Architecture of TradingView MCP Server — Implementation Plan

> plan · HIGH · Ready · 6-9h agentic + 1-2h review · 2026-08-15

## Overview

### Problem & Scope

Problem, scope, and success criteria: [requirements](03-requirements-elicitation.md). Five architecture breaches (R1–R5) are repaired as independently mergeable slices in build order R2 → R1 → R3 → R4 → R5, behaviour identical across the 88-tool surface and CLI.

## Inputs

- [Knowledge Base Research](04-kb-research.md#synthesis--findings-mapped-to-requirements) — maintainer-endorsed concurrent-session usage, pool sizing not researchable (C-1 handoff), wait-idiom validation
- [Implementation Analysis](05-implementation-analysis.md#baseline-metrics) — measured baselines and re-runnable SC probes, gaps G1–G6, pool/sleep design parameters, R5 split-readiness evidence
- [Prior research 02 §3/§6](../2026-08-15-tradingview-mcp-cdp-architecture/02-external-research-and-opportunities.md) — RUDE-labs LRU pool design proven against the same endpoint; build order
- [Comprehension corpus](../../comprehension/tradingview-mcp.md) — invariant map, exact breach-module inventories, DI-seam layout
- [Design philosophy](02-design-philosophy.md) — classification (inventive-improvement/complex) and constraints

## Proposed Approach

### Solution Design

Five mergeable slices on `chore/24-improve-cdp-architecture`:

**Slice R2 — registry adoption sweep.** Point every hardcoded `window.TradingViewApi._*` literal (25 sites, 10 modules) at `KNOWN_PATHS`, replacing local `CHART_API`/`CWC` constants with verified getters (`getChartApi()`/`getChartCollection()`), the in-tree idiom, or map imports where a module already does so. Registry itself unchanged — verification-on-read preserved. Mechanical, low-blast substitution.

**Slice R1 — transport repair (structural core).** Add in `connection.js`: `listTargets()` (single `/json/list` fetch consumed by existing finders and tab.js); `makeScopedClient(targetInfo, opts)` — a transport-owned factory/pool keyed by target with **LRU default size 8** (RUDE-labs proven sizing against the same endpoint), `closed: Promise`-based lifecycle tracking (KB finding: release ≠ socket-closed), and preserved `isTransientCdpError` → 4-retry → `TV_CDP_BUSY` semantics. Replace the 4 raw opens (tab ×3, capture ×1) and re-body `withTargetEvaluate` on the factory; route tab.js's 5 `fetchJsonList` copies to `listTargets()`.

**Slice R3 — protocol consolidation.** A designated protocol module (new `core/protocol.js` or extension of `core/dom.js`) exposes `captureScreenshot(client, params)`, `dispatchMouse(client, …)`, `dispatchKey(client, …)`, `insertText(client, …)`; batch/capture/dom/ui consume these. Eliminates the duplicated screenshot call and click idioms.

**Slice R4 — wait adoption sweep.** Decision rule recorded: **poll (`waitFor*`-style or bounded poll-until) when a nameable condition exists; shared `sleep` helper otherwise.** Classify the 46 non-wait sites per that rule at implementation time against the live UI; migrate each in place, recording sites kept as delays.

**Slice R5 — health cohesion split.** Pure move: `health.js` keeps probes (`healthCheck`/`discover`/`uiState`); new `core/launch.js` takes launch/kill/MSIX; new `core/update_check.js` (or fold into `core/update.js`) takes `checkForUpdate`. No cross-call extraction needed (IA-5). Re-export shims preserve import paths used by the CLI.

### Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| N-socket scoped-client factory/pool (this design) | Minimal change from existing per-target flow; proven LRU-8 sibling design; browser limits far above usage | Still one socket per background target | **Selected** |
| Flatten-session multiplexing (Target.attachToTarget + sessionId) | Canonical upstream multi-tab pattern; one socket | Large rewrite; TradingView flattened-session support unknown (C-2); no SC demands | Rejected (RS-3; deferred to event-driven follow-up) |
| Keep open/close-per-call scoped clients | Zero structural change | Per-call churn; the documented wedge vector | Rejected |
| Pool sizing from a live wedge-threshold experiment | Measured default | TradingView endpoint undocumented; workload-specific; not reproducible as a stable constant | Rejected as blocker (IA-4) — plan default + retry safety net |
| Third-party wait library | Off-the-shelf poll idioms | New dependency for capability already in tree (wait.js, dom.sleep) | Rejected (04-kb-research Web 4) |

### Assumptions

Assumptions underlying the approach: [assumptions log](02-assumptions-log.md) (17 rows incl. IA-1..IA-5; PL-* added during this activity).

## Implementation Tasks

Slices land in order on `chore/24-improve-cdp-architecture`; each is a separable commit (independently mergeable per RE-1/SC-8): R2 → R1 listTargets+churn → R1 pool routing → R3 → R4 → R5.

### Task 1: R2 registry adoption sweep (45-60 min)
**Goal:** zero `window.TradingViewApi._*` literals outside `connection.js` (25 sites, 10 modules).
**Deliverables:**
- `src/core/{chart,study,indicators,stream,alerts,pane,pine_ui,health}.js`, `src/wait.js`, `src/core/data.js` — replace literals with verified getters or `KNOWN_PATHS` imports
- `tests/` — update affected DI-fake/wait tests for the getter idiom

### Task 2: R1 target-listing consolidation (30-45 min)
**Goal:** one `/json/list` path in the transport, shared by finders and tab.js.
**Deliverables:**
- `src/connection.js` — `listTargets()`; finders re-bodied on it
- `src/core/tab.js` — 5 fetch copies → `listTargets()`

### Task 3: R1 scoped-client factory + pool (90-130 min)
**Goal:** all scoped clients transport-provided; lifecycle-aware; bounded LRU-8.
**Deliverables:**
- `src/connection.js` — `makeScopedClient`/`acquireScopedClient` pool with `closed:`-promise eviction
- `src/core/tab.js`, `src/core/capture.js` — raw opens → factory callers
- `src/connection.js` — `withTargetEvaluate` re-bodied (retries/TV_CDP_BUSY preserved)
- `tests/with_target_evaluate.test.js`, `tests/target_reads.test.js` — updated for factory + pool

### Task 4: R3 protocol-layer consolidation (60-90 min)
**Goal:** `Page.*`/`Input.*` calls confined to one designated module.
**Deliverables:**
- `src/core/protocol.js` (new) or `src/core/dom.js` — protocol helpers
- `src/core/{batch,capture,dom,ui}.js` — consume helpers; drop duplicated idioms
- `tests/dom.test.js`, `tests/target_reads.test.js` — update/extend

### Task 5: R4 wait-adoption sweep (60-90 min)
**Goal:** every raw sleep either polled by condition or on the shared helper, per the recorded rule.
**Deliverables:**
- 15 core modules — per-site classification + migration at code-analysis time (IA-3)
- `tests/` — DI-inject sleep/wait in affected modules

### Task 6: R5 health-module split (45-60 min)
**Goal:** `health.js` probes-only → `core/launch.js`, `core/update_check.js`.
**Deliverables:**
- `src/core/health.js`, `src/core/launch.js`, `src/core/update_check.js` (+ `src/core/index.js`, CLI import adjustment)
- `tests/launch.test.js`, `tests/update.test.js` — relocated harnesses

## Success Criteria

Success criteria: [requirements](03-requirements-elicitation.md#success-criteria); baselines and measurement: [implementation analysis](05-implementation-analysis.md#baseline-metrics). Each slice re-runs its SC greps against the measured baseline values. Task-level: no task adds to the named pre-existing failure set (pine_check ×2 live-network-gated; e2e live-Desktop); unit counts never regress below 355/360 on `test:unit`.

## Testing Strategy

Test cases and acceptance matrix: [test plan](06-test-plan.md). Ordering constraint for SC-7 smoke: run only after the R1 pool slice lands; earlier slices verify via greps + unit + existing e2e-adjacent tests. Per-site R4 classification happens at code-analysis time on live UI (IA-3), not as a pre-planned fixture.

## Dependencies & Risks

### Requires (Blockers)
- [ ] TradingView Desktop running with a chart open on 127.0.0.1:9222 for SC-6e/SC-7 verification (implementation only; not plan-time)

### Risks
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Pool default 8 mismatched to real wedge threshold | MEDIUM | MEDIUM | Retain retry/backoff + TV_CDP_BUSY as safety net (IA-4); noted as tunable at verify time |
| TradingView update moves paths mid-task | LOW | LOW | verifyAndReturn per read preserved; R2 itself shrinks the edit surface to one registry |
| R2 slice conflicts arriving main merges | MEDIUM | MEDIUM | Run sync-branch before the plan confirms; per-slice commits keep rebase surface small |
| Deep-import consumers break on R3/R5 moves | MEDIUM | LOW | RE-3 accepted: internal paths not frozen; re-export shims where cheap; CLI co-tested |
| Live-Desktop unavailable at validation | HIGH | LOW | SC-7 gated as smoke-level (RE-4); validation activity retries on live Desktop |

**Status:** Ready for implementation
