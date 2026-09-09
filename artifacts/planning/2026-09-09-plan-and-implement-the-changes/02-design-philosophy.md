# Design Philosophy

> design-philosophy · Pine live-edit loop · #32 Pine live-edit loop: wrong plot values, compile adds the library, wizard writes the editor · 2026-09-09

## Problem Statement

Filtered study-series reads, library compile, publish-wizard input, bind, leftover update wizards, and chart-region screenshots currently fail in named ways during a live Pine library update on TradingView Desktop. Agents debug the wrong plot values, drop the library onto a production layout, and can overwrite or delete a published library. Leaving the traps in place makes that update walk unsafe.

### System Context

The MCP server talks to TradingView Desktop over CDP. Study series are read in `src/core/data.js` (`getStudySeries`). Pine compile, add-to-chart, bind, and publish live in `src/core/pine.js` and `src/tools/pine.js`. Generic UI fill and click helpers drive the publish wizard. Capture writes chart-region screenshots. The session that produced the ticket used a private library already published (update-existing).

### Impact Assessment

| Aspect | Description |
|--------|-------------|
| Severity | High for bind/wizard/delete paths (published library overwrite or deletion); Medium for wrong plot values and extra studies on a live layout |
| Scope | Agents using study-series, smart compile, UI input/click, publish, bind, and chart screenshots on Desktop CDP |
| Business Impact | A routine library update produces silently wrong numbers, pollutes the chart, or nearly publishes wizard text as source |

## Problem Classification

**Type:** Specific Problem

**Subtype:**
- [x] Cause Known (direct fix)
- [ ] Cause Unknown (investigate first)
- [ ] Improvement goal
- [ ] Prevention goal

**Complexity:** Simple

**Rationale:** Each trap has a stated mechanism in #32. GitNexus impact on `getStudySeries` is LOW (three direct callers, two processes). Classify originally assessed moderate because seven tools exceed a half-hour single-site fix. The workflow-path checkpoint set complexity to simple (`skip-optional`). This record notes that divergence; it does not re-open the type.

## Workflow Path Decision

**Selected Path:** Direct to planning (skip optional discovery)

**Activities Included:**
- [ ] Requirements Elicitation
- [ ] Research
- [x] Implementation Analysis
- [x] Plan & Prepare

**Rationale:** Skip-optional matches a well-defined ticket with named mechanisms and acceptance checks. Comprehension still runs before planning. At simple complexity the design framework warrants problem definition, conventional solutions, and synthesis — not inventive-solution work. Elicitation and research are skipped. The original classify moderate vs this path's simple is recorded above, not resolved here.

## Constraints

| Constraint Type | Description |
|-----------------|-------------|
| Time | Localized conventional fixes; no wait on TradingView API changes |
| Technical | Desktop CDP session; private library already published (update-existing) |
| Dependencies | Live Desktop for visual verify; unit tests can lock filtered vs unfiltered series equality on a fixture row |
| Resources | Work stays in `m2ux/tradingview-mcp` on `fix/32-pine-live-edit-loop-wrong-plot-values` / draft PR #33 |

## Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| Filtered series values | `data_get_study_series` for `plot_N` vs unfiltered same ID on the same bars | Values match |
| Library compile persist | `pine_smart_compile` on a library | `persisted: true`, `study_added: false`, Pine Save (or equivalent persist) |
| Wizard input | `ui_set_input` with publish wizard open | Cannot write Monaco; notes match the change-description placeholder only |
| Dialog classify | `tv_ui_state` / click helpers | Distinguish overlay Close, wizard Close, and Delete this publication (Cancel is safe on delete) |
| Bind vs dirty buffer | `pine_bind` with unsaved Monaco | Does not replace the dirty buffer without an explicit reload |
| Leftover update wizard | `pine_publish` with update wizard already open | Resumes or refuses; does not stack a second wizard or claim a new version on an unchanged snapshot |
| Chart screenshot | Chart-region capture with a covering overlay | Does not return an account-menu clip as a successful chart capture |

Application-script changes (RSIZones W membership, RSIHeat ribbon hold, RSIZGen right-shoulder latch) are out of scope per #32.
