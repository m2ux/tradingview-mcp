# Improve CDP Architecture of TradingView MCP Server — Complete

> Enhancement · branch `chore/24-improve-cdp-architecture` · PR [#25](https://github.com/m2ux/tradingview-mcp/pull/25) · 2026-08-16

## Summary

The CDP channel that carries all 88 TradingView MCP tools now has one registry, one transport-owned scoped-client pool (LRU-8), one protocol module, shared wait helpers, and a split health surface. Parallel tab work no longer opens competing private sockets. Implementation plan: [06-work-package-plan.md](06-work-package-plan.md). Durable decision: [ADR 0001](../../adr/0001-transport-owned-scoped-cdp-client-pool.md).

## Results

- Validation: unit 364/366 pass; 2 `guards.test.js` failures are env-dependent and pre-existing; lint 0 errors / 2 pre-existing warnings; `node --test` does not self-exit (dangling CDP handle after `guards.test.js`, pre-existing on main). No standalone validation artifact — figures live in the session bag and [test plan](06-test-plan.md#running-tests).
- Success criteria: 7 of 8 met ([requirements](03-requirements-elicitation.md#success-criteria)). Divergences:

  | Criterion | Target | Actual |
  |-----------|--------|--------|
  | SC-7 | No `TV_CDP_BUSY` on background-tab read + screenshot + tab-switch | Not run as a recorded live-Desktop smoke; pool + retry net landed |

- Files changed: [change-block index](10-change-block-index.md).
- Design decisions: [plan](06-work-package-plan.md#proposed-approach), [assumptions log](02-assumptions-log.md), [ADR 0001](../../adr/0001-transport-owned-scoped-cdp-client-pool.md). Implementation-only: evict-before-close; bind [`checkForUpdate`](https://github.com/m2ux/tradingview-mcp/blob/385c7b9/src/core/update_check.js#L15) after the health split; drop unused borrow helper and empty `src/.gitkeep`.

## Known Limitations

- **PR #25 remains draft** — GitHub REST cannot undraft; review was attested approved.
- **Pool state transitions are untested** — [TR-1](10-test-suite-review.md#tr-1--the-scoped-client-pool-state-transitions-are-untested).
- **SC-7 is unverified on live Desktop** — the parallel-tab smoke is not in CI.
- **LRU-8 is a sibling default, not a measured wedge threshold** — retry/`TV_CDP_BUSY` remains the safety net.
- **Flatten-session multiplexing stays deferred** — TradingView `sessionId` support is unknown.

## Workflow Retrospective

[messages: 18 checkpoint responses, 0 non-checkpoint user turns in the compact history · session quality: Minor friction]  
[trace: [14-session-trace.md](14-session-trace.md) — skip form; no `trace_tokens`]

### Observations

- [trace-retry] `batch_refused` ×3 and one `activity_redelivered` — complete's eager bundle exceeded a prior dispatch bound.
- [trace-redundancy] 203 `resource_fetched` and 200 `technique_bundled` across 15 activities — delivery storms on a full-workflow walk.
- Usage ledger has 15 activity rows and zero token figures — cost artifact omitted (no fabrication).
- [clarification] GitHub REST cannot undraft — [PR #25](https://github.com/m2ux/tradingview-mcp/pull/25) stayed draft after attested approval.
- Compact `inspect_session` omitted inherited bindings (`planning_folder_path`, `pr_number`, `is_review_mode`) that close-out steps consume.
- One `checkpoint_replayed` on the submit-for-review path.

### Recommendations

1. **High:** `record_usage` must carry harness figures, or close-out always skips the cost home.
2. **Medium:** GitHub CLI protocol needs an attested "leave draft" outcome when REST cannot undraft (`submit-for-review`).
3. **Medium:** `inspect_session` `variables` view should include inherited contract bindings, not only compact flags.

**Key takeaway:** The implementation path finished; close-out is limited by an empty usage ledger, a draft PR GitHub REST cannot promote, and a session inspect view that hides the bindings the last activity needs.
**Action required:** no

