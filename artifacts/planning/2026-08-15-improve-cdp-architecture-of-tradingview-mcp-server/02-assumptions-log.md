# Assumptions Log

> Improve CDP Architecture of TradingView MCP Server · #24 · updated 2026-08-15

## Log

One row per assumption, updated in place. IDs: two-letter phase prefix + sequence
(DP-1, RE-1, RS-1, IA-1, PL-1) or task number (1.1, 2.3).

| ID | Phase/Task | Category | Risk | Assumption — rationale | Resolution | Outcome |
|----|------------|----------|------|------------------------|------------|---------|
| DP-1 | Design Philosophy | Workflow Path | M | Full-workflow path is warranted despite thorough prior research — the prior reports are read-only analysis of breaches/build order, not elicited requirements or a synthesized research base for this package, so elicitation + research add genuine value rather than duplicating it | User (classification-and-path-confirmed gate) | Confirmed |
| DP-2 | Design Philosophy | Complexity Assessment | M | `src/connection.js` blast radius (21 direct importers, HIGH) is representative of the whole change's complexity — used as the objective complexity signal; the actual blast radius across all five refactors (R1–R5) is larger but directionally consistent | Code: gitnexus impact on `src/connection.js` (21 d=1 IMPORTS, HIGH) | Validated |
| DP-3 | Design Philosophy | Problem Interpretation | L | Classified as inventive-improvement, not prevention — the 2026-08-14 connection wedges were a real symptom, but the issue frames the work as proactive improvement of a working channel, and no current outage/failure demands a specific-problem fix | User (classification-and-path-confirmed gate) | Confirmed |
| RE-1 | Requirements Elicitation | Requirement Interpretation | M | The issue's build order (R2 → R1 → R3 → R4 → R5) is read as the intended landing sequence, not merely a suggestion — the research presents each R as independently mergeable and the issue states the problem without prescribing solutions, so the order could be revisited | — | Open (stakeholder preference — whether the build order is binding) |
| RE-2 | Requirements Elicitation | Scope Boundaries | M | Event-driven/push redesign and new-tool adoption are out of scope — research §6 names them follow-ups on the cleaned base, and the issue's title frames the package as architecture repair; a stakeholder could read "improve CDP architecture" as including the push direction | — | Open (stakeholder preference — scope boundary confirmation) |
| RE-3 | Requirements Elicitation | Implicit Requirements | M | Backward compatibility covers tool behaviour and the CLI, but not internal module paths — core module splits (R5) and moves (R3) may break deep imports by external consumers of `tradingview-mcp/core`; assumed acceptable because the facade is partial and the package's consumers are in-repo | Code: core/index.js exports 12 namespaces; cli/commands imports beyond them | Partially Validated |
| RE-4 | Requirements Elicitation | Success Criteria Interpretation | L | SC-7's "no TV_CDP_BUSY on a parallel-tab scenario" is a smoke-level bar, not a load-tested guarantee — live-Desktop verification is scenario-based; a statistical contention measurement is beyond this package's verification means | — | Open (verification-method judgement — may be confirmed at plan) |
| RE-5 | Requirements Elicitation | Implicit Requirements | L | The 88-tool count in server instructions is the compatibility baseline — tools may be neither added nor removed by the refactor; capabilities gating (TV_ALLOW_DANGEROUS) behaviour is preserved as-is | Code: server.js instructions string; capabilities.js wrapRegistrar | Validated |

Resolution: how it was settled — `Code:` with file:line evidence, `User` (checkpoint or
interview), or `—` while open; implementation-task rows append the commit hash for
assumption-to-commit traceability. Outcome: Validated / Invalidated / Partially Validated
(code-resolved) · Confirmed / Corrected: <change> / Deferred: <follow-up> (user-resolved)
· Open (<reason>). When an interpretation difference contributed to an assumption, name
the ambiguity source (observation, recall, requirement reading, ambiguous problem
statement) in the rationale.

## Open Assumptions

### RE-1: Build order is binding
**Assumption:** The R2 → R1 → R3 → R4 → R5 landing sequence is the intended order, not a revisable suggestion  
**Decision space:** (a) follow the research order as-is — lowest risk, registry-first; (b) re-order by value/risk at plan time — e.g. R1 first for the contention fix, at the cost of landing the breach repair before the path registry it benefits from  
**Why not code-resolvable:** the order is a delivery preference; the code supports either  
**Technical context:** research §6 argues registry-first so each new manager is one entry; R1's factory does not depend on R2  
**Agent's position:** (a) — the research's dependency argument (registry as prerequisite for every new manager) holds, and R2 is the lowest-risk slice  
**Reversibility:** easily-reversible

### RE-2: Push/event-driven work is out of scope
**Assumption:** This package is architecture repair (R1–R5); the event-driven direction and new-tool adoption are follow-ups  
**Decision space:** (a) repair only — smallest independently valuable package; (b) include the push redesign — larger, couples the R1 transport work to a protocol redesign  
**Why not code-resolvable:** scope is a stakeholder call about package size and intent  
**Technical context:** research §6 sequences push after R1 (flat sessions + Target/Inspector/toastManager); the 2026-08-14 timeout discussion motivates it but does not require it now  
**Agent's position:** (a) — research §6 explicitly sequences it as a follow-up, and coupling it to R1 would delay the contention fix  
**Reversibility:** easily-reversible

### RE-4: Smoke-level contention bar is sufficient
**Assumption:** SC-7 verifies contention reduction by scenario, not by load test  
**Decision space:** (a) scenario smoke (background read + screenshot + tab switch, no TV_CDP_BUSY) — matches the observed failure mode; (b) scripted parallel-load measurement — stronger evidence, needs a load harness this package does not have  
**Why not code-resolvable:** a judgement about verification rigour vs means  
**Technical context:** the 2026-08-14 wedge was observed interactively, not under a harness; retries already mask transient contention, so a binary pass/fail scenario is the measurable delta  
**Agent's position:** (a) for this package, with (b) recordable as a follow-up  
**Reversibility:** easily-reversible

## Wrap-Up

8 assumptions — 5 validated/confirmed, 3 open (RE-1, RE-2, RE-4 — all stakeholder-preference items with an agent position stated). No corrected, invalidated, or deferred items.
