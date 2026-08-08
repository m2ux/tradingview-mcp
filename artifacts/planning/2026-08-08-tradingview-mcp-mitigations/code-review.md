# Code Review

## Manual Diff Review

Index: [10-change-block-index.md](10-change-block-index.md) — 27 blocks over `main...chore/security-audit-mitigations` at `081098c`. Reviewer attestation: **rationale confirmed — no issues** (file-index-table gate, 2026-08-08). Flagged blocks: none.

## Structural Analysis

Target: authored surface of `chore/security-audit-mitigations` @ `081098c` (21 files) · 2026-08-08 · lens: L12 structural. Written into this consolidated review per the step's `findings_destination` binding.

### Claim

The deepest structural property of this change is that it converts an *enumerated* trust model into a *funnel* trust model: instead of trusting each of 84 tools to be safe, the system trusts two choke points — `wrapRegistrar` (every registration, verified: all 83 `server.tool(` call sites in `src/tools/` route through the wrapped server) and `jsonResult` (every tool response; no tool file constructs a raw `content:` payload). The falsifiable claim: **no tool can reach the agent without passing both funnels.** It survives: registration is total because the wrap happens at the composition root before all 14 registrars; output is total because `jsonResult` is the only response constructor the tool layer uses.

### Dialectic

Construct the alternatives the audit implied and observe what each reveals. (a) *Per-tool guards* — 83 edit sites; reveals why the old system failed: any model whose safety scales with tool count loses to entropy the day tool #85 lands. (b) *Prompt-level instructions only* — reveals that a prompt is a filter the chart's own content can talk through (indirect injection), which is why the fence is datamarked *and* the hard boundary is in code the agent cannot reach. (c) *Denylist of known-dangerous tools* — reveals the asymmetry the allowlist inverts: a denylist must be right about every future tool, an allowlist must only be right once per admitted tool. What survives every construction: safety here is a property of *where checks sit*, not of *what each tool does*.

### Concealment Mechanism

The pre-change code hid its insecurity behind *local reasonableness*: every individual tool had sane code (safe selector interpolation, loopback CDP default, merge-mechanic guards), so file-by-file review kept concluding "fine". The danger lived nowhere in any file — it lived in the *flatness* of the registration graph (84 unconditional `server.tool` calls) and the *transparency* of the output pipe. Structural insecurity is invisible to per-file reading; the mitigations are correspondingly structural (one wrap, one fence) rather than per-tool patches.

### Improvements

The change's own constructions: registrar wrap (total registration gate), funnel fence (total output marking), fail-closed update (skew window deleted, not narrowed), exact-path kill (ambiguity resolved by construction). Constructed next step that the lens exposes: the CLI launch path (`src/cli/commands/health.js:18`) still implements the *old* default — a second composition root the funnel model has not absorbed (code-review M1).

### Structural Invariant

**Gate-before-effect**: every new guard evaluates before its protected side effect and fails closed. Verified per site: token gate precedes all git (`update.js:59`, test asserts `state.cmds.length === 0`); origin allowlist precedes fetch (`update.js:95-102`, test asserts no fetch cmd); provenance precedes merge (`update.js:115-122`, two tests assert no merge cmd); upload gate precedes network (`pine.js:192`, test asserts `fetched === false`); loopback assert precedes connection (`connection.js:69`, first statement of `getClient`); kill default requires explicit `=== true` (`health.js:290`). No guard in the authored surface performs a partial effect then decides.

### Conservation Law

**Funnel-conservation**: every tool surface change is conserved through both funnels — a tool that registers (producer: `server.tool`) necessarily passes the gate, and a response that returns (producer: tool handler) necessarily passes the fence. Producer/clearer ledger, resource = *agent-reachable capability*:

| Resource | Producers | Clearers (lifecycle end) | Verdict per termination path |
|----------|-----------|--------------------------|------------------------------|
| Tool registration | 83 `server.tool(` sites via wrapped registrar | Process exit (surface is process-scoped) | Matched — registration is atomic in the wrap; no partial-registration path |
| Fenced output | Every `jsonResult` call | Consumer reads payload | Matched — fence applied inside the constructor, before serialization |
| Spawned TradingView process | `_spawnDetached` (2 sites: primary, MSIX fallback) | `killExisting` when `kill_existing === true`; else user/OS | Matched on opt-in paths; **no-kill paths intentionally leave the process — documented behavior, not a leak** |
| `npm ci` dependency sync | `update()` post-merge | Hard error return on failure | Matched — skew path now returns failure instead of warning |
| Cached CDP client (`client` module state) | `connect()` in `getClient` | liveness-check null-out; `disconnect()` | Matched — and each reuse re-passes `assertLoopbackHost` (Block 8) |
| CLI-launched process | `tv launch` via `core.launch` | `kill_existing: !opts['no-kill']` | **Unmatched by the new invariant** — CLI preserves old kill-by-default (M1) |

