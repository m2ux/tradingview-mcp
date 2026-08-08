# Knowledge Base Research — TradingView MCP Security Mitigations

> 2026-08-08-tradingview-mcp-mitigations · 2026-08-08 · Complete

## Research Approach

| Activity | Technique Used | Results Summary |
|----------|------------|-----------------|
| research-knowledge-base | concept-rag catalog/chunk search + WebSearch | KB holds no MCP/prompt-injection/CI-pinning-specific guidance (gap noted); web research supplied current, consistent best practices across all 9 finding areas |
| synthesize | findings-to-requirements mapping | Every requirement area maps to at least one validated pattern; no unresolved source contradictions |
| triage-research-candidates | reconcilability classification | No reconcilable research gaps — converged on first pass |

## Knowledge Base Findings

The concept-rag library was searched via `catalog_search` / `broad_chunks_search` for MCP tool security, prompt injection, software supply chain, and dependency pinning.

**Gap:** the library holds only generic software-security and Node.js references (e.g. *Software Quality Assurance* — Auerbach 2021, covering supply-chain security, zero-trust, access control at a conceptual level; *Node.js Web Development* — Packt 2016, covering version pinning and input validation generically). Nothing addresses MCP tool gating, LLM prompt-injection fencing, or GitHub Actions/npm supply-chain pinning specifically. Web research filled this gap; the KB contributed only the general principle of least privilege / defense-in-depth, which the web findings corroborate.

## Web Research Findings

### Search Queries Used

| Query | Sources Consulted | Key Findings |
|-------|-------------------|--------------|
| MCP server security best practices tool allowlist gating | Securie, systemshardening, gethasp (gateway pattern), mcp-zero-trust-proxy, alatirok | Deny-by-default per-identity tool allowlists enforced at server/registrar; strict JSON-schema validation; fail-closed errors; human approval for sensitive ops; audit logging |
| indirect prompt injection mitigation untrusted content delimiters | Microsoft MSRC (Spotlighting), arXiv 2403.14720, Zeph docs, LLMTrace | Spotlighting — delimiting / datamarking / encoding — plus a system-prompt instruction to treat fenced content as data, never instructions |
| GitHub Actions security hardening pin actions SHA permissions dependency review | systemshardening, secure-pipelines, GitHub changelog 2025-08-15, Eclipse/Trivy postmortem, Romain Lespinasse | Pin actions to full 40-char commit SHA; top-level restrictive `permissions`; dependency-review job; Dependabot/Renovate for pin upkeep; org policy can enforce SHA pinning |
| npm dependency pinning package-lock npm ci audit CI supply chain | safeguard.sh, pkgpulse, supabase npm-security, lockfile-lint, subresource-integrity | Commit lockfile; `npm ci` (never `npm install`) in CI; `npm audit --audit-level=high` failing; `lockfile-lint`; `npm audit signatures`; `--ignore-scripts` |
| secure software self-update git signed tags origin allowlist fail-closed | aiwg supply-chain-hardening, supabase npm-security, pnpm PR #12292 | Verify signed tags before build/update; origin allowlist; fail-closed on verification/install failure; trusted publishing (OIDC) over long-lived tokens |
| kill process by exact executable path avoid pkill -f substring | serverfault, Stack Overflow, procx, fkill | Enumerate processes (`ps`/`wmic`), match the resolved executable path exactly, kill by PID — never a broad `pkill -f` substring |

### External Documentation

