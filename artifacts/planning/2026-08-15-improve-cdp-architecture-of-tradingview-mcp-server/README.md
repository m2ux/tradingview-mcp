# Improve CDP Architecture of TradingView MCP Server — August 2026

> Enhancement · Created 2026-08-15 · **Status:** Planning

> **Note:** effort estimates are agentic (AI-assisted) development time plus separate human review time.

## 🎯 Executive Summary

Refactors the TradingView MCP server's CDP interface to fix five evidence-backed architecture breaches: transport-layer bypass by domain modules, an ignored page-path registry, scattered CDP protocol calls, duplicated magic-number sleeps, and a cohesion grab-bag health module. The result is a clean stratified layer stack that is cheaper to change, unblocks adoption of new TradingView manager surfaces, and removes the single-WebSocket contention wedges observed under parallel tab operations.

## Problem Overview

The TradingView MCP server drives a live TradingView Desktop chart through a single internal channel (the Chrome DevTools Protocol), and every one of its 88 tools depends on that channel being reliable. That channel was built in clean layers, but as features were added it grew a set of shortcuts: some parts of the code open their own private connections instead of sharing the managed one, the addresses of TradingView's internal objects are copied by hand into about a dozen files instead of being kept in one registry, low-level remote-control calls are scattered across several modules, and one file mixes health checks with unrelated jobs like launching the app and checking for updates.

The consequences are practical. Competing private connections caused the connection wedges seen on 2026-08-14 when several chart tabs were worked in parallel. Because the internal addresses are duplicated everywhere, any TradingView update that moves them means editing many files and hoping none were missed. And because the building blocks are tangled, adding valuable new capabilities — market-mover lists, richer backtesting, account operations, push-style alert notifications — is far harder than it should be. This work package cleans up the channel's structure so it stays dependable and cheap to extend.

## Solution Overview

Repairs the CDP layer stack in five independently mergeable slices, in the research build order: centralize all page paths through the `KNOWN_PATHS` registry (R2); replace the three private-socket bypass sites with a transport-provided scoped-client factory and consolidate target listing (R1); move raw CDP protocol-domain calls behind the protocol layer (R3); route the 32 raw sleeps onto shared wait helpers (R4); and split `core/health.js` into page-probe health, process launch, and update-check modules (R5). The 88-tool surface and CLI stay behaviour-identical throughout, verified by green unit tests plus live-Desktop e2e smoke, with parallel-tab contention checked by a no-`TV_CDP_BUSY` scenario. New manager surfaces and the event-driven (push) direction are explicitly follow-ups on the cleaned base. Full scope and criteria: [requirements](03-requirements-elicitation.md).

## 📊 Progress

| # | Item | Description | Estimate | Status |
|---|------|-------------|----------|--------|
| 1 | Start work package | Issue, branch, worktree, planning folder | 20-40m | ✅ |
| 2 | [Design philosophy](02-design-philosophy.md) | Problem classification, workflow path | 15-30m | ✅ |
| 3 | [Assumptions log](02-assumptions-log.md) | Tracked assumptions across activities | 10-15m | ✅ |
| 4 | Codebase comprehension | Persistent knowledge under comprehension/ | 20-45m | ✅ |
| 5 | [Requirements elicitation](03-requirements-elicitation.md) | Scope, success criteria, boundaries | 30-60m | ✅ |
| 6 | [KB research](04-kb-research.md) | Knowledge-base and web synthesis | 20-45m | ✅ |
| 7 | [Implementation analysis](05-implementation-analysis.md) | Baselines, gaps, measurement | 20-45m | ✅ |
| 8 | [Work package plan](06-work-package-plan.md) | Tasks, estimates, dependencies | 20-45m | 🟡 |
| 9 | [Test plan](06-test-plan.md) | Test cases, coverage strategy | 15-30m | ⬚ |
| 10 | [Deferred items](deferred-items.md) | Out-of-scope deferral register | 5-10m | ⬚ |
| 11 | [Follow-ups](follow-ups.md) | In-task follow-ups register | 5-10m | ⬚ |
| 12 | Assumptions review | Converge open assumptions | 20-40m | ⬚ |
| 13 | Implementation | Code changes per plan | 1-4h | ⬚ |
| 14 | [Provenance log](08-provenance-log.md) | Per-task AI-assistance provenance | 5-15m | ⬚ |
| 15 | Lean-coding audit | Ponytail lean lens on the change | 15-30m | ⬚ |
| 16 | [Code review](09-code-review.md) | Consolidated review findings home | 15-30m | ⬚ |
| 17 | [Lean change](09-lean-change.md) | Applied lean simplifications record | 10-20m | ⬚ |
| 18 | Post-implementation review | Quality review before validation | 30-60m | ⬚ |
| 19 | [Change block index](10-change-block-index.md) | Indexed diff hunks for review | 5-10m | ⬚ |
| 20 | [Code review method](10-code-review-method.md) | What the code review walked and swept | 5-10m | ⬚ |
| 21 | [Test suite review](10-test-suite-review.md) | Test quality and coverage | 10-20m | ⬚ |
| 22 | [Test suite review method](10-test-suite-review-method.md) | Suite baseline, coverage map, sweeps | 5-10m | ⬚ |
| 23 | [Structural analysis](10-structural-analysis.md) | Prism L12 when written standalone | 15-30m | ⬚ |
| 24 | [Architecture summary](10-architecture-summary.md) | Stakeholder architecture overview | 15-30m | ⬚ |
| 25 | Validation | Build, test, lint verification | 15-30m | ⬚ |
| 26 | [Strategic review](12-strategic-review-1.md) | Scope/minimality series (`strategic-review-{n}`) | 15-30m | ⬚ |
| 27 | [Strategic review method](12-strategic-review-1-method.md) | Scope, conformance, minimality and delivery passes | 5-10m | ⬚ |
| 28 | Submit for review | PR review lifecycle / stealth push | 30-60m | ⬚ |
| 29 | [Close-out](14-COMPLETE.md) | Deliverables, limitations, retrospective; ADR when owed | 10-20m | ⬚ |
| 30 | [Token usage](14-token-usage.md) | Session token and cost summary | 5-10m | ⬚ |
| 31 | [Session trace](14-session-trace.md) | Lean mechanical execution trace | 5-10m | ⬚ |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked · ⊘ cancelled / N/A

## 🔗 Links

| Resource | Link |
|----------|------|
| GitHub Issue | [#24](https://github.com/m2ux/tradingview-mcp/issues/24) |
| Prior research | [CDP interface analysis & opportunity map](../2026-08-15-tradingview-mcp-cdp-architecture/README.md) |
