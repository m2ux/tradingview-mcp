# Design Philosophy

> design-philosophy · TradingView MCP Security Mitigations · (no issue — repo issues disabled) · 2026-08-08

## Problem Statement

The tradingview-mcp server registers all 84 chart-control tools unconditionally — including `ui_evaluate` (arbitrary JavaScript inside an authenticated TradingView Desktop session) and `tv_update` (remote fetch + merge + `npm ci` self-install) — with no opt-in gate, and returns chart-derived text (Pine labels/tables, console output, strategy results) to agents without untrusted-content fencing. Launch/update paths, UI selector construction, CI workflows, and dependency declarations carry further audit findings (default-kill `tv_launch`, unescaped selectors, mutable action tags, floating Node versions, non-failing `npm audit`, undisclosed `pine_check` source upload). Left unaddressed, indirect prompt injection via chart content can drive code execution and self-update with the user's full session privileges, and the supply chain remains exposed.

### System Context

Node MCP server (`src/server.js` tool registrars; `src/tools/*`; `src/core/*`) speaking CDP to TradingView Desktop on localhost:9222; agents and skills consume tool output directly; supply chain via npm and GitHub Actions. Structure confirmed by the GitNexus index (1,128 nodes / 2,207 edges) built at work-package start; affected modules are central hubs.

### Impact Assessment

| Aspect | Description |
|--------|-------------|
| Severity | Critical/High |
| Scope | Every user of the server; the authenticated TradingView session and workstation |
| Business Impact | Workstation/account compromise via prompt injection; supply-chain exposure through unpinned CI/dependencies |

## Problem Classification

**Type:** Inventive Goal

**Subtype:**
- [ ] Cause Known (direct fix)
- [ ] Cause Unknown (investigate first)
- [ ] Improvement goal
- [x] Prevention goal

**Complexity:** Complex

**Rationale:** Nothing is malfunctioning — the audit found the default security posture itself unsafe, so the work is prevention-oriented rather than fix-or-restore. Complex because the plan spans 9 finding areas across server/tools/core/CI/docs; its open trade-offs are now all decided (elicitation, 2026-08-08). The `ui_evaluate` disposition: rather than remove-or-env-gate, the `ui_evaluate` wildcard is REPLACED by a capability-allowlist model — discrete, explicitly-declared, human-approved MCP tools (one operation each) for what was previously carte-blanche page JS, with an agent self-service extension path (agent proposes a capability at point of need → human approval → implementation + PR onto the allowlist). Enforcement lives in the tool registrar, which the agent cannot bypass, not in a leaky in-page JS sandbox. The `tv_update` disposition: it remains an MCP tool as a hardened allowlist capability — gated off by default behind `TV_UPDATE_TOKEN`, an origin-URL allowlist, signed-tag/pinned-SHA-only fast-forward, and fail-closed `npm ci`. The `DANGEROUS_TOOLS` extended membership: gate ALL FOUR of `tv_launch`, `alert_delete`, `draw_clear`, `batch_run` as allowlist entries (off by default, registrar-enforced, human opt-in), alongside `tv_update` and replacing `ui_evaluate`. GitNexus signal corroborates: the affected modules are central hubs in a 1,128-node graph.

## Workflow Path Decision

**Selected Path:** Full workflow — confirmed by user at the classification-and-path checkpoint.

**Activities Included:**
- [x] Requirements Elicitation
- [x] Research
- [x] Implementation Analysis
- [x] Plan & Prepare

**Rationale:** The mitigation plan fixes *what* to do per finding but leaves requirement-level decisions open (removal vs gating, tool surface vs CLI-only, gate membership), so elicitation is needed; CI/supply-chain pinning and prompt-injection fencing benefit from current-best-practice research; comprehension remains mandatory on every path.

## Constraints

| Constraint Type | Description |
|-----------------|-------------|
| Time | None explicit; audit-driven priority — dangerous-tool gating first per rollout order |
| Technical | Changes must stay backward-compatible where feasible (env-gated opt-ins); preserve the useful read/control surface |
| Dependencies | GitHub Issues disabled on the repo — no tracker linkage; PR #1 is the coordination point |
| Resources | Single worktree `.worktrees/2026-08-08-tradingview-mcp-mitigations` on branch `chore/security-audit-mitigations` |

## Success Criteria

Success criteria: [requirements](03-requirements-elicitation.md#success-criteria) once elicited.
