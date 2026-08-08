# Test Plan: TradingView MCP Security Mitigations

> **Ticket:** none (repo issues disabled) · **PR:** [#1](https://github.com/m2ux/tradingview-mcp/pull/1)

## Overview

This test plan validates the security-hardening mitigations: a registrar-enforced deny-by-default capability allowlist replaces the `ui_evaluate` wildcard and gates the five power tools; chart/Pine/UI tool output is fenced as untrusted data; `tv_update` authenticates its caller and the fetched provenance and fails closed; `tv_launch` no longer default-kills and terminates only by exact path; `pine_check` upload and remote CDP are opt-in; and the CI/dependency supply chain is pinned and fail-closed.

Key changes to validate:
1. `wrapRegistrar` / `GATED_TOOLS` - deny-by-default gate at the `server.tool` funnel
2. `jsonResult` / `wrapUntrusted` - untrusted-content fencing at the output funnel
3. `update` - token, origin-allowlist, signed-tag/pinned-SHA, fail-closed `npm ci`
4. `launch` / `killExisting` - schema-enforced `kill_existing` default false, exact-path PID kill
5. `check` (pine), `connection.js` - upload and remote-CDP opt-in gates
6. `ci.yml`, `package.json` - pinned actions/deps, blocking audit, least-privilege agent surface

## Planned Test Cases

| Test ID | Objective | Type |
|---------|-----------|------|
| PR1-TC-01 | Verify gated tools are not registered when the gate is closed (default) | Unit |
| PR1-TC-02 | Verify gated tools register when `TV_ALLOW_DANGEROUS=1` | Unit |
| PR1-TC-03 | Verify `ui_evaluate` is never registered regardless of gate state | Unit |
| PR1-TC-04 | Verify gate skips are logged to stderr (audit trail) | Unit |
| PR1-TC-05 | Verify `jsonResult` wraps chart/Pine/UI-derived string values in `UNTRUSTED_*` fences without altering structure or keys | Unit |
| PR1-TC-06 | Verify fenced payload round-trips: JSON parses, fence markers present on nested strings, error payloads handled safely | Unit |
| PR1-TC-07 | Verify server instructions declare fenced content is data, never instructions | Unit |
| PR1-TC-08 | Verify `update()` refuses when `TV_UPDATE_TOKEN` is unset or wrong | Unit |
| PR1-TC-09 | Verify `update()` refuses when resolved origin URL is outside the allowlist | Unit |
| PR1-TC-10 | Verify `update()` fast-forwards only to a signed tag or `TV_UPDATE_PINNED_SHA` match; refuses otherwise | Unit |
| PR1-TC-11 | Verify `update()` fails closed (hard error, no skew) when `npm ci` fails after a merge | Unit |
| PR1-TC-12 | Verify existing update guards (non-git, non-main, dirty, ahead) still refuse before any fetch/auth check regression | Unit |
| PR1-TC-13 | Verify `kill_existing` defaults to false via the zod schema (not description text) | Unit |
| PR1-TC-14 | Verify process termination matches the resolved executable path exactly and kills by PID, never `pkill -f` substring | Unit |
| PR1-TC-15 | Verify the MSIX local-copy fallback honors the caller's `kill_existing` flag | Unit |
| PR1-TC-16 | Verify `pine_check` refuses to POST source unless `TV_ALLOW_PINE_CHECK_UPLOAD=1` | Unit |
| PR1-TC-17 | Verify non-loopback `CDP_HOST` warns/refuses unless `TV_ALLOW_REMOTE_CDP=1` | Unit |
| PR1-TC-18 | Verify `ui_find_element` css strategy escapes user-derived selector values | Unit |
| PR1-TC-19 | Verify CI config: SHA-pinned actions, `permissions: { contents: read }`, pinned runner/Node, audit not continue-on-error, dependency-review job present | Manual |
| PR1-TC-20 | Verify `package.json` exact pins + `security:audit` script runs audit and lockfile-lint | Manual |
| PR1-TC-21 | Verify `agents/performance-analyst.md` no longer grants `tools: - "*"` | Manual |
| PR1-TC-22 | Verify the full unit suite passes with the new guard tests | Integration |

*Detailed steps, expected results, and source links will be added after implementation.*

## Acceptance Criteria Matrix

| Requirement | Acceptance Criterion | Verifying Test Cases |
|-------------|----------------------|----------------------|
| SC-1 | `ui_evaluate` absent; only discrete allowlist capabilities registered | PR1-TC-03, PR1-TC-01 |
| SC-2 | All five DANGEROUS_TOOLS gated off by default; register only on opt-in | PR1-TC-01, PR1-TC-02, PR1-TC-04 |
| SC-3 | `tv_update` token + origin allowlist + signed/pinned ff + fail-closed npm ci | PR1-TC-08, PR1-TC-09, PR1-TC-10, PR1-TC-11, PR1-TC-12 |
| SC-4 | Tool outputs fenced; server instructions declare fenced = data | PR1-TC-05, PR1-TC-06, PR1-TC-07 |
| SC-5 | `kill_existing` schema default false; exact-path kill only | PR1-TC-13, PR1-TC-14, PR1-TC-15 |
| SC-6 | CI pinned + least-privilege permissions + failing audit | PR1-TC-19, PR1-TC-22 |
| SC-7 | `pine_check` upload gate; non-loopback CDP gate | PR1-TC-16, PR1-TC-17 |
| SC-8 | Full `node --test` unit suite green with new guard tests | PR1-TC-22 |

## Running Tests

*Commands will be added after implementation.*
