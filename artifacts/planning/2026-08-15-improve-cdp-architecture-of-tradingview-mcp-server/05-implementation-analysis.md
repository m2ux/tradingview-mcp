# Implementation Analysis — Improve CDP Architecture of TradingView MCP Server

> 2026-08-15 · work package [2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server](README.md) · Complete · measured at `4ff5104` on `chore/24-improve-cdp-architecture`

## Implementation Review

### Existing Location

| Component | Path | Description |
|-----------|------|-------------|
| CDP transport layer | `src/connection.js` (309 lines) | Client singleton with liveness re-check + 5-attempt backoff reconnect; target discovery (`/json/list` ×3 finders); `evaluate`/`evaluateAsync` chokepoint; `withTargetEvaluate` scoped-client bypass with `isTransientCdpError` + 4× retry + `TV_CDP_BUSY`; `KNOWN_PATHS` registry + verified getters; loopback guard; interpolation safety |
| Transport breach — tab ops | `src/core/tab.js` | 3 private `CDP({...})` sockets (`withShell` probe, `isTargetVisible`, `withTarget`); 5 duplicated `/json/list` fetches; shell-window DOM driving for the Desktop tab bar |
| Transport breach — screenshots | `src/core/capture.js` | `_makeScopedClient` private socket; `Page.enable` + `Page.captureScreenshot` direct protocol calls |
| Protocol-layer candidates | `src/core/dom.js`, `src/core/ui.js`, `src/core/batch.js` | `Input.dispatch*`/`insertText` in dom.js (7 sites) + ui.js (8 sites); `Page.captureScreenshot` duplicated in batch.js:41 |
| Wait helpers | `src/wait.js`, `src/core/dom.js` | `waitForChartReady`/`waitForChartRender` structured waits (adopted by batch/data/chart); bare `sleep` in dom.js |
| Health grab-bag | `src/core/health.js` (489 lines) | `healthCheck`/`discover`/`uiState` page probes + `launch`/kill/MSIX-copy machinery + `checkForUpdate` git-compare |
| Tool surface | `src/server.js`, `src/tools/*` (16 registrars) | 88 tools (95 with `TV_ALLOW_DANGEROUS=1`), zod-validated, fenced via `jsonResult` |
| CLI | `src/cli/` | `tv` bin; consumes core modules beyond the public facade (tab/stream/pane/capture/study/dom) |

### Usage Patterns

Nearly all chart interaction funnels through `connection.js` `evaluate()` — ~150 expression-evaluating call sites across 19 core modules (heaviest: replay 27, pine 18, chart 16, indicators 11, ui 10 + 8 `Input.*`). `withTargetEvaluate` serves background-tab reads (target param on read tools); private sockets serve screenshots and tab management. Call frequency: one transport round-trip per MCP tool call; all 88 tools transit the channel continuously.

### Dependencies

**Depends on:** `chrome-remote-interface@0.33.3` (vendor CDP client, flat-session capable); TradingView Desktop CDP endpoint `127.0.0.1:9222` (undocumented internals); `child_process` (health.js launch); `fetch` (target listing, pine facade).

