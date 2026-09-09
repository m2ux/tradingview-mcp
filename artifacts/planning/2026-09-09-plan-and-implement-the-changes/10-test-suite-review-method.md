# Test Suite Review Method

> test-suite review method · Pine live-edit loop · 2026-09-09 · findings: [test suite review report](10-test-suite-review.md)

## Review Scope

| Aspect | Details |
|--------|---------|
| Module(s) Reviewed | `src/core/{data,ui,dom,pine,pine_ui,capture,err,health}.js`, `src/tools/{pine,ui,health}.js` |
| Test Files Analyzed | 4 authored (`tests/study_series.test.js`, `tests/ui_verbs.test.js`, `tests/issue26_pine_friction.test.js`, `tests/target_reads.test.js`) |
| Total Tests Reviewed | 74 in the baseline run (includes pre-existing cases in those files) |
| Testing Framework | node:test |

## Suite Baseline

Command, run 2026-09-09 in the feature worktree at `7cc9223`:

```bash
node --test tests/study_series.test.js tests/ui_verbs.test.js tests/issue26_pine_friction.test.js tests/target_reads.test.js
```

Result: 74 passed, 0 failed, ~1.6s. Authority for suite claims in this review is that local run at this head. The test plan also names `pine_workflow.test.js` and `pine_write_path.test.js`; those files are not in the authored surface and were not run here.

## Assessment Criteria

Coverage completeness fails on the library-compile Save-missing path ([TR-1](10-test-suite-review.md#tr-1--library-compile-untested-when-pine-save-is-absent)). Other criteria pass.

## Individual Test Function Analysis

72–73 of 74 authored-relevant cases clean. Row only for the gap:

| Test Function | Anti-Patterns | Business Value | Issues |
|---------------|---------------|----------------|--------|
| `clicks Pine Save on a library buffer…` | none | High | Does not cover Save absent |

## Anti-Pattern Detection Summary

Total tests analyzed: 74 · with anti-patterns: 0 · clean: 74 · rate: 0%

The `smartCompile` stub inspects `preferSave` in the generated string rather than eval-ing the page script. That is a harness limit, recorded as the coverage gap in [TR-1](10-test-suite-review.md#tr-1--library-compile-untested-when-pine-save-is-absent), not as a listed anti-pattern on the passing cases.

## Coverage Analysis

### Coverage Gaps Identified

| Area | Gap Description | Priority |
|------|-----------------|----------|
| `smartCompile` / library | Save missing, Add visible | High |

Changed-symbol map (hand-derived from the diff plus GitNexus `context` callers):

| Symbol | Test callers |
|--------|----------------|
| `getStudySeries` | `study_series.test.js` (filtered slot) |
| `setInput` | `ui_verbs.test.js` |
| `captureScreenshot` | `target_reads.test.js` |
| `findElementExpression` | `ui_verbs.test.js` |
| `classifyUiDialog` | `issue26_pine_friction.test.js` |
| `bindScript` | `issue26_pine_friction.test.js` |
| `publishScript` | `issue26_pine_friction.test.js` |
| `smartCompile` | `issue26_pine_friction.test.js` (Save present only) |

### Test Pyramid Assessment

Pyramid OK (unit ~100% / integration 0% / e2e 0% of this authored set). Live case PR33-TC-11 remains manual per the test plan.

## Test Redundancy Analysis

None.

## Reported-Failure Triage

None. Baseline green.
