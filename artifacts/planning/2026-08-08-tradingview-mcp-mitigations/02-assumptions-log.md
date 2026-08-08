# Assumptions Log

> TradingView MCP Security Mitigations · (no issue — repo issues disabled) · updated 2026-08-08

## Log

One row per assumption, updated in place. IDs: two-letter phase prefix + sequence
(DP-1, RE-1, RS-1, IA-1, PL-1) or task number (1.1, 2.3).

| ID | Phase/Task | Category | Risk | Assumption — rationale | Resolution | Outcome |
|----|------------|----------|------|------------------------|------------|---------|
| DP-1 | Design Philosophy | Problem Interpretation | M | Full removal of `ui_evaluate` is preferable to keeping it env-gated — the plan recommends removal ("no default agent should ever see it") but marks it an assumption to confirm; gating preserves advanced-user escape hatch | — | Open (stakeholder-dependent — usability/security trade-off) |
| DP-2 | Design Philosophy | Problem Interpretation | M | `tv_update` remains an MCP tool behind `TV_UPDATE_TOKEN` + allowlist + signed-tag pinning rather than becoming CLI-only — plan flags both options; tool form preserves remote operability | — | Open (stakeholder-dependent — operability/security trade-off) |
| DP-3 | Design Philosophy | Complexity Assessment | M | `DANGEROUS_TOOLS` membership is exactly { `ui_evaluate`, `tv_update` } plus opt-in { `tv_launch`, `alert_delete`, `draw_clear`, `batch_run` } — plan's "plus optionally" phrasing leaves the extended set undecided | — | Open (stakeholder-dependent — blast-radius tolerance) |
| DP-4 | Design Philosophy | Complexity Assessment | L | Complex classification and full path hold — the plan's 9 finding areas with open trade-offs justify elicitation + research; user confirmed at checkpoint | User (classification-and-path-confirmed) | Confirmed |
| DP-5 | Design Philosophy | Workflow Path | L | GitHub Issues being disabled is accepted for this work package — PR #1 + planning folder carry coordination; no tracker linkage will exist | Code: `gh issue list` → "repository has disabled issues" | Validated |
