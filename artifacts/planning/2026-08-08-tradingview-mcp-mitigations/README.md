# TradingView MCP Security Mitigations — August 2026

> Enhancement · Created 2026-08-08 · **Status:** Planning

> **Note:** effort estimates are agentic (AI-assisted) development time plus separate human review time.

## 🎯 Executive Summary

[2-3 sentences explaining what this delivers and why it matters]

## Problem Overview

The tradingview-mcp server gives an AI agent deep control over a live, logged-in TradingView Desktop chart — 84 tools that can read prices, draw on the chart, run code inside the app, update the server itself, and launch or kill the desktop program. A security audit found that some of these powers are switched on for every user by default with no safety gate: an agent that is tricked by hostile text on a chart or a webpage could run arbitrary code, pull down and install new software, or wipe drawings and alerts without the owner ever being asked.

If those weaknesses were abused, the blast radius is the user's whole trading workstation: the agent acts with the same permissions as the person logged in. The audit also found that the project's automated build and test pipeline trusts unpinned third-party code, and that program dependencies are only loosely versioned — both common ways supply-chain attacks slip in. This work package exists to close those holes before they are exploited, while keeping the tool's everyday usefulness intact.

## Solution Overview

The server is being made safe by default. The small set of tools that can run code inside TradingView, update the program itself, launch or kill the desktop app, or wipe drawings and alerts will simply not exist for an agent unless the owner has deliberately switched them on. The all-purpose "run any JavaScript" tool is removed entirely; in its place, new capabilities are added one at a time, each reviewed and approved by a human before it becomes available. On top of that, everything the agent reads back from the chart — prices, labels, notes drawn by indicators — is wrapped in a clear "this is data, not instructions" marker, so hostile text hidden in chart content cannot quietly steer the agent into doing something the owner never asked for.

What the owner gets is a guarantee about where the line sits: the gate lives in the server's tool registry, which the agent cannot talk its way around, rather than in prompts or filters that can be tricked. The self-update path now proves what it is downloading before it installs anything and stops dead if installation fails, and the automated build pipeline only uses pinned, verifiable third-party code. Everyday chart reading stays exactly as it was — all the read-only tools remain on by default — while the dangerous powers become a conscious, auditable choice, verified by an automated test suite that runs on every change.

## 📊 Progress

| # | Item | Description | Estimate | Status |
|---|------|-------------|----------|--------|
| 1 | Start work package | Issue, branch, worktree, planning folder | 20-40m | ✅ |
| 2 | [Prior feedback triage](01-prior-feedback-triage.md) | Review-mode prior feedback ingest | 15-30m | ⊘ |
| 3 | [Design philosophy](02-design-philosophy.md) | Problem classification, workflow path | 15-30m | ✅ |
| 4 | [Assumptions log](02-assumptions-log.md) | Tracked assumptions across activities | 10-15m | ✅ |
| 5 | [Requirements elicitation](03-requirements-elicitation.md) | Scope, success criteria, boundaries | 30-60m | ✅ |
| 6 | [KB research](04-kb-research.md) | Knowledge-base and web synthesis | 20-45m | ✅ |
| 7 | [Implementation analysis](05-implementation-analysis.md) | Baselines, gaps, measurement | 20-45m | ✅ |
| 8 | [Work package plan](06-work-package-plan.md) | Tasks, estimates, dependencies | 20-45m | ✅ |
| 9 | [Test plan](06-test-plan.md) | Test cases, coverage strategy | 15-30m | ✅ |
| 10 | [Deferred items](deferred-items.md) | Out-of-scope deferral register | 5-10m | ⬚ |
| 11 | [Follow-ups](follow-ups.md) | In-task follow-ups register | 5-10m | ⬚ |
| 12 | Assumptions review | Converge open assumptions | 20-40m | ✅ |
| 13 | Implementation | Code changes per plan | 1-4h | ✅ |
| 14 | [Provenance log](08-provenance-log.md) | Per-task AI-assistance provenance | 5-15m | ✅ |
| 15 | Lean-coding audit | Ponytail lean lens on the change | 15-30m | ✅ |
| 16 | [Code review](09-code-review.md) | Consolidated review findings home | 15-30m | ✅ |
| 17 | [Debt ledger](09-debt-ledger.md) | Harvested ponytail debt markers | 10-20m | ✅ |
| 18 | [Lean change](09-lean-change.md) | Applied lean simplifications record | 10-20m | ⬚ |
| 19 | Post-implementation review | Quality review before validation | 30-60m | ✅ |
| 20 | [Change block index](10-change-block-index.md) | Indexed diff hunks for review | 5-10m | ✅ |
| 21 | [Test suite review](10-test-suite-review.md) | Test quality and coverage | 10-20m | ✅ |
| 22 | [Structural analysis](10-structural-analysis.md) | Prism L12 when written standalone | 15-30m | ⊘ |
| 23 | [Architecture summary](10-architecture-summary.md) | Stakeholder architecture overview | 15-30m | ✅ |
| 24 | Validation | Build, test, lint verification | 15-30m | 🟡 |
| 25 | [Strategic review](12-strategic-review-1.md) | Scope/minimality series (`strategic-review-{n}`) | 15-30m | ⬚ |
| 26 | Submit for review | PR review lifecycle / stealth push | 30-60m | ⬚ |
| 27 | [Close-out](14-COMPLETE.md) | Deliverables, limitations, retrospective; ADR when owed | 10-20m | ⬚ |
| 28 | [Token usage](14-token-usage.md) | Session token and cost summary | 5-10m | ⬚ |
| 29 | [Session trace](14-session-trace.md) | Lean mechanical execution trace | 5-10m | ⬚ |
| 30 | Codebase comprehension | Persistent knowledge under comprehension/ | 20-45m | ✅ |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked · ⊘ cancelled / N/A

## 🔗 Links

| Resource | Link |
|----------|------|
| Security audit | [2026-08-08-tradingview-mcp-security-audit](../../../../caliper/.engineering/artifacts/planning/2026-08-08-tradingview-mcp-security-audit/mitigation-plan.plan.md) |
