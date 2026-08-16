# Strategic Review Method

> strategic-review method · Improve CDP Architecture of TradingView MCP Server · 2026-08-16 · findings: [strategic review](12-strategic-review-1.md)

## Scope Assessment

| File / Change | In Scope? | Notes |
|---------------|-----------|-------|
| src/.gitkeep | No | Scaffold keep-file; no R1–R5 role — [SR-1](12-strategic-review-1.md#sr-1--empty-srcgitkeep-from-the-scaffold-commit) |

All other files in the 23-file `main...HEAD` surface map to R1–R5 (registry, transport pool/`listTargets`, protocol module, wait adoption, health split) or to the lean-audit / bind-check follow-ups on that stack.

GitNexus `scope-discipline-check` used the indexed `tradingview-mcp` graph (stale at `fce6b721`, pre-implementation). Returned processes sit in health, capture, tab, and connection — all in R1/R5. No out-of-scope process was introduced on that graph.

## PR Body Conformance

Body conforms — no findings. Live body on #25 was re-rendered to the Final template during this activity (was Initial: missing Changes / AI Assistance / Fork Strategy; plan-tense TODO).

## Minimality Assessment

| Question | Answer | Notes |
|----------|--------|-------|
| Is every changed file necessary for the fix? | No | [SR-1](12-strategic-review-1.md#sr-1--empty-srcgitkeep-from-the-scaffold-commit) |
| Is every added line of code necessary? | No | [SR-2](12-strategic-review-1.md#sr-2--unused-acquirescopedclient-borrow-helper) |

All 5 other minimality checks pass: no new dependencies, no configuration edits, and the lean-audit pass already simplified the pool.

## Delivery Scope

| Class | Designators |
|-------|-------------|
| Carried to the pull request | SR-1, SR-2 |
| Handed to the audit | — |
| Held | — |

Selective-fixes at review-findings: both designators were already applied in 385c7b9; none left to choose.

Orphan scan: GitNexus index lacks the new symbols (`protocol.js`, `launch.js`, `update_check.js`, pool helpers). Local reference check: `captureScreenshot` / `dispatchMouse` / `dispatchKey` / `insertText`, `launch`, `checkForUpdate`, `listTargets`, `makeScopedClient`, `evictScopedClient`, and `drainScopedPool` all have callers. `acquireScopedClient` has none — [SR-2](12-strategic-review-1.md#sr-2--unused-acquirescopedclient-borrow-helper).

Commit signatures: `git log --format='%h %G?' main..HEAD` reports `G` on all 10 commits. `{unsigned_commits_in_pr}` is false.
