# Pine live-edit loop: wrong plot values, compile adds the library, wizard writes the editor — September 2026

> Bug-Fix · Created 2026-09-09 · **Status:** In Progress

> **Note:** effort estimates are agentic (AI-assisted) development time plus separate human review time.

## 🎯 Executive Summary

[2-3 sentences explaining what this delivers and why it matters]

## Problem Overview

Agents that update a published Pine library (reusable chart-indicator code) on TradingView Desktop currently get silently wrong plot numbers when they ask for a subset of series, can drop the library onto a live chart when they only meant to compile, and can type publish notes into the code editor because the generic fill tool misses the wizard field.

Those failures make a library update unsafe: the agent debugs the wrong values, pollutes a production layout, or nearly publishes wizard text as source. Closing the update wizard with the same Close control used for the editor can also raise a prompt that would delete the already-published library.

## Solution Overview

Each of the seven traps gets a small, local fix in the tool that causes it: plot numbers are read from the right column, compiling a reusable library saves it without dropping it onto a live chart, publish notes go only into the notes field, Close buttons are told apart so a published library is not offered for deletion, unsaved editor text is kept unless the agent asks to reload, an already-open publish window is continued rather than opened twice, and a screenshot of the chart is refused when a menu is covering it.

That keeps a routine library update safe to run unattended: the agent sees the real plot values, does not pollute a production layout, and cannot overwrite or delete a published library by clicking the wrong Close or filling the wrong box.

## 📊 Progress

| # | Item | Description | Estimate | Status |
|---|------|-------------|----------|--------|
| 1 | [Start work package](README.md) | Issue, branch, worktree, planning folder | 20-40m | ✅ |
| 2 | [Design philosophy](02-design-philosophy.md) | Problem classification, workflow path | 15-30m | ✅ |
| 3 | [Assumptions log](02-assumptions-log.md) | Tracked assumptions across activities | 10-15m | ✅ |
| 4 | [Codebase comprehension](15-codebase-comprehension.md) | Persistent knowledge under comprehension/ | 20-45m | ✅ |
| 5 | Requirements elicitation | Scope, success criteria, boundaries | 30-60m | ⊘ |
| 6 | KB research | Knowledge-base and web synthesis | 20-45m | ⊘ |
| 7 | Implementation analysis | Baselines, gaps, measurement | 20-45m | ⊘ |
| 8 | [Work package plan](06-work-package-plan.md) | Tasks, estimates, dependencies | 20-45m | ✅ |
| 9 | [Test plan](06-test-plan.md) | Test cases, coverage strategy | 15-30m | ✅ |
| 10 | [Deferred items](deferred-items.md) | Out-of-scope deferral register | 5-10m | ⬚ |
| 11 | [Follow-ups](follow-ups.md) | In-task follow-ups register | 5-10m | ⬚ |
| 12 | [Assumptions review](02-assumptions-log.md) | Converge open assumptions | 20-40m | ✅ |
| 13 | Implementation | Code changes per plan | 1-4h | ✅ |
| 14 | [Provenance log](08-provenance-log.md) | Per-task AI-assistance provenance | 5-15m | ✅ |
| 15 | Lean-coding audit | Ponytail lean lens on the change | 15-30m | 🟡 |
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
| GitHub Issue | [#32](https://github.com/m2ux/tradingview-mcp/issues/32) |
| PR | [#33](https://github.com/m2ux/tradingview-mcp/pull/33) |
| Branch | `fix/32-pine-live-edit-loop-wrong-plot-values` |