| Source | URL | Key Insights | Relevance |
|--------|-----|--------------|-----------|
| Securie — MCP server security | https://securie.ai/guides/mcp-server-security | Structural defense: pin the tool catalogue, scope every tool to its safe surface, never trust LLM tool-args without a policy check; positive allowlists; fail-closed | HIGH |
| systemshardening — Securing MCP Servers | https://www.systemshardening.com/articles/ai-landscape/mcp-server-security/ | Per-client tool allowlists, default-deny; strict JSON Schema per tool; rate-limit; log every invocation; scan responses for injection | HIGH |
| gethasp — Self-hosted MCP gateway pattern | https://gethasp.com/guides/self-hosted-mcp-gateway-pattern/ | Allowlist is the trust boundary, not the prompt-injection scrubber; argument-level validation reduces blast radius of an allowed tool | HIGH |
| alatirok — MCP Security in 2026 | https://alatirok.com/mcp-security-2026/ | Pin tool definitions by hash; allowlist servers at a gateway; human approval for write/shell/send; layer controls per OWASP MCP Top 10 | HIGH |
| Microsoft MSRC — Spotlighting | https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks | Delimiting / datamarking / encoding to distinguish untrusted external text from instructions; update the system prompt to never obey fenced content | HIGH |
| arXiv 2403.14720 — Spotlighting | https://doi.org/10.48550/arxiv.2403.14720 | Spotlighting cuts XPIA attack success from >50% to <2%; datamarking is the minimum recommended, encoding the strongest for high-capacity models | HIGH |
| GitHub Changelog — SHA pinning policy | https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/ | Org/repo policy can enforce full-SHA pinning and block mutable refs across the whole action dependency tree | HIGH |
| systemshardening — GitHub Actions hardening | https://www.systemshardening.com/articles/cicd/github-actions-supply-chain-hardening/ | Pin to full SHA (tags are mutable); `permissions: {}` top-level then grant per-job; Dependabot keeps pins current | HIGH |
| safeguard.sh — npm lockfile security 2026 | https://safeguard.sh/resources/blog/best-practices-for-npm-lockfile-security-2026 | Commit lockfile; `npm ci` only in CI; `lockfile-lint` as a required check; `npm audit signatures`; `--ignore-scripts` | HIGH |
| pkgpulse — Secure npm supply chain 2026 | https://www.pkgpulse.com/guides/how-to-secure-npm-supply-chain-2026 | `npm audit --audit-level=high` breaking CI is the right baseline; low/moderate noise causes alert fatigue | MEDIUM |
| supabase — npm security | https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/security/npm-security.mdx | `npm ci`/`--frozen-lockfile`; verify provenance via `npm audit signatures`; review lockfile diffs like code | MEDIUM |
| serverfault — kill process by full path | https://serverfault.com/questions/912840/ | Enumerate processes, match the resolved exe path exactly, kill by PID; substring `pkill -f` risks killing innocents | MEDIUM |
| procx / fkill | https://github.com/AnuragVikramSingh/procx · https://www.npmjs.com/package/fkill | Cross-platform process enumerate/match/kill libraries; an alternative to hand-rolled ps/wmic parsing | LOW |

### Alignment with KB Research

The KB's general least-privilege / defense-in-depth principle is confirmed and made concrete by every external source. No contradictions.

## Applicable Design Patterns

