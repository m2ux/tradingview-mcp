# Implementation Analysis — tradingview-mcp Security-Audit Mitigations

> tradingview-mcp security-audit mitigations · 2026-08-08 · Complete

This analysis covers the current state of the nine security-mitigation areas. The repository ships a working, well-tested MCP server but has **no security posture applied yet**: every one of the 84 tools registers unconditionally, no tool output is fenced, the self-update performs an unauthenticated fast-forward, the launch path uses broad `pkill -f` with a documented-but-unenforced `kill_existing` default, CI uses unpinned `@v4` action tags and a continue-on-error audit, and dependencies use caret ranges. Each area below records the located implementation, evidence, baselines, and the gap against the corresponding success criterion.

## Implementation Review

### Existing Location

| Mitigation area | Path | What it does today |
|-----------------|------|--------------------|
| Tool registration / gating surface | `src/server.js:72-86` | 14 registrars called unconditionally at startup; no allowlist, no `DANGEROUS_TOOLS` set, no `TV_ALLOW_DANGEROUS` env check |
| Output funnel (fencing point) | `src/tools/_format.js:5-9` | `jsonResult(obj)` → `JSON.stringify(obj, null, 2)`; no wrap/fence of untrusted content |
| ui_evaluate (DP-1) | `src/tools/ui.js:88-93`; core `src/core/ui.js` | `ui_evaluate` executes arbitrary JS via `Runtime.evaluate` in the page context |
| ui.js selector building | `src/core/ui.js:6-11` | `JSON.stringify(value)` interpolation into page-side evaluate (already-safe pattern) |
| tv_update (DP-2) | `src/core/update.js:23-104`; tool `src/tools/health.js:30-33` | unauthenticated fast-forward of `origin/main` + warn-not-fail `npm ci` |
| pine_check upload | `src/core/pine.js:186-199` | POSTs Pine source to `https://pine-facade.tradingview.com/...translate_light` |
| Process kill / launch (DP-3) | `src/core/health.js:352-360`; MSIX fallback `:367-380`; tool `src/tools/health.js:22-28` | `taskkill /F /IM TradingView.exe` (win) / `pkill -f TradingView` (else); `kill_existing` zod-optional, description says "default true" |
| CI supply chain | `.github/workflows/ci.yml` | `actions/checkout@v4`, `actions/setup-node@v4` (mutable tags); audit `continue-on-error: true`; no `permissions:` block |
| Dependencies | `package.json:26-32` | caret ranges `^1.12.1`, `^0.33.2`, `^9.39.4`; `npm ci` present in CI |
| Agent tool surface | `agents/performance-analyst.md:5-6` | frontmatter `tools: - "*"` (full surface incl. power tools) |

### Usage Patterns

**How the surface is used today:**
- All 84 tools across 14 registrar groups register at server startup with no conditional path; the registrar call graph is flat — each `register*Tools(server)` calls `server.tool(name, desc, schema, handler)` directly.
- Every tool handler funnels its return through `jsonResult` (`_format.js`), making it the single choke point for any output transformation.
- `jsonResult` has 14 incoming callers (all registrars) per GitNexus; `update`, `killExisting`, and `check` are reachable only through their `tv_update` / `tv_launch` / `pine_check` tool registrations.

**Call frequency:** once per server process at startup (registration); per-tool-call thereafter (handlers + `jsonResult`).

### Dependencies

**Depends On:**
- `@modelcontextprotocol/sdk` (^1.12.1) — `server.tool` registration API
- `chrome-remote-interface` (^0.33.2) — CDP `Runtime.evaluate` used by `ui_evaluate`, `ui.js`, pine/drawing tools
- Node `child_process` — `execSync` in `update.js` (git/npm) and `health.js` (kill)

**Depended On By:**
- `src/server.js` — imports all 14 registrars; the entry point that would host the registrar-level gate
- `agents/performance-analyst.md` — consumes the full tool surface via `tools: - "*"`

### Architecture

