# Improve CDP Architecture of TradingView MCP Server — August 2026

> Enhancement · Created 2026-08-15 · **Status:** Complete

> **Note:** effort estimates are agentic (AI-assisted) development time plus separate human review time.

## 🎯 Executive Summary

Refactors the TradingView MCP server's CDP interface to fix five evidence-backed architecture breaches: transport-layer bypass by domain modules, an ignored page-path registry, scattered CDP protocol calls, duplicated magic-number sleeps, and a cohesion grab-bag health module. The result is a clean stratified layer stack that is cheaper to change, unblocks adoption of new TradingView manager surfaces, and removes the single-WebSocket contention wedges observed under parallel tab operations.

## Problem Overview

The TradingView MCP server drives a live TradingView Desktop chart through a single internal channel (the Chrome DevTools Protocol), and every one of its 88 tools depends on that channel being reliable. That channel was built in clean layers, but as features were added it grew a set of shortcuts: some parts of the code open their own private connections instead of sharing the managed one, the addresses of TradingView's internal objects are copied by hand into about a dozen files instead of being kept in one registry, low-level remote-control calls are scattered across several modules, and one file mixes health checks with unrelated jobs like launching the app and checking for updates.

The consequences are practical. Competing private connections caused the connection wedges seen on 2026-08-14 when several chart tabs were worked in parallel. Because the internal addresses are duplicated everywhere, any TradingView update that moves them means editing many files and hoping none were missed. And because the building blocks are tangled, adding valuable new capabilities — market-mover lists, richer backtesting, account operations, push-style alert notifications — is far harder than it should be. This work package cleans up the channel's structure so it stays dependable and cheap to extend.

## Solution Overview

Every tool this server offers talks to TradingView through one private channel, and over time some parts of the code started opening their own ad-hoc side-channels and copying internal addresses by hand. This work repairs that repair work in five small, independently landable slices: first every internal address is read from one shared registry, so a change on TradingView's side becomes a one-line edit instead of a hunt through a dozen files; the scattered side-channels are replaced by a single managed connection point that hands out short-lived connections safely and reuses them within a modest bound; low-level remote-control calls are gathered behind one protocol module; stray fixed delays are moved onto the existing shared wait helpers; and one over-crowded file is split into three focused ones. The push-notification and new-tool directions stay out of scope on purpose — they are follow-ups on this cleaned base.

For the people relying on it, the guarantee is simple: nothing about how the 88 tools or the command-line behave changes — automated tests and a live-Desktop smoke check confirm that at every slice — while working with several chart tabs at once no longer wedges the connection the way it did on 2026-08-14. Future additions (market-mover lists, richer backtesting, account operations, alert notifications) become a registry entry plus a factory call, which is what makes this worth doing now rather than later.

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
| 8 | [Work package plan](06-work-package-plan.md) | Tasks, estimates, dependencies | 20-45m | ✅ |
| 9 | [Test plan](06-test-plan.md) | Test cases, coverage strategy | 15-30m | ✅ |
| 10 | Deferred items | Out-of-scope deferral register — none created | 5-10m | ⊘ |
| 11 | Follow-ups | In-task follow-ups register — none created | 5-10m | ⊘ |
| 12 | Assumptions review | Converge open assumptions | 20-40m | ✅ |
| 13 | Implementation | Code changes per plan | 1-4h | ✅ |
| 14 | [Provenance log](provenance-log.md) | Per-task AI-assistance provenance | 5-15m | ✅ |
| 15 | Lean-coding audit | Ponytail lean lens on the change | 15-30m | ✅ |
| 16 | [Code review](09-code-review.md) | Consolidated review findings home | 15-30m | ✅ |
| 17 | Lean change | Applied lean simplifications record — no standalone file | 10-20m | ⊘ |
| 18 | Post-implementation review | Quality review before validation | 30-60m | ✅ |
| 19 | [Change block index](10-change-block-index.md) | Indexed diff hunks for review | 5-10m | ✅ |
| 20 | [Code review method](10-code-review-method.md) | What the code review walked and swept | 5-10m | ✅ |
| 21 | [Test suite review](10-test-suite-review.md) | Test quality and coverage | 10-20m | ✅ |
| 22 | [Test suite review method](10-test-suite-review-method.md) | Suite baseline, coverage map, sweeps | 5-10m | ✅ |
| 23 | Structural analysis | Prism L12 when written standalone | 15-30m | ⊘ |
| 24 | [Architecture summary](10-architecture-summary.md) | Stakeholder architecture overview | 15-30m | ✅ |
| 25 | Validation | Build, test, lint verification | 15-30m | ✅ |
| 26 | [Strategic review](12-strategic-review-1.md) | Scope/minimality series (`strategic-review-{n}`) | 15-30m | ✅ |
| 27 | [Strategic review method](12-strategic-review-1-method.md) | Scope, conformance, minimality and delivery passes | 5-10m | ✅ |
| 28 | Submit for review | PR review lifecycle / stealth push | 30-60m | ✅ |
| 29 | [Close-out](14-COMPLETE.md) | Deliverables, limitations, retrospective; ADR when owed | 10-20m | ✅ |
| 30 | Token usage | Session token and cost summary — no figures recorded | 5-10m | ⊘ |
| 31 | [Session trace](14-session-trace.md) | Lean mechanical execution trace | 5-10m | ✅ |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked · ⊘ cancelled / N/A

## 🔗 Links

| Resource | Link |
|----------|------|
| GitHub Issue | [#24](https://github.com/m2ux/tradingview-mcp/issues/24) |
| Pull Request | [#25](https://github.com/m2ux/tradingview-mcp/pull/25) (still draft — REST cannot undraft) |
| Prior research | [CDP interface analysis & opportunity map](../2026-08-15-tradingview-mcp-cdp-architecture/README.md) |