### Meta-Law

The funnel model conceals its own dependency on *funnel totality*: the law holds only as long as no second registration or output path appears. Concrete, testable prediction: the moment a future contributor constructs an MCP response outside `jsonResult`, or registers a tool on a server instance that skipped `wrapRegistrar` (the CLI's direct `core.launch` call is the existing seam of this kind), the change's guarantees silently degrade to the pre-change model — and no test fails, because the tests assert the funnels, not the absence of bypasses. The mitigation for *that* is the convention layer (review + the composed-server test pattern of tests/server-gating.test.js, which would catch a second root if extended to it).

### Bug Table

| # | Finding | Location | Severity | Fixable/Structural |
|---|---------|----------|----------|--------------------|
| S1 | CLI launch default-kill bypasses new opt-in semantics (ledger row 6) | `src/cli/commands/health.js:18` | Medium | Fixable — flip flag polarity |
| S2 | POSIX kill matches any install sharing the binary basename (snap vs /opt) | `src/core/health.js:371-383` | Low | Structural — accepted residual; full-path match needs /proc enumeration, plan chose basename |
| S3 | Instructions/surface count drift ("84 tools" vs 78/83) | `src/server.js:26` | Low | Fixable — doc line |
| S4 | Funnel totality is convention-protected, not mechanism-protected, for future code | repo-wide | Informational | Structural — inherent to the funnel model; see Meta-Law |

No unmatched producer creates unbounded state growth; no liveness halt introduced (all guards fail closed with messages); no migration concern (additive, env-gated).

## Code Review

Reviewed: branch `chore/security-audit-mitigations`, commits `1b14cfc..081098c` (9 commits, authored surface 21 files + mechanical lockfile; +1408/−121). Lens: architecture, error handling, safety, and testing on the JS/Node surface (project_type: other — Rust/Substrate criteria not applicable). Blast radius bounded by the two funnels: `wrapRegistrar` intercepts every `server.tool` call; `jsonResult` formats every tool response.

### Summary

**Overall Quality:** 4/5 — Critical: 0 · High: 0 · Medium: 2 · Low: 2 (all Medium/Low items are pre-existing or documentation-level; no correctness defects in the authored surface).

### Findings

#### Medium

- **M1 — CLI `launch` default still kills (default-flip leak outside the MCP path).** `src/cli/commands/health.js:18` maps `kill_existing: !opts['no-kill']`, i.e. the bare `tv launch` CLI kills existing instances by default, contradicting the new safe-by-default semantics the MCP schema (`.default(false)`) and core (`kill_existing === true`) now enforce. The README's Security Model section does not mention the CLI path. *Recommendation:* flip the CLI to opt-in (e.g. `--kill`) or make no-flag the no-kill path. *(In-task follow-up — one-line change + doc line.)*
- **M2 — Plan Task 7 deliverable `.github/dependabot.yml` not produced.** The SHA-pin upkeep mitigation the plan names for the new immutable action references is absent (`ls .github/` → `workflows` only); the CI diff touches only `ci.yml`. *Recommendation:* add the dependabot config for `github-actions` ecosystem updates, or record a conscious deferral in deferred-items. *(In-task follow-up.)*

#### Low

- **L1 — MCP `instructions` still open "84 tools"** (`src/server.js:26`) while the README now correctly states 83-by-default/78-always-on (verified by composed-server count: 78 closed / 83 open). The instructions block also lists gated tools (`batch_run`, `alert_delete`, `tv_launch`) without noting they may be absent. Cosmetic drift between the two authoritative surface descriptions.
- **L2 — `security:audit` reports 2 moderate vulnerabilities** in the transitive `@hono/node-server` (path traversal on Windows, GHSA-frvp-7c67-39w9) via `@modelcontextprotocol/sdk` 1.25.0–1.29.0; script exits 0 because the gate is `--audit-level=high` (by design). Fix requires `npm audit fix --force` to sdk 1.30.0, outside the pinned range. Recorded for visibility; no action required by SC-8.

### Non-findings considered and rejected

- `fenceString` marker neutralization uses U+2017 in place of `_` — a forged fence can never survive because the genuine wrapper is applied *after* neutralization (tests/fencing.test.js proves only 2 markers remain); TRUSTED_KEYS unfenced scalars are server-authored, not chart-derived.
- `verifyTarget` prefix-match on `TV_UPDATE_PINNED_SHA` — short pins are operator-chosen; `rev-parse FETCH_HEAD` full-sha `startsWith` is the documented git-pin pattern.
- `killExisting` POSIX argv[0]-basename match can kill a *different* install of the same binary name (e.g. snap vs /opt) — accepted residual vs the old `pkill -f` substring kill; plan's risk table explicitly chose exact-path-by-basename over no-kill-on-ambiguity.
- New `codeql` job's `security-events: write` — least-privilege exception is per-job, required by the upload SARIF API, top-level stays `contents: read`.
- 4 lint warnings (data.js, pane.js, watchlist.js) — pre-existing on `main`, none in the authored surface.

### Strengths

- Enforcement at the two funnels (registrar + `jsonResult`) is total: one-line wiring covers present *and future* tools; composed-server integration tests prove it.
- Every new guard refuses *before* side effects (token gate before any git, origin allowlist before fetch, upload gate before network) and is DI-testable — the test fakes assert `state.cmds`/`fetched` to prove it.
- Fail-closed `npm ci` eliminates the code/deps skew window and says so in the error with recovery instructions.

### Re-review (fix cycle 1, commit `9801051`)

Re-scanned the fix delta (6 files, +82/−6, 7 hunks) after applying M1/M2/L1 and test improvements 2.1/2.2. Findings verified closed: CLI `launch` now defaults to no-kill with opt-in `--kill`; `dependabot.yml` covers github-actions + npm; instructions count is 83/78 with gated tools marked; win32 kill branch and CLI polarity now have runnable tests (166/166 suite green, security:audit exit 0). No new findings — the delta is flag polarity, docs, and test-only additions; gate-before-effect invariant untouched.

## Compliance

Architecture, error handling, safety, and testing categories met for the JS surface; documentation category diverges on L1 (instructions/README drift). Rust Idioms and Substrate Framework categories not applicable (project_type: other).

## Lean-Coding Audit

Reviewed: branch `chore/security-audit-mitigations`, commits `2cfe98c..c783f3b` (8 task commits, +1422/−118). Lens: over-engineering taxonomy only; correctness/security/performance sit on the safety floor and are out of scope.

### Findings

- `shrink` — `src/core/update.js` header docstring (10 lines) — the gate/provenance detail duplicates what the `TV_UPDATE_TOKEN` guard, `ALLOWED_ORIGINS` block, and `verifyTarget` each say in one line at the point of enforcement; keep the two-line summary + "every guard returns before the merge", drop the middle paragraph — saves ~6 lines.
- `shrink` — `src/tools/_format.js` header block (7 lines) restates the fence mechanics that `wrapUntrusted`'s own doc comment already carries — keep one why-line (output is untrusted input; fencing is the spotlighting layer, the registrar is the boundary), drop the rest — saves ~5 lines.
- `shrink` — `tests/update.test.js` `gitDeps` doc comment grew to a 2-line `@param` enumeration of 11 options — restates the destructured defaults directly below it — delete the enumeration, keep the one-line intent — saves ~1 line.

Non-findings considered and rejected: `assertLoopbackHost` default args (`host = CDP_HOST, env = process.env`) match the module's existing DI style; `GATED_TOOLS` 5-entry Set is the minimal deny-by-default list the requirements name; new test files are the safety-floor runnable checks for non-trivial guard logic, one describe per behavior, no framework beyond `node:test`; `platform` dep in `_resolveLaunchDeps` is test seam, not abstraction.

### Scoreboard

net: -12 lines

### Re-review (after apply-simplifications, commit `081098c`)

Re-scanned the applied change against the taxonomy. The three shrinks landed; the surviving comments are proportional one-to-two-line why-notes (trust-boundary / fail-closed rationale) with no bulk outweighing their code. No residual `delete`/`shrink`/`stdlib`/`native`/`yagni` tags apply.

net: -12 lines (applied). Lean already. Ship.
