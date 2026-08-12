# RSIZoneDiv — Library-Generic Engine (scaffold)

> Branch `feat/rszonediv-generic-refactor`. Implementation lands here step-by-step per the plan in
> `.engineering/artifacts/planning/2026-08-12-tradingview-mcp-pine-debug-principles/07-library-generic-refactor-plan.md`.

## What this is

The adopted `RSIZoneSymLo` indicator hard-wires `import theansweris42/RSIZones/1 as mt` and reaches
into `mint1.*` in ~40 places. This refactor decouples the divergence-detection engine from that
concrete zone source so it can be driven by **any** source satisfying a small explicit contract.

## Architecture (three layers)

```
indicator shell (thin)  →  zone-source adapter  →  generic divergence engine
(inputs, plots, dir)       (builds ZoneState)      (side-parameterized helpers + step())
```

- **`ZoneState`** — a per-bar (non-`var`) snapshot of the 14 measured inputs the engine needs:
  per-side zone-state bools (`z0/zw/zx`), zone intensity (`rz`), edge detectors
  (`noRise/noFall/isWFall`), and the momentum value (`mom`). Never read with `[1]`, so it is a
  value, not a history carrier — the property that makes this safe where the UDT collapse was not.
- **Engine library** (`RSIZoneDivEngine`) — the pure, already-side-parameterized helpers lifted
  from SymLo, plus a per-side `step()` taking `dir` + `ZoneState` + explicit `prev*` args.
- **Shell** — one concrete import + one adapter call per side; flat per-side `[1]` history globals.

## Contract (measured from `rszonediv_sym_lo.pine`)

| Category | Inputs |
|----------|--------|
| Zone-state bools (per side) | `z0`, `zw`, `zx` |
| Zone intensity | `rz` (0..4) |
| Edge detectors | `noRise`, `noFall`, `isWFall` |
| Momentum value | `mom` (e.g. RSI) |

## Regression gate

`scripts/reference/rszonediv_sym_lo_ukoil_30m_baseline.json` — 27 LOW / 31 HIGH. Every step must
diff 58/58 signals, drift 0, both polarities present. This refactor is **regression-preserving**.

## Steps

1. Extract pure helpers into the engine library (pure move).
2. Introduce the `ZoneState` adapter for RSIZones.
3. Move the per-side state machine into the engine as `step()` (explicit `prev*`, not `var` UDT `[1]`).
4. Generalize the adapter seam; document the contract. **Paper exercise:** map two hypothetical
   sources (fixed-threshold RSI bands; Bollinger-%B) onto `ZoneState` and generalize any field that
   leaks RSIZones semantics before the published API is locked at step 5.
5. Privately publish + pin the engine library; switch the shell to the published import.
