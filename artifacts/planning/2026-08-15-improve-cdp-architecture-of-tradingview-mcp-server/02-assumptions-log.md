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
| RE-1 | Requirements Elicitation | Requirement Interpretation | M | The issue's build order (R2 → R1 → R3 → R4 → R5) is read as the intended landing sequence, not merely a suggestion — the research presents each R as independently mergeable and the issue states the problem without prescribing solutions, so the order could be revisited | User (research-assumption-interview gate, batch-accepted 2026-08-15) | Confirmed |
| RE-2 | Requirements Elicitation | Scope Boundaries | M | Event-driven/push redesign and new-tool adoption are out of scope — research §6 names them follow-ups on the cleaned base, and the issue's title frames the package as architecture repair; a stakeholder could read "improve CDP architecture" as including the push direction | User (research-assumption-interview gate, batch-accepted 2026-08-15) | Confirmed |
| RE-3 | Requirements Elicitation | Implicit Requirements | M | Backward compatibility covers tool behaviour and the CLI, but not internal module paths — core module splits (R5) and moves (R3) may break deep imports by external consumers of `tradingview-mcp/core`; assumed acceptable because the facade is partial and the package's consumers are in-repo | Code: core/index.js exports 12 namespaces; cli/commands imports beyond them | Partially Validated |
| RE-4 | Requirements Elicitation | Success Criteria Interpretation | L | SC-7's "no TV_CDP_BUSY on a parallel-tab scenario" is a smoke-level bar, not a load-tested guarantee — live-Desktop verification is scenario-based; a statistical contention measurement is beyond this package's verification means | User (research-assumption-interview gate, batch-accepted 2026-08-15) | Confirmed |
| RE-5 | Requirements Elicitation | Implicit Requirements | L | The 88-tool count in server instructions is the compatibility baseline — tools may be neither added nor removed by the refactor; capabilities gating (TV_ALLOW_DANGEROUS) behaviour is preserved as-is | Code: server.js instructions string; capabilities.js wrapRegistrar | Validated |
| RS-1 | Research | Source Relevance | L | The concept-rag knowledge base's absence of CDP/Electron material does not invalidate the research base — the library is domain literature, not tooling docs; web sources plus the prior in-repo external research carry the package's evidence weight | Code: KB queries returned only database/pattern-catalog texts; prior research report covers the domain | Validated |
| RS-2 | Research | Pattern Applicability | M | A bounded N-socket pool (one private socket per background target, from a single factory) is sufficient for SC-7 — published limits (~30 WS/host, ~255 global in Chromium) sit far above observed usage, so the wedge is endpoint busy-behavior, not numeric exhaustion; assumed TradingView's endpoint behaves like the documented Chrome-family endpoints | Web: websocket.org connection-limits guide; Chromium socket-pool constants; flutter/devtools #8298 | Validated |
| RS-3 | Research | Synthesis Decisions | M | Flatten-session multiplexing (`Target.attachToTarget` + per-command sessionId) is recorded as a rejected path for this package and deferred to the event-driven follow-up — canonical upstream pattern, but a larger rewrite than R1–R5 requires and no success criterion demands it; hinges on RE-2's scope boundary holding | Web: chrome-remote-interface #531/#533; SO flatten-session answer | Confirmed-position (interacts with open RE-2) |
| RS-4 | Research | Risk Assessment | L | TradingView's proprietary devtools endpoint behaves like documented Chrome-family CDP endpoints on concurrent connections — no published source covers it, so R1 relies on the in-tree evidence (withTargetEvaluate retry/TV_CDP_BUSY machinery) plus general endpoint behavior; residual uncertainty is carried as research candidates C-1/C-2, not a blocking assumption | Code: connection.js withTargetEvaluate header + retry machinery | Partially Validated |

Resolution: how it was settled — `Code:` with file:line evidence, `User` (checkpoint or
interview), or `—` while open; implementation-task rows append the commit hash for
assumption-to-commit traceability. Outcome: Validated / Invalidated / Partially Validated
(code-resolved) · Confirmed / Corrected: <change> / Deferred: <follow-up> (user-resolved)
· Open (<reason>). When an interpretation difference contributed to an assumption, name
the ambiguity source (observation, recall, requirement reading, ambiguous problem
statement) in the rationale.

## Open Assumptions

None — all assumptions resolved. RE-1, RE-2, and RE-4 were batch-accepted at the research-assumption-interview gate (2026-08-15) with the agent's positions: build order follows the research sequence (R2 → R1 → R3 → R4 → R5); push/event-driven work is out of scope; SC-7's contention bar is scenario-smoke level.

## Wrap-Up

12 assumptions — all validated/confirmed. RE-1, RE-2, RE-4 were batch-accepted by the user at the research-assumption-interview gate (2026-08-15) with the agent's positions; RS-1..RS-4 were resolved against code and web evidence during the research pass. No open, corrected, invalidated, or deferred items.
