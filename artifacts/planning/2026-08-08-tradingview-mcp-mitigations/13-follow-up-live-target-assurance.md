# Follow-Up Work Package — Live-Target Assurance (F-3 + F-4)

> **Status:** planned · not started
> **Trigger:** start after PR #1 (`chore/security-audit-mitigations`) merges to `main`
> **Source:** folded from [follow-ups.md](follow-ups.md) rows F-3 and F-4 (user decision 2026-08-08)
> **Base branch:** `main` (post-PR-#1)
> **Suggested branch:** `test/live-target-assurance`
> **Suggested planning slug:** `2026-08-XX-tradingview-mcp-live-target-assurance`

---

## Why This Exists (plain language)

The security work package (PR #1) proves its mitigations two ways: **unit tests** that feed hostile input into each guard and check the answer, and **one integration test** (`server-gating`) that proves the registrar actually refuses a blocked tool end-to-end. That is good coverage — but every other guard is proven only at the function boundary, with the real target swapped out for a test double (`_deps`).

Two gaps remain, and they are the two things that would actually hurt if they broke silently:

1. **Do the mitigations stop a real attack, against the real target?** Not "does the guard return the right answer for bad input" — does selector injection actually get refused inside a live TradingView page? Does `tv_update` actually refuse a malicious *real* git remote? Does the output fence actually survive inside a real MCP payload? Right now we have proven the guard logic, not the full attack path.

2. **Does the curated tool surface still match TradingView's internals?** The whole tool set is built on undocumented paths (`window.TradingViewApi.*`, probed via `KNOWN_PATHS`). A TradingView update can move one of those paths and break a tool — and nothing would notice until a user hits it. We need a probe that fails the moment that happens.

These two pair naturally: both are **live-target assurance**, both need a running TradingView session, and both are deliberately kept **out of CI** (a live authenticated GUI session cannot run headless in GitHub Actions). So they ship together as one opt-in, on-demand package.

---

## Scope

### Part A — Exploit-path E2E suite (`test:exploit`) · from F-3

Assert each mitigation blocks the **real** attack against a **live/real** target, not just guard logic via `_deps`.

**Current state:** coverage proves "guard function returns the right answer for hostile input." Only the registrar gate is proven at integration level (`server-gating`). The rest are unit-tested at the boundary only.

**One live-target case per finding area:**

| Finding area | The real attack to attempt (must be blocked) |
|---|---|
| Selector injection (`ui_find_element` css-strategy) | Inject a hostile CSS selector into a **live** TradingView page; assert it is refused, not executed |
| `ui_evaluate` removed | Attempt arbitrary JS evaluation **end-to-end through the MCP surface**; assert the tool is absent/refused |
| `tv_update` remote hardening | Point at a **malicious real git remote**; assert the signed-tag / pinned-SHA fast-forward refuses it |
| Output fencing | Drive a **real MCP payload** containing forged fence markers; assert the fence survives / the forgery is neutralised |
| Exact-path kill (`tv_launch`) | Run against a **live process tree**; assert kill is by exact path + PID, not a broad pattern match |

**Constraints:**
- Opt-in directory `tests/exploit/`, gated behind an env flag (e.g. `TV_RUN_EXPLOIT=1`) — **never in CI**, never in the default suite.
- Each case asserts the attack is **blocked** (the mitigation holds), not merely that the guard was called.

### Part B — API availability canary (`test:canary`) · from F-4

On-demand probe confirming the curated tool surface still matches TradingView's undocumented internals.

**Why on-demand, not CI:** TradingView needs a live authenticated GUI session; it cannot run headless in GitHub CI (user decision 2026-08-08). Run by hand, or before a release, against a live session.

**Two tiers:**
- **(a) Structural** — every `KNOWN_PATHS` entry resolves, and each expected method is present on the resolved object.
- **(b) Smoke** — each **read-only** tool returns its documented response shape.

**Constraints:**
- Reuses the existing `verifyAndReturn` / `tv_discover` probe mechanics.
- Opt-in env gate + reachable CDP at `127.0.0.1:9222`; **skips cleanly** when no session is available.
- **Read-only by construction** — the canary never writes, trades, or mutates chart state.
- A curated manifest (`tests/canary/expected.json`) maps `path → required methods` and `tool → required keys`. **It is updated in the same PR as any tool change**, so the canary can never drift from the surface it guards.

---

## Shared design decisions (already settled)

| Decision | Value | Rationale |
|---|---|---|
| Execution model | **On-demand / opt-in**, never CI | Live authenticated GUI session can't run headless (user decision 2026-08-08) |
| Env gating | Required for both suites | Keeps default `npm test` hermetic and CI-safe |
| CDP target | `127.0.0.1:9222` only | Matches the CDP-host guardrail added in PR #1 |
| Failure mode | Skip cleanly when no live session | A missing session is not a failing test |
| Manifest drift control | `expected.json` updated in the same PR as any tool change | Canary can never silently drift from the surface |

## Out of scope

- Headless/CI execution of either suite (explicitly rejected — needs a live GUI session).
- Live-CDP e2e of **every** gate beyond the finding areas listed above (already noted as out-of-scope in the parent package's `scope_boundaries`).
- MSIX hash-verification design (separate deferred item).

## Acceptance

1. `npm run test:exploit` (env-gated) runs one live-target case per finding area and each asserted attack is blocked.
2. `npm run test:canary` (env-gated) runs structural + smoke tiers and fails loudly when a `KNOWN_PATHS` path or read-only tool shape no longer matches `tests/canary/expected.json`.
3. Neither suite runs in CI or in the default `npm test`; both skip cleanly with no live session.
4. `tests/canary/expected.json` exists and is wired so any tool-surface change must update it in the same PR.

## How to start (when PR #1 has merged)

1. Confirm `chore/security-audit-mitigations` is merged to `main`; pull `main`.
2. Start a new `work-package` session with `user_request` pointing at this document, e.g.:
   *"Start a work package to implement the follow-up at `.engineering/artifacts/planning/2026-08-08-tradingview-mcp-mitigations/13-follow-up-live-target-assurance.md` — F-3 exploit-path E2E suite + F-4 API availability canary."*
3. Cut branch `test/live-target-assurance` off `main` (not the PR #1 branch).
4. Implement Part A and Part B as two tasks; keep both env-gated and out of CI.
5. On completion, mark F-3 and F-4 `done` in [follow-ups.md](follow-ups.md).
