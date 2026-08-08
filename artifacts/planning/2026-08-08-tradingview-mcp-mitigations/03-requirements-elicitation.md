# Requirements Elicitation: TradingView MCP Security Mitigations

> 2026-08-08 · Pending Confirmation

## Problem Statement

The tradingview-mcp server registers all 84 chart-control tools unconditionally — including `ui_evaluate` (arbitrary JavaScript inside an authenticated TradingView Desktop session) and `tv_update` (remote fetch + merge + `npm ci` self-install) — and returns chart-derived text to agents without untrusted-content fencing. A security audit found the default posture unsafe: indirect prompt injection via chart content could drive code execution and self-update with the user's full session privileges, and the CI/dependency supply chain is exposed. This work package closes those holes while keeping everyday usefulness intact.

## Goal

The server's default security posture is safe-by-default: dangerous capabilities are gated allowlist entries (off by default, registrar-enforced, human opt-in), untrusted chart content is fenced, the update/launch paths are hardened, and CI/dependencies are pinned — verified by the test suite, with no loss of the read-only chart-analysis surface.

## Stakeholders

### Primary Users

| User Type | Needs | User Story |
|-----------|-------|------------|
| Workstation owner (trader) | Safe defaults; dangerous powers off unless explicitly enabled | As a workstation owner, I want dangerous tools gated off by default so that an agent tricked by hostile chart text cannot run code, self-update, or wipe my chart without my explicit opt-in |
| Agent operator (advanced user) | A controlled, auditable way to enable power tools when needed | As an advanced user, I want a human-approved allowlist with an opt-in env/token gate so that I can deliberately enable a dangerous capability without exposing it by default |

### Secondary Stakeholders

- Downstream agent/skill authors — consume tool output; rely on untrusted-content fencing to avoid acting on injected instructions
- Repository maintainers — rely on pinned CI/dependencies for supply-chain integrity

## Context

### Integration Points

- `src/server.js` — MCP registrar wiring; the `server.tool` funnel where registration gating is cheapest
- `src/tools/_format.js` (`jsonResult`) — the single output funnel where untrusted-content fencing reaches all 84 tools
- `src/tools/ui.js:88` (`ui_evaluate`), `src/tools/health.js:30` (`tv_update`) — the two highest-risk tools
- `src/core/update.js` / `src/core/health.js` — update and launch/kill paths
- `src/core/pine.js` (`pine_check`), `src/connection.js` (CDP host), `.github/workflows/ci.yml`, `package.json`/`package-lock.json` — remaining finding areas

### Dependencies

- TradingView Desktop speaking CDP on localhost:9222 (runtime; not required for unit tests)
- npm lockfile (authoritative dependency record)
- GitHub Actions CI

### Constraints

- **Technical:** Changes must stay backward-compatible where feasible — mitigations default to opt-in env/token gates; the useful read/control surface stays always-on. Enforcement must live in the tool registrar (agent cannot bypass), not in an in-page JS sandbox (leaky).
- **Timeline:** None explicit; audit-driven priority — dangerous-tool gating first per the plan's rollout order.
- **Resources:** Single worktree on branch `chore/security-audit-mitigations`; GitHub Issues disabled — PR #1 is the coordination point.

## Scope

### In Scope

1. **Dangerous-tool gating via a capability-allowlist model** — replace the `ui_evaluate` wildcard with discrete, explicitly-declared, human-approved MCP tools (one operation each), allowlist-controlled, with an agent self-service extension path (skill: agent proposes a capability at point of need → human approval → implementation + PR onto the allowlist). Registrar-enforced. (DP-1)
2. **Hardened `tv_update`** — keep as an MCP tool, as a gated allowlist entry (off by default): `TV_UPDATE_TOKEN` + origin-URL allowlist + signed-tag/pinned-SHA-only fast-forward + fail-closed `npm ci`. (DP-2)
3. **Extended DANGEROUS_TOOLS membership** — gate ALL FOUR of `tv_launch`, `alert_delete`, `draw_clear`, `batch_run` as allowlist entries (off by default, registrar-enforced, human opt-in), alongside `tv_update`. (DP-3)
4. **Untrusted-content fencing** — `wrapUntrusted(content, origin)` helper in the single `jsonResult` funnel; wrap chart/Pine/UI-derived outputs; server instructions state fenced content is data, never instructions; least-privilege agent tool lists.
5. **Launch process safety** — `kill_existing` default false; exact-path process match (no broad `pkill -f`); document/hash-verify the MSIX local copy.
6. **UI selector hardening** — `CSS.escape()`/`cssEscapeAttr()` for user-derived selector values; validate/allowlist `ui_find_element` css strategy.
7. **CI/CD supply-chain hardening** — pin actions by SHA, pin Node versions and runner image, top-level `permissions: { contents: read }`, failing `npm audit`, dependency-review job.
8. **Dependency pinning & auditability** — lockfile authoritative, `npm ci` everywhere, local `security:audit` script/note.
9. **Data-exfil & config guardrails** — `TV_ALLOW_PINE_CHECK_UPLOAD` gate on `pine_check`; warn/refuse non-loopback CDP unless `TV_ALLOW_REMOTE_CDP=1`.