| Pattern | Source | How It Applies | Confidence |
|---------|--------|----------------|------------|
| Deny-by-default tool allowlist, enforced at the registrar | Securie, systemshardening, gethasp, alatirok | DP-1/DP-3: gate `tv_update`, `tv_launch`, `alert_delete`, `draw_clear`, `batch_run` and replace `ui_evaluate`; enforce in `server.tool` (agent can't bypass), not in-page | HIGH |
| Positive (allowlist) not negative (denylist) scoping | Securie | The DANGEROUS_TOOLS gate is a name-set; new dangerous tools must be explicitly opted in, not relied on to be remembered | HIGH |
| Fail-closed enforcement | Securie, pnpm #12292, safeguard.sh | `tv_update` fails closed on `npm ci` failure; guards return error rather than silent fallback so injection can't succeed by retry | HIGH |
| Spotlighting / untrusted-content fencing | Microsoft MSRC, arXiv 2403.14720, Zeph, LLMTrace | `wrapUntrusted(content, origin)` in the single `jsonResult` funnel + server instruction to treat fenced content as data | HIGH |
| Immutable pinning (SHA, not tag) | GitHub changelog, systemshardening, Eclipse/Trivy | Pin CI actions to full commit SHA; tv_update fast-forwards only to signed tags/pinned SHA | HIGH |
| Lockfile-as-source-of-truth + frozen install | safeguard.sh, pkgpulse, supabase, subresource-integrity | `npm ci` everywhere; failing `npm audit`; `lockfile-lint`; remove caret ranges or document lockfile authority | HIGH |
| Human-in-the-loop for sensitive ops | alatirok, systemshardening | The DP-1 capability-allowlist's human-approval-before-add; `TV_UPDATE_TOKEN` one-time gate | MEDIUM |
| Audit logging of every invocation | systemshardening, gethasp, mcp-zero-trust-proxy | Log gated-tool invocation attempts (tool name, gate state, result) for observability | MEDIUM |
| Exact-path process termination | serverfault, procx/fkill | `tv_launch`/`killExisting` match the resolved exe path and kill by PID, not `pkill -f TradingView` | MEDIUM |

## Best Practices Found

### Registrar-enforced, deny-by-default tool gating
**Source:** Securie / systemshardening / gethasp MCP gateway pattern
**Description:** the policy check runs on every tool call at the model-tool boundary; default policy denies; an allowlist names what is permitted; enforcement is structural (gateway/registrar), not a prompt-level guardrail that injection can bypass.
**Application:** implement the DANGEROUS_TOOLS gate as a name-set check wrapped around `server.tool` in `src/server.js` (the single registration funnel the comprehension artifact identified), not per-registrar scattered checks, and not an in-page JS sandbox.

### Spotlighting for untrusted chart content
**Source:** Microsoft MSRC / arXiv 2403.14720
**Description:** transform untrusted text (delimit/datamark/encode) and update the system prompt to instruct the model the marked content is data, never instructions; cuts XPIA success from >50% to <2%.
**Application:** add `wrapUntrusted(content, origin)` to `src/tools/_format.js`, wrap chart/Pine/UI-derived outputs, and update the server instructions in `src/server.js` to state fenced content is data.

### SHA-pin CI actions and enforce via policy
**Source:** GitHub changelog 2025-08-15 / systemshardening / Eclipse-Trivy postmortem
**Description:** pin every action to a full 40-char SHA (tags are mutable and were the Trivy compromise vector); set a restrictive top-level `permissions` block; keep pins current with Dependabot/Renovate; optionally enforce at repo/org policy.
**Application:** rewrite `ci.yml` to SHA-pinned `actions/checkout`/`setup-node`, add `permissions: { contents: read }`, pin Node and the runner image, add a dependency-review job.

### Lockfile-authoritative dependency hygiene
**Source:** safeguard.sh / pkgpulse / supabase
**Description:** commit `package-lock.json`; use `npm ci` (never `npm install`) in CI; run `npm audit --audit-level=high` as a failing step; add `lockfile-lint` / `npm audit signatures`; treat lockfile diffs as code review.
**Application:** remove `continue-on-error` from the audit step, enforce `npm ci` in docs/scripts, add a local `security:audit` script, and decide caret-range policy (document lockfile authority vs exact pinning).

### Exact-path process kill
**Source:** serverfault / procx / fkill
**Description:** enumerate processes, match the fully-resolved executable path exactly, and kill by PID; a broad `pkill -f` substring can terminate unrelated processes.
**Application:** rework `killExisting` in `src/core/health.js` to match the resolved `tvPath` and kill by PID; default `kill_existing` to false.

## Risks and Anti-Patterns

| Risk/Anti-Pattern | Source | Mitigation |
|-------------------|--------|------------|
| Treating a prompt-injection scrubber as the trust boundary | gethasp, Securie | The allowlist/registrar is the boundary; fencing/scrubbing is a complementary layer only |
| Negative (denylist) scoping that misses new dangers | Securie | Positive allowlist; new tools require explicit opt-in |
| Mutable action tags / floating versions | GitHub changelog, Eclipse/Trivy | Full-SHA pinning + pinned Node/runner + Dependabot upkeep |
| `npm install` in CI re-resolving the tree | safeguard.sh, pkgpulse | `npm ci` only; failing audit; lockfile-lint |
| Broad `pkill -f` substring kill | serverfault | Exact-path match + kill by PID |
| `npm audit fix --force` unattended | safeguard.sh | Treat fixes as developer-driven, reviewed via PR |

## Recommended Approach

Based on the research findings:

1. **Primary Pattern:** A single registrar-enforced, deny-by-default capability allowlist — gate every dangerous tool as a name-set check around `server.tool`, off by default, human opt-in, fail-closed. This is the structural defense every authoritative source converges on, and it is exactly the DP-1 capability-allowlist model.
   - Rationale: prompt-level guardrails and in-page sandboxes are bypassable; the registrar is the one boundary the agent cannot cross, and the comprehension artifact confirms `server.tool` is the single cheap funnel.

2. **Key Practices to Apply:**
   - Spotlighting-style `wrapUntrusted` fencing in the `jsonResult` funnel + a treat-as-data server instruction (finding area: prompt injection).
   - Fail-closed `tv_update`: origin-URL allowlist, signed-tag/pinned-SHA-only fast-forward, `TV_UPDATE_TOKEN`, and a hard fail on `npm ci` error.
   - SHA-pin all CI actions, restrictive top-level `permissions`, pinned Node/runner, dependency-review job, Dependabot for pin upkeep.
   - Lockfile-authoritative deps: `npm ci` everywhere, failing `npm audit --audit-level=high`, `lockfile-lint`, local `security:audit` script.
   - Exact-path, by-PID process kill in `tv_launch`/`killExisting` with `kill_existing` default false.

3. **Risks to Monitor:**
   - Delimiter-only fencing is subvertible — prefer datamarking/encoding strength and keep it a complement to, never a substitute for, the allowlist boundary.
   - SHA pins create an upkeep obligation — automate with Dependabot/Renovate so pins don't go stale.

## Sources Referenced

| Document | Relevance | Key Sections |
|----------|-----------|--------------|
| Securie MCP server security | Tool gating, allowlist, fail-closed | Trust-enforcement, allowed-scope |
| systemshardening MCP security | Per-client allowlist, schema validation, audit | Tool allowlists, input validation |
| Microsoft MSRC Spotlighting | Prompt-injection fencing | Delimiting/datamarking/encoding |
| arXiv 2403.14720 | Spotlighting efficacy | Attack-success reduction figures |
| GitHub changelog SHA pinning | CI policy enforcement | Allowed-actions policy, SHA enforcement |
| systemshardening GH Actions hardening | CI pinning, permissions | Pinning, permissions model |
| safeguard.sh npm lockfile 2026 | Dependency hygiene | npm ci, lockfile-lint, audit signatures |
| serverfault exact-path kill | Launch safety | ps/lsof exact-path + PID kill |

**Status:** Complete
