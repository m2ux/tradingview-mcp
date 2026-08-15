# Test Plan: Improve CDP Architecture of TradingView MCP Server

> **ADR:** — pending (close-out may owe one) · **Ticket:** [#24](https://github.com/m2ux/tradingview-mcp/issues/24) · **PR:** [#25](https://github.com/m2ux/tradingview-mcp/pull/25)

## Overview

This test plan validates the five-slice CDP-architecture repair (R1–R5) of the tradingview-mcp server: transport-layer scoped-client factory/pool, page-path `KNOWN_PATHS` registry adoption, protocol-call consolidation, wait-helper adoption, and `health.js` cohesion split — all with a behaviour-identical 88-tool surface and CLI.

Key changes to validate:
1. `connection.js` `listTargets()`/scoped-client factory — single target listing, pooled lifecycle-aware scoped clients preserving retry/`TV_CDP_BUSY`
2. `KNOWN_PATHS` adoption across 10 modules — one registry, verified-on-read
3. Protocol helpers — `Page.*`/`Input.*` confined to one designated protocol module
4. Wait helpers — sleep sites on shared poll-or-delay rules
5. `health.js` split — probes/launch/update-check separation, CLI compatibility

## Planned Test Cases

| Test ID | Objective | Type |
|---------|-----------|------|
| PR25-TC-01 | Verify zero `chrome-remote-interface` imports / `CDP({...})` opens outside sanctioned factory sites in `src/core/*` (SC-1 structural grep + module confinement) | Unit |
| PR25-TC-02 | Verify `withTargetEvaluate` routes through the factory with same retry/TV_CDP_BUSY semantics (stub-backed, existing `with_target_evaluate.test.js` updated) | Unit |
| PR25-TC-03 | Verify the pool reuses a live client per target and evicts on `closed`/LRU (liveness probe + eviction paths) | Unit |
| PR25-TC-04 | Verify zero `window.TradingViewApi._*` literals outside `src/connection.js` (SC-2 structural grep) | Unit |
| PR25-TC-05 | Verify verified getters (`getChartApi`/`getChartCollection`/…) raise named errors when paths absent (verifyAndReturn preserved per read) | Unit |
| PR25-TC-06 | Verify `Page.*`/`Input.*`/`Emulation.*` grep confined to the designated protocol module (SC-3 structural) | Unit |
| PR25-TC-07 | Verify dom/ui/capture/batch consume protocol helpers for screenshot/mouse/key/insertText (existing `dom.test.js`/`target_reads.test.js` extended) | Unit |
| PR25-TC-08 | Verify every retained fixed sleep carries a per-site rationale and pollable conditions migrate to bounded poll-or-timeout (SC-4 policy record + grep) | Unit |
| PR25-TC-09 | Verify `health.js` exports probes only; `launch`/update-check units still pass from their new modules (existing `launch.test.js`/`update.test.js`) | Unit |
| PR25-TC-10 | Verify named pre-existing failure set does not grow and unit pass count ≥ 355/360 (`npm run test:unit`) — failure names recorded per run | Unit |
| PR25-TC-11 | Verify e2e smoke on live Desktop: chart read, screenshot, tab list, background-tab read all succeed behaviour-identically (SC-6 live) | Manual |
| PR25-TC-12 | Verify parallel-tab scenario: background-tab read + screenshot + tab-switch completes with no `TV_CDP_BUSY` (SC-7 smoke, post-R1 pool slice only) | Manual |

*Detailed steps, expected results, and source links will be added after implementation.*

## Acceptance Criteria Matrix

| Requirement | Acceptance Criterion | Verifying Test Cases |
|-------------|----------------------|----------------------|
| SC-1 | Zero unsanctioned CDP imports/opens; unit tests pass | PR25-TC-01, PR25-TC-02, PR25-TC-03 |
| SC-2 | Zero literals outside connection.js | PR25-TC-04, PR25-TC-05 |
| SC-3 | Protocol calls confined to the protocol module | PR25-TC-06, PR25-TC-07 |
| SC-4 | 32-site raw sleeps consolidated with per-site policy | PR25-TC-08 |
| SC-5 | health.js probes-only; launch/update-check units pass | PR25-TC-09 |
| SC-6 | 88-tool surface + CLI behaviour-identical; live e2e smoke | PR25-TC-10, PR25-TC-11 |
| SC-7 | No TV_CDP_BUSY on the parallel-tab scenario | PR25-TC-12 |
| SC-8 | Five slices land independently mergeable in order R2→R1→R3→R4→R5 | PR25-TC-10 (per-slice unit runs) |

## Running Tests

*Commands will be added after implementation.*

Source baselines and per-criterion probes: [implementation analysis](05-implementation-analysis.md#baseline-metrics) (measured 2026-08-15 at `4ff5104`).
