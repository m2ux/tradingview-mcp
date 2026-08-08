# Strategic Review

> strategic-review · tradingview-mcp security mitigations · main → chore/security-audit-mitigations · 2026-08-08 · Agent

**Diff:** 24 files, +1490 / −127

## Findings Summary

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Investigation Artifacts | 0 | — |
| Over-Engineering | 0 | — |
| Orphaned Infrastructure | 0 | — |
| Scope / Coverage Gaps | 2 | User decision at review-findings gate (fix now or defer) |
| **Total** | **2** | |

## Scope Assessment

All 24 changed files map to requirements in-scope items #1–#9 and the three DP decisions — the capability allowlist (DP-1), hardened `tv_update` (DP-2), the four gated power tools (DP-3), fencing (#4), launch/kill safety (#5), selector hardening (#6), CI pinning (#7), dependency pinning (#8), and the exfil/CDP opt-in gates (#9). No scope creep.

Two in-scope items landed short of the requirements text and are flagged for user decision:

| File / Change | In Scope? | Notes |
|---------------|-----------|-------|
| [src/core/ui.js](https://github.com/m2ux/tradingview-mcp/blob/9801051/src/core/ui.js) — `findElement` css guard | Partial | **SR-1.** Requirements #6 names `CSS.escape()`/`cssEscapeAttr()` for user-derived selector values *and* css-strategy validation; only the negative blacklist (reject markup/script-shaped queries) is implemented. Whitelist escaping of user-derived selector values is absent. Tracked as [follow-up F-1](follow-ups.md). |
| [package.json](https://github.com/m2ux/tradingview-mcp/blob/9801051/package.json) test scripts | Yes, incomplete | **SR-2.** `test` / `test:unit` / `test:all` / `test:cli` script lists do not include the four new suites (`capabilities`, `fencing`, `guards`, `server-gating`); they run only under bare `node --test tests/`. The 166/166 validation figure came from the bare invocation; `npm test` would silently skip the new guard suites. Tracked as [follow-up F-2](follow-ups.md). |

Pre-existing (outside the authored surface): main's own history is largely unsigned — unsigned commits are the repo norm; the 11 unsigned commits in this branch range match that norm. No action.

## Commit Signatures

All 11 commits in `main..HEAD` report `%G?` = `N` (no GPG signature). The orchestrator declined re-signing (`decline-resign`): unsigned history is the repo norm, and re-signing would rewrite the attested reviewed commit `081098c`. Recorded here per the decline-resign option.

## PR Body Conformance

Body refreshed to the Final template at `9801051` (Changes now past-tense; TODO-before-merging checked to "Ready for review"; issue-skipped placeholder; engineering + test-plan links resolve against the pushed `engineering` branch). Conforms — no findings.

## Minimality Assessment

All 5 minimality checks pass. Lockfile growth (+633 lines) is the mechanical `lockfile-lint` addition plus transitive re-resolution from exact pins — required by in-scope #8, not speculative. No debug code, no fallback logic for impossible cases, no unused configuration.

## Review Result

**Outcome:** Minor findings — user decision required

**Rationale:** The implementation is minimal and focused with zero investigation-artifact, over-engineering, or orphan findings. Two scope/coverage gaps (SR-1, SR-2) are each small and in-task, but both are genuine divergences from the requirements/test-plan text, so the outcome rests on explicit user choice rather than an agent-side accept.

**Next Step:** review-findings gate — accept as-is (defer F-1/F-2), fix now, or selective fix.
