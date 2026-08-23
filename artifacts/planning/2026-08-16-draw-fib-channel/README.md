# draw_fib_channel — August 2026

> First-class Fibonacci channel from a saved template + three loci · [issue #29](https://github.com/m2ux/tradingview-mcp/issues/29) · Started 2026-08-16

## Executive Summary

`draw_shape` only creates `horizontal_line`, `vertical_line`, `trend_line`, `rectangle`, and `text`. Plotting a Fibonacci channel from a saved style (e.g. `_Base_T`) and three OHLC extremes is a live operator path — Kennedy base/accel/decel channels — but it is not a first-class tool.

Today an agent must `draw_template_get` a `LineToolFibChannel` template, drop into `ui_evaluate`, and call async `createMultipointShape` with `shape: "fib_channel"` and a non-enumerable `template:` option. That path worked (2026-08-16, `TVC:UKOIL` 45m, template `_Base_T`, entity `PZ9yZF`) but is archaeology every time.

This package adds `draw_fib_channel` next to the existing `draw_*` tools. Flat `draw_` prefix; always-on (same gate as `draw_shape`, not `draw_clear`). Unknown template names refuse — no factory-default fallback (unknown `shape` keys map to `flag`).

Related: F-5 in `2026-08-08-tradingview-mcp-mitigations/follow-ups.md` deferred custom channel/level tools. This is the first concrete slice — one drawing type, not the full `channel_*` / `level_*` suite.

## Problem Overview

| # | Failure | Harm |
|---|---------|------|
| 1 | No first-class fib-channel tool | Agent reconstructs `createMultipointShape` + `template:` from minified internals every session |
| 2 | Unknown `shape` keys become `flag` | Silent wrong drawing if the template/shape path is guessed |
| 3 | `drawShape` uses sync `evaluate` | `createMultipointShape` is async; a sync path would miss the thenable |

## Solution Overview

```
draw_fib_channel({
  template: "_Base_T",
  point:  { time, price },
  point2: { time, price },
  point3: { time, price }
})
→ { success, entity_id, template, points }
```

1. Exact-name check against `/drawing-templates/LineToolFibChannel/`.
2. Load content via existing `getTemplate({ drawing_type: "fibonacci channel", name })`.
3. `evaluateAsync` → `api.createMultipointShape(points, { shape: "fib_channel", template: content })`.
4. Point order is TradingView click order: baseline `point`→`point2`, offset `point3`.

## Progress

| # | Item | Status |
|---|------|--------|
| 1 | Planning folder + worktree + branch | ✅ |
| 2 | `drawFibChannel` core (list → get → async create) | ✅ |
| 3 | MCP tool + CLI + always-on gate | ✅ |
| 4 | Docs (tool-registry / AGENTS / CLAUDE / server count 89→90) | ✅ |
| 5 | Unit tests (create args + unknown template refuses) | ✅ |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked

## Links

| Resource | Link |
|----------|------|
| Issue | [#29](https://github.com/m2ux/tradingview-mcp/issues/29) |
| Related | F-5 custom drawing tools (deferred suite) |
| Branch | `feat/29-draw-fib-channel` |
| Worktree | `.worktrees/2026-08-16-draw-fib-channel` |
| Plan | [01-plan.md](01-plan.md) |

## GitNexus blast radius (pre-edit)

| Symbol | Risk | Direct callers |
|--------|------|----------------|
| `drawShape` | LOW (untouched) | CLI draw, sanitization tests |
| `getTemplate` / `listTemplates` | LOW (reused, not changed) | tools, CLI, e2e, drawing_templates tests |
| `evaluateAsync` | LOW (new caller) | existing async tools |

New `drawFibChannel` is additive. `drawShape` stays two-point / no-template.