**Existing patterns:** thin tool layer (`src/tools/*`) delegating to a core layer (`src/core/*`); a shared `jsonResult` formatter; a single `server.js` wiring all registrars. The flat, unconditional registration is the pattern a deny-by-default registrar allowlist slots into without restructuring — the gate is a name-set check at `server.tool` time.

**Known technical debt:** `kill_existing` default is a doc-vs-schema mismatch (description claims "default true", schema has no `.default()`); `npm ci` failure in `update()` is a non-fatal warning that can leave code and dependencies out of sync.

## Effectiveness Evaluation

### What's Working Well

| Capability | Evidence | Confidence |
|------------|----------|------------|
| update() guard rails (non-git, non-main, dirty, ahead checks) | `src/core/update.js:28-74` — each returns before any merge | HIGH |
| Safe selector escaping in ui.js | `src/core/ui.js:7-11` — `JSON.stringify(value)` interpolation, no string concat | HIGH |
| Loopback-only CDP default | `src/connection.js:8` — `CDP_HOST` defaults to `127.0.0.1`, not `0.0.0.0` | HIGH |
| Unit-test coverage incl. update.test.js, launch.test.js, sanitization.test.js | `package.json:20` (`test:unit` list) | HIGH |

### What's Not Working

| Issue | Evidence | Impact |
|-------|----------|--------|
| No tool gating — all 84 tools register unconditionally | `src/server.js:73-86`; `rg "DANGEROUS_TOOLS\|TV_ALLOW_DANGEROUS\|wrapUntrusted\|TV_UPDATE_TOKEN" src/` → 0 matches | HIGH |
| ui_evaluate = wildcard arbitrary JS in page context | `src/tools/ui.js:88-93`; `Runtime.evaluate` via core | HIGH |
| Unauthenticated self-update (no token/origin allowlist/signed-tag check) | `src/core/update.js:59,79` — `git fetch origin main` then `merge --ff-only` | HIGH |
| Broad substring process kill | `src/core/health.js:354-355` — `pkill -f TradingView` matches any cmdline containing the substring | HIGH |
| kill_existing default not enforced by schema | `src/tools/health.js:24` — `z.coerce.boolean().optional()`, no `.default()`; description text claims "default true" | MEDIUM |
| Unfenced tool output (prompt-injection surface) | `src/tools/_format.js:5-9` — raw `JSON.stringify` of chart/Pine/quote content returned to the model | HIGH |
| Unpinned CI actions + non-blocking audit | `.github/workflows/ci.yml:16,19,35-36` — `@v4` tags, `continue-on-error: true`, no `permissions:` | HIGH |
| Caret dependency ranges | `package.json:26-32` — `^1.12.1`, `^0.33.2`, `^9.39.4` | MEDIUM |
| Agents granted full surface incl. power tools | `agents/performance-analyst.md:6` — `tools: - "*"` | MEDIUM |
| npm ci failure leaves code/deps skew | `src/core/update.js:84-90` — `depsWarning` only, no fail-closed | MEDIUM |

### Workarounds in Place

- `update()` refuses on non-git installs, non-main branch, dirty tree, and diverged history (`src/core/update.js:28-74`) — a genuine safety net for *merge mechanics*, but it does not authenticate *what* is fetched.

## Baseline Metrics

Baselines for a prevention-oriented change are **counts of unsafe defaults and exposures**, driven to zero and verified by the unit test suite (IA-4). Measured 2026-08-08 on branch `chore/security-audit-mitigations`.