### Out of Scope

1. Windows MSIX local-copy hash-verification design — needs a Windows test environment (tracked as a follow-up in the comprehension artifact)
2. Runtime/live-CDP end-to-end validation of every gate — unit tests via `_deps` injection are the primary verification; live e2e is best-effort
3. Changes to the read-only chart-analysis surface beyond adding fencing — the read surface stays intact

## Success Criteria

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| SC-1 | `ui_evaluate` is absent from the agent-facing MCP surface; only discrete allowlist capabilities are registered | `chart_get_state`/tool list shows no `ui_evaluate`; unit test asserts registration skip |
| SC-2 | Every DANGEROUS_TOOLS member (`tv_update`, `tv_launch`, `alert_delete`, `draw_clear`, `batch_run`) is gated off by default and registered only on explicit opt-in | Unit tests per registrar asserting skip-without-gate and register-with-gate |
| SC-3 | `tv_update` refuses without `TV_UPDATE_TOKEN`, enforces the origin-URL allowlist, fast-forwards only to signed tags/pinned SHA, and fails closed on `npm ci` failure | `tests/update.test.js` cases via `_deps` injection |
| SC-4 | Chart/Pine/UI-derived tool outputs are wrapped in `UNTRUSTED_*_START/END` fences; server instructions declare fenced content is data | Unit test on `jsonResult`/`wrapUntrusted`; grep of server instructions |
| SC-5 | `tv_launch` defaults `kill_existing` to false and kills only by exact resolved path | Unit tests on launch/kill internals |
| SC-6 | CI pins actions/Node/runner, sets `permissions: { contents: read }`, and runs `npm audit` as a failing step | `ci.yml` inspection; a green CI run |
| SC-7 | `pine_check` upload is gated behind `TV_ALLOW_PINE_CHECK_UPLOAD`; non-loopback CDP warns/refuses without `TV_ALLOW_REMOTE_CDP` | Unit tests on pine/connection guards |
| SC-8 | The full `node --test` suite passes with the new guard tests | `npm test` green |

## Assumptions

Assumptions surfaced during elicitation: [assumptions log](02-assumptions-log.md) — recorded there (categories: Requirement Interpretation, Scope Boundaries, Implicit Requirements, Success Criteria Interpretation), not here.

## Elicitation Log

### Questions Asked

| Domain | Question | Response Summary |
|--------|----------|------------------|
| Scope / Problem | DP-1: How should `ui_evaluate` (arbitrary page JS) be handled? | Neither remove nor env-gate as framed — REPLACE the wildcard with a capability-allowlist model: discrete human-approved allowlist-controlled MCP tools, registrar-enforced, with an agent self-service proposal→approval→PR extension path |
| Scope | DP-2: How should `tv_update` be exposed? | Keep as an MCP tool, as a hardened gated allowlist entry — `TV_UPDATE_TOKEN` + origin-URL allowlist + signed-tag/pinned-SHA fast-forward + fail-closed `npm ci` |
| Scope | DP-3: Which tools join the gated allowlist? | Gate ALL FOUR — `tv_launch`, `alert_delete`, `draw_clear`, `batch_run` — off by default, registrar-enforced, human opt-in |

### Clarifications Made

- Stakeholder discussion was skipped by the user; requirements derive from the security audit, the mitigation plan, and the three DP decisions above.
- The capability-allowlist model (DP-1) informed DP-2 and DP-3: `tv_update` and the four gated tools all become allowlist entries under the same registrar-enforced model.

## Confirmation

**Confirmed by:** [User]
**Date:** YYYY-MM-DD