**Depended on by:** all 16 tool registrars, the CLI, 21 `connection.js` importers, 12 re-exported namespaces in `core/index.js` (de-facto public per the CLI's deeper reach).

### Architecture

Intended stratified, acyclic 4-layer flow: `server.js` → `tools/*` → `core/*` → `connection.js` → `chrome-remote-interface`. A DI seam (`_resolve(_deps)`) wraps the transport in 11 core modules for testability; 7 bind directly. **Known technical debt (R1–R5 breaches):** three private-socket sites form an unsanctioned second transport layer with retry-as-mitigation; ~15 registry-bypass path-literal sites across 10 modules; protocol-domain calls scattered across 4 modules with duplicated idioms; 52 raw `setTimeout` sites (46 excluding wait.js itself) bypassing two existing shared helpers; health.js mixing 3 unrelated concerns.

## Effectiveness Evaluation

### What's Working Well

| Capability | Evidence | Confidence |
|------------|----------|------------|
| Shared-client chokepoint for the standard tool path | ~150 call sites served; 199/203 tests pass on the default `npm test` set | HIGH |
| Transient-contention detection on the scoped path | `isTransientCdpError` + 4× retry + `TV_CDP_BUSY` retryable marker in `withTargetEvaluate`; stub-backed test `with_target_evaluate.test.js` passes | HIGH |
| Registry idiom | `KNOWN_PATHS` + `verifyAndReturn` getters consumed by data.js (map import) and drawing/batch/replay (getters) — the in-tree exemplar | HIGH |
| Structured wait helpers | `wait.js` adopted by batch/data/chart; DI-injectable in tests | HIGH |
| Output fencing | `fenceString`/`fenceValue` at the single response funnel; fencing tests pass | HIGH |

### What's Not Working

| Issue | Evidence | Impact |
|-------|----------|--------|
| Private-socket contention wedges | `withTargetEvaluate` header comment documents endpoint closing fresh sockets when busy; retry machinery mitigates rather than removes; wedge observed under parallel tab work 2026-08-14 | HIGH |
| Registry bypass scatter | 25 `window.TradingViewApi._*` literals in 10 modules outside connection.js (rg count, 2026-08-15); a TradingView layout change is a ~15-site edit | HIGH |
| Protocol calls scattered | 17 `Page.*`/`Input.*` call sites across batch/capture/dom/ui (rg count); duplicated screenshot call (capture.js:104, batch.js:41); duplicated mouse-click idioms (dom.js:30-36, ui.js:380-386) | MEDIUM |
| Raw sleeps unconsolidated | 52 `setTimeout` matches; only wait.js (6) is sanctioned infrastructure; 46 across 15 core modules (tab 8, ui 7, chart 5, pine 5, health 4, pane 3, …) | MEDIUM |
| Health cohesion smell | 489-line module mixing page probes, process launch (MSIX copy, detached spawn, CDP-wait), and git update-check | MEDIUM |
| Pre-existing test skew | `pine_check — server compile` fails ×2 (cli.test.js #3, pine_workflow.test.js #35); e2e.test.js harness failure in multi-file `npm test` — all live-dependency (pine-facade network upload) / live-Desktop gated and pre-date this package on an untouched scaffold branch | LOW (for this package) |

### Workarounds in Place

- **Retry/`TV_CDP_BUSY` on the scoped path** — masks endpoint contention instead of removing its cause (unbounded competing sockets); the retry comments are the wedge's documentary evidence.
- **Per-module `CHART_API`/`CWC` literals** — local constants duplicating registry values as the de-facto workaround for not adopting the registry.
- **Ad-hoc fixed sleeps** — per-call-site settle delays instead of the shared helpers that already exist.

## Baseline Metrics

| Metric | Current Value | Measurement Method | Date Measured |
|--------|--------------|-------------------|---------------|
| Bypass sites (SC-1) | 3 import sites outside transport: tab.js ×3 sockets, capture.js ×1 | `rg "chrome-remote-interface\|CDP(\{" src/` | 2026-08-15 |
| Registry-bypass literals (SC-2) | 25 literals / 10 modules outside connection.js | `rg "window\.TradingViewApi\._" src/ --glob '!src/connection.js'` | 2026-08-15 |
| Protocol-domain calls (SC-3) | 17 sites / 4 modules (dom 7, ui 8, capture 1, batch 1) | `rg "Page\.\|Input\.\|Emulation\." src/core/` | 2026-08-15 |
| Raw `setTimeout` sites (SC-4) | 52 total; 46 outside wait.js across 15 modules | `rg "setTimeout" src/core/ src/wait.js` (per-module counts) | 2026-08-15 |
| Health module (SC-5) | 489 lines; 3 concerns (probe / launch+MSIX / update-check) | `wc -l` + export listing | 2026-08-15 |
| `/json/list` fetch sites | 8: connection.js ×3 (finders) + tab.js ×5 (duplicates) | `rg "/json/(list\|version)" src/` | 2026-08-15 |
| Unit tests (SC-6) | 355/360 pass (`test:unit`, 88 suites, ~31 s); 5 failures = pine_check ×2 live-network gated + e2e/live-Desktop harness lineage, pre-existing | `npm run test:unit` (node --test) | 2026-08-15 |
| Connection blast radius | 21 direct importers of connection.js (gitnexus HIGH) | `rg -l "from.*connection" src/` + gitnexus impact (DP-2) | 2026-08-15 |
| Live Desktop contention (SC-7) | Not measured — requires live Desktop; failure mode documented in code comments + 2026-08-14 incident | qualitative; smoke scenario planned post-R1 | — |

### Key Findings

- The wedge is endpoint busy-behavior, not numeric exhaustion: observed sockets (~a handful) sit far below Chromium's ~30/host, ~255/global limits — a bounded pool + retry is right-sized (research Web 3).
- Consolidations are adoption sweeps over proven in-tree idioms, not new infrastructure: registry getters (drawing/batch/replay), structured waits (wait.js adopters), and the evaluate chokepoint (~150 sites) already define the patterns the breaches must rejoin.
- The DI seam in 11 core modules means a transport refactor preserving exported signatures lands behind seams with no call-site edits; the 7 direct-binding modules are the mechanical tail.

## Gap Analysis

| ID | Gap | Current State | Desired State | Impact | Priority |
|----|-----|---------------|---------------|--------|----------|
| G1 | No transport-owned scoped-client factory; unbounded sockets | 4 unsanctioned opens + 5 duplicate `/json/list` fetches; no bound on concurrent sockets | One factory/pool in connection.js; `listTargets()` consolidation; lifecycle-aware release | SC-1, SC-7: wedge removal; contention bounded | HIGH |
| G2 | Registry honoured two ways, ignored a third | 25 literals across 10 modules | All path reads via `KNOWN_PATHS` (map or verified getters) | SC-2: one-registry edit on TradingView moves | HIGH |
| G3 | Protocol calls outside the protocol layer | 17 sites / 4 modules, duplicated idioms | `Page.*`/`Input.*` confined to designated module(s) | SC-3: single protocol surface | MEDIUM |
| G4 | Sleep scatter | 52 raw sites with ad-hoc durations | Shared helpers; per-site poll-vs-delay policy recorded | SC-4: consistent, named waits | MEDIUM |
| G5 | Health grab-bag | 489 lines, 3 concerns, deep-import risk (RE-3) | health.js page-probe only; launch + update-check modules | SC-5: cohesion; cheap edits | MEDIUM |
| G6 | Behavior-identical constraint vs wide blast radius | 21 direct importers; 7 direct-binding modules; CLI reaches beyond facade | Verification chain: greps + unit tests + live e2e smoke | SC-6: no regressions | HIGH |

## Opportunities for Improvement

### Quick Wins (Low Effort, High Impact)

1. **R2 registry sweep first (build-order anchor):** literals are identical to registry values, so substitution is mechanical with zero behavioral risk — Expected impact: SC-2 green, smallest independent slice; Effort: ~1 h.
2. **R5 three-file split (no cross-calls):** probe/launch/update-check are disjoint — Expected impact: SC-5 green by a pure move; Effort: ~1 h.
3. **`listTargets()` export:** collapse tab.js's 5 fetches onto one finder — Expected impact: R1's consolidation half for near-zero risk; Effort: <0.5 h.

### Structural Improvements (Higher Effort)

1. **R1 scoped-client factory + bounded pool** in connection.js, replacing all 4 bypass opens; browser-level session authority for target listing validated by research but staying N-socket (flatten deferred). Expected impact: SC-1/SC-7; Effort: ~2-3 h incl. stub-test updates.
2. **R3 protocol-layer consolidation** of dom/ui/capture/batch calls behind connection/dom modules. Expected impact: SC-3; Effort: ~1-2 h.
3. **R4 wait adoption sweep** with one recorded decision rule (poll when a condition is nameable, shared sleep otherwise). Expected impact: SC-4; Effort: ~1-2 h over 46 sites.

### Optimization Opportunities

1. **Pool parameterization at plan time (C-1):** size/eviction defaults tuned to TradingView's undocumented endpoint with retry/backoff safety net — no published source exists, so measured defaults + code-analysis experiment are the plan's deliverable. Expected impact: contention headroom without over-provisioning.

## Success Criteria

Success criteria: [requirements](03-requirements-elicitation.md#success-criteria). This document contributes baselines and gaps; SC-1–SC-5 verification commands are the exact `rg`/`wc` probes measured above (re-run post-refactor expecting zero/one-target values); SC-7 remains scenario-smoke per RE-4. No analysis-derived targets beyond requirements.

### Measurement Strategy

- **Structural greps** (SC-1..SC-4): the baseline commands above, re-run per slice; SC-1/SC-3 also asserted by unit tests added per refactor.
- **Behavior chain** (SC-6): `npm run test:unit` green meaning "no worse than the 355/360 pre-existing-skew baseline" (the 5 failures must not grow and must carry failure names each run to compare against). The 5 are live-network/stub-gated — `pine check` tests compile against the real pine-facade endpoint over `TV_ALLOW_PINE_CHECK_UPLOAD=1` via stdin/source upload (cli.test.js:135-141; pine_workflow.test.js:35), failing with exit 1 on network/endpoint unavailability regardless of the CDP refactor, and `e2e.test.js` is a live-Desktop file failing at harness level under the multi-file run. Lint green; e2e smoke on live Desktop (chart read, screenshot, tab list, background-tab read) is the behavior gate.
- **Contention scenario** (SC-7): post-R1 background-tab read + screenshot + tab-switch sequence on live Desktop completes without `TV_CDP_BUSY`.
- **Mergeability** (SC-8): five commits/slices in order R2 → R1 → R3 → R4 → R5 on `chore/24-improve-cdp-architecture`, each independently green.

## Sources of Evidence

| Source | Type | What It Showed |
|--------|------|----------------|
| Comprehension corpus ([tradingview-mcp.md](../../comprehension/tradingview-mcp.md)) at `4ff5104` | Code analysis | Layer map, breach inventory, invariant-gap table |
| Prior research [01-breach analysis](../../planning/2026-08-15-tradingview-mcp-cdp-architecture/01-existing-architecture-analysis.md), [02-external research](../../planning/2026-08-15-tradingview-mcp-cdp-architecture/02-external-research-and-opportunities.md) | Research | R1–R5 evidence with file:line; build order |
| [04-kb-research.md](04-kb-research.md) | Research synthesis | Endpoint-contention norms; pool sizing, wait-idiom validation; C-1/C-3 handoffs |
| Worktree rg/wc/lob probes (this document) | Direct measurement | All baseline counts, measured 2026-08-15 at `4ff5104` |
| `npm run test:unit` output | Test run | 355/360; pre-existing pine_check ×2 + e2e-harness failures |

**Status:** Ready for plan-prepare activity