| Metric | Current Value | Measurement Method | Date Measured |
|--------|--------------|--------------------|---------------|
| Tools registered | 84 | `rg -o "server\.tool\(" src/ \| wc -l` | 2026-08-08 |
| Registrar groups | 14 | `rg -o "register[A-Za-z]+Tools\(server\)" src/server.js \| wc -l` | 2026-08-08 |
| Ungated tool registrations | 84 / 84 | no conditional in `src/server.js:73-86` or any registrar | 2026-08-08 |
| Gating/allowlist/fencing guard points present | 0 | `rg "DANGEROUS_TOOLS\|TV_ALLOW_DANGEROUS\|wrapUntrusted\|TV_UPDATE_TOKEN\|TV_ALLOW_PINE_CHECK_UPLOAD\|TV_ALLOW_REMOTE_CDP" src/` → 0 | 2026-08-08 |
| ui_evaluate exposed | 1 (ungated) | `src/tools/ui.js:88` | 2026-08-08 |
| Fenced tool outputs | 0 | `_format.js` has no wrap/fence | 2026-08-08 |
| tv_update auth guard points | 0 | `update.js` — no token/origin-allowlist/signed-tag check | 2026-08-08 |
| Exact-path process kill | no | `health.js:355` — `pkill -f TradingView` | 2026-08-08 |
| kill_existing schema-enforced default | none (description-only "default true") | `health.js:24` — no `.default()` | 2026-08-08 |
| Unpinned CI action refs | 2 (`@v4`) | `.github/workflows/ci.yml:16,19` | 2026-08-08 |
| CI `permissions:` blocks | 0 | `.github/workflows/ci.yml` — none present | 2026-08-08 |
| Audit non-blocking | yes (`continue-on-error: true`) | `.github/workflows/ci.yml:36` | 2026-08-08 |
| Exact (non-caret) dependency pins | 0 of 3 | `package.json:26-32` — all `^` ranges | 2026-08-08 |
| Agents scoped to read-only tools | 0 | `performance-analyst.md:6` — `tools: - "*"` | 2026-08-08 |

### Key Findings

- The security posture is **entirely absent, not partially applied** — every guard-point count is 0, so each mitigation is a clean additive change with no existing behavior to preserve (IA-1).
- Two single-choke-point levers cover most of the surface: the registrar (one gate check protects all 84 tools) and `jsonResult` (one wrap fences all tool output).
- The only genuine existing safeguards are `update()`'s merge-mechanic guards, ui.js selector escaping, and the loopback CDP default — none of which authenticate content or provenance.

## Gap Analysis

| ID | Gap | Current State | Desired State | Impact | Priority |
|----|-----|---------------|---------------|--------|----------|
| G1 | No deny-by-default tool gating | 84/84 tools register unconditionally | Power tools gated allowlist entries (off by default, registrar-enforced, human opt-in); read tools always-on | Prevents unvetted tool exposure | HIGH (SC-1) |
| G2 | ui_evaluate wildcard | Arbitrary page-context JS exposed | Replaced by capability-allowlist model (DP-1): discrete human-approved tools, registrar-enforced | Removes the largest injection/RCE surface | HIGH (SC-2) |
| G3 | Unauthenticated self-update | Fast-forward of unverified `origin/main` | `TV_UPDATE_TOKEN` + origin-URL allowlist + signed-tag/pinned-SHA-only ff + fail-closed `npm ci` (DP-2) | Blocks supply-chain self-compromise | HIGH (SC-3) |
| G4 | Unfenced tool output | Raw chart/Pine/quote JSON to model | Spotlighting fence in `jsonResult` (complementary layer; registrar is the trust boundary) | Reduces indirect prompt injection | HIGH (SC-4) |
| G5 | Broad process kill + doc-only default | `pkill -f TradingView`; default not in schema | Exact-path (exe-path+PID) kill; `kill_existing` default flipped in schema+description | Prevents killing unrelated processes | MEDIUM (SC-5) |
| G6 | Ungated pine_check upload | Source POSTed to TradingView facade unconditionally | Gated behind explicit opt-in (`TV_ALLOW_PINE_CHECK_UPLOAD`) | Stops silent source exfiltration | MEDIUM (SC-6) |
| G7 | Unpinned CI actions + non-blocking audit + no permissions | `@v4` tags, `continue-on-error: true`, no `permissions:` | SHA-pinned actions, least-privilege `permissions:`, failing audit gate, dependency review | Hardens supply chain in CI | HIGH (SC-7) |
| G8 | Caret dependency ranges | `^1.12.1`, `^0.33.2`, `^9.39.4` | Exact pins + lockfile as authority (`npm ci`, lockfile-lint) | Reproducible, tamper-evident deps | MEDIUM (SC-8) |
| G9 | Agents get full surface incl. power tools | `tools: - "*"` | Read-only tool subset per agent; power tools excluded | Least-privilege agent surface | MEDIUM (SC-1) |

## Opportunities for Improvement

### Quick Wins (Low Effort, High Impact)

1. **Registrar gate (`DANGEROUS_TOOLS` + `TV_ALLOW_DANGEROUS`)**: add a name-set check where `server.tool` is invoked — protects all 84 tools with one change. Expected impact: SC-1; Effort: low.
2. **SHA-pin CI actions + drop `continue-on-error`**: two-line diff in `ci.yml`. Expected impact: SC-7; Effort: low.
3. **kill_existing schema default**: add `.default(false)` and align the description. Expected impact: SC-5; Effort: trivial.

### Structural Improvements (Higher Effort)

1. **Capability-allowlist replacement for ui_evaluate (DP-1)**: remove the wildcard and expose discrete human-approved tools with a self-service extension path. Expected impact: SC-2; Effort: high (new allowlist machinery + registrar enforcement).
2. **Hardened tv_update (DP-2)**: token + origin allowlist + signed-tag/pinned-SHA fast-forward + fail-closed `npm ci`. Expected impact: SC-3; Effort: medium.
3. **Spotlighting fence in `jsonResult`**: wrap all tool output as untrusted data. Expected impact: SC-4; Effort: medium (single funnel, but must not break structured consumers).

### Optimization Opportunities

1. **Exact-path process kill**: replace `pkill -f` with exe-path+PID matching. Expected impact: SC-5; Effort: medium (cross-platform).

## Success Criteria

Success criteria: [requirements](03-requirements-elicitation.md#success-criteria). This document contributes the baselines and gaps above; the analysis-derived targets below are restated as baseline→target mappings, each validated by the unit test suite.

### Measurement Strategy

**How will we validate improvements?**
- Drive each baseline "unsafe default" count to its target and assert via `npm run test:unit` (existing `update.test.js`, `launch.test.js`, `sanitization.test.js` plus new gating/fencing tests).
- Before/after comparison re-runs the exact `rg`/read commands in the Baseline Metrics table; targets:
  - Ungated power-tool registrations: 84 → 0 (power tools gated off by default)
  - ui_evaluate exposed: 1 → 0 (replaced by allowlist capabilities)
  - tv_update auth guard points: 0 → token + origin-allowlist + signed-tag present
  - Fenced tool outputs: 0 → all via `jsonResult` wrap
  - Unpinned CI action refs: 2 → 0 (SHA-pinned); audit non-blocking → blocking; `permissions:` 0 → least-privilege
  - Exact dependency pins: 0 → 3 (lockfile authoritative)
  - Broad `pkill -f`: present → exact-path kill; kill_existing default: doc-only → schema-enforced (default false)

## Sources of Evidence

| Source | Type | What It Showed |
|--------|------|----------------|
| `src/server.js:72-86` | Code | 14 registrars, unconditional registration |
| `src/tools/_format.js:5-9` | Code | Unfenced `jsonResult` output funnel |
| `src/tools/ui.js:88-93`, `src/core/ui.js` | Code | ui_evaluate wildcard + safe selector pattern |
| `src/core/update.js:23-104` | Code | Authenticated-merge-mechanics but unauthenticated-fetch self-update |
| `src/core/pine.js:186-199` | Code | Unconditional pine_check source upload |
| `src/core/health.js:352-380`, `src/tools/health.js:22-33` | Code | Broad process kill + doc-only kill_existing default |
| `src/connection.js:8` | Code | Loopback-only CDP default |
| `.github/workflows/ci.yml` | Config | Unpinned `@v4` actions, non-blocking audit, no permissions |
| `package.json:26-32` | Config | Caret dependency ranges |
| `agents/performance-analyst.md:6` | Config | Agent granted full tool surface |
| GitNexus `context(jsonResult)` | Graph | 14 registrar callers → single output choke point |
| `rg` guard-point counts (2026-08-08) | Metrics | 0 gating/allowlist/fencing guard points present |

**Status:** Ready for plan-prepare activity
