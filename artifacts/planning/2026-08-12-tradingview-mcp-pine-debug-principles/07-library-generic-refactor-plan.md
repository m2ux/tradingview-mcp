# RSIZoneDiv — Library-Generic Refactor Plan

> Work package · tradingview-mcp · 2026-08-12 · **Status:** Planned — [PR #20](https://github.com/m2ux/tradingview-mcp/pull/20) (branch `feat/rszonediv-generic-refactor`)
>
> **Companion reading:** `01-pine-language-semantics.md` (esp. §1 UDT history, §3 lazy eval),
> `04-refactoring-playbook.md` (esp. §2 collapse limits, §3 side-parameterization, §7 asymmetry
> inventory), `02-debug-loop-and-baselines.md` (the deterministic loop + regression gate).
> **Regression gate:** `scripts/reference/rszonediv_sym_lo_ukoil_30m_baseline.json` (27 LOW / 31 HIGH).

---

## 1. Goal

Turn the adopted `RSIZoneSymLo` indicator into a **library-generic momentum-divergence engine**:
the divergence-detection logic (capture state machine, peak-price chain, momentum chain,
divergence counter) must be decoupled from the concrete `RSIZones` import so it can be driven by
**any** zone/band source that satisfies a small, explicit contract.

This is the "deeper refactor" deferred when the verbatim UDT mirror-collapse failed
(`01` §1). SymLo was the intermediate: it put both sides on one side-parameterized chain, which is
exactly the structure a generic rewrite needs.

## 2. Why now / why this is safe to attempt

- Both sides already share **one** side-parameterized helper set (`better`, `f_capture_state`,
  `f_con`, `f_price_scap`, `f_price_rcap`, `f_mom_*`, `f_topk`, `f_flat`, `f_div_cnt`). The only
  thing still hard-wired to RSIZones is the **per-side state block** that feeds those helpers.
- A **frozen both-polarities regression gate exists** and has been re-verified against the merged
  source (58/58 signals, drift 0). Any regression in the refactor is caught immediately.
- The failure mode that killed the UDT collapse is understood and avoided by construction (§4).

## 3. Measured dependency surface (the contract — measured, not assumed)

`grep` of `rszonediv_sym_lo.pine` shows the engine touches exactly these RSIZones members (39 refs):

| Category | Members | Kind |
|----------|---------|------|
| Zone-state bools (per side) | `rzl_0`, `rzl_w`, `rzl_x`, `rzh_0`, `rzh_w`, `rzh_x` | input to engine |
| Zone-intensity floats | `rzl`, `rzh` | input to engine |
| Edge detectors | `no_rzl_rise`, `no_rzl_fall`, `no_rzh_rise`, `no_rzh_fall`, `is_rzl_w_fall`, `is_rzh_w_fall`, `is_rzh_fall` | input to engine |
| Momentum value | `rsi1` | input to engine |
| Lifecycle | `mint.new()`, `mint.calc(rsi, lx, hx, rh, th, h0, h1)` | construction |
| Conversions | `to_bool`, `to_float` | utility |

Everything else in `RSIZones` (the whole `calc` body, `offsets`, band thresholds, peak tracking)
is **internal to the zone source** and not the engine's concern.

**Design consequence.** The generic engine depends on a *zone-state snapshot* — the 14 inputs
above — produced once per bar by an adapter. It does **not** depend on `mint` at all.

## 4. The binding constraint (from `01` §1) and how the design respects it

The failed collapse moved per-side scalars into a `var` UDT and read `udt.field[1]`, which does
**not** preserve series history → silent 3→0 signal loss. This refactor must therefore:

- **Keep every history-read (`x[1]`, `ta.*`) as a flat global series.** No per-side state with
  `[1]` history moves into a `var` UDT field.
- **Pass previous-bar values explicitly** (`prevX`) into pure functions — the pattern SymLo
  already uses for its helpers.
- A UDT may be used **only** as a per-bar *value bundle* (a non-`var` snapshot constructed fresh
  each bar, or a `var` bundle whose fields are never read with `[1]`), never as a history carrier.

## 5. Target architecture

Three layers, top to bottom:

```
┌─────────────────────────────────────────────────────────────────┐
│ Indicator shell (thin)                                          │
│  - inputs, indicator() decl, plotshape/alert, dir binding       │
│  - picks a concrete zone source via one import + one adapter    │
└─────────────────────────────────────────────────────────────────┘
                          │ builds once per bar
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Zone-source adapter (per concrete library)                      │
│  - RSIZones adapter: mint.calc(...) → ZoneState snapshot        │
│  - future adapters: any source → same ZoneState snapshot        │
│  - hoists ALL stateful edge reads to per-bar globals (lazy-eval)│
└─────────────────────────────────────────────────────────────────┘
                          │ ZoneState (pure per-bar value)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Divergence engine (library-generic) — NEW LIBRARY               │
│  - pure helpers (already side-parameterized in SymLo)           │
│  - per-side state machine driven ONLY by ZoneState + prev*      │
│  - emits per-side trigger + divergence count                    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 The `ZoneState` snapshot (the generic seam)

A single UDT that carries the 14 measured inputs, **constructed fresh each bar** (non-`var`) by the
adapter. Because it is per-bar and never read with `[1]`, it is a value, not a history carrier —
this is what makes it safe where the mirror-collapse was not.

```pine
export type ZoneState
    bool  z0      // in zone-0 (summit band)         <- rzl_0 / rzh_0
    bool  zw      // in wider band                   <- rzl_w / rzh_w
    bool  zx      // in crossover zone               <- rzl_x / rzh_x
    float rz      // zone intensity 0..4             <- rzl / rzh
    bool  noRise  // not rising this bar             <- no_rzl_rise / no_rzh_rise
    bool  noFall  // not falling this bar            <- no_rzl_fall / no_rzh_fall
    bool  isWFall // wider-band falling edge         <- is_rzl_w_fall / is_rzh_w_fall
    float mom     // momentum value (RSI)            <- rsi1
```

One `ZoneState` is built **per side** (low adapter call, high adapter call). The engine consumes
`dir` + that side's `ZoneState` and is otherwise source-agnostic.

### 5.2 The engine library (`RSIZoneDivEngine`)

- **Pure helpers** lifted verbatim from SymLo (`better`, `f_capture_state`, `f_summit_peak`,
  `f_band_peak`, `f_summit_trough`, `f_con`, `f_mom_cap`, `f_range_cap`, `f_mom_zcap`,
  `f_price_zcap`, `f_hit_b`, `f_hit_w`, `f_price_scap`, `f_price_rcap`, `f_topk`, `f_flat`,
  `f_div_cnt`). These are already source-agnostic — zero behavioral change.
- **A per-side `step()` function** that takes `dir`, the side's `ZoneState`, and the side's
  previous-bar state as explicit `prev*` args, and returns the next trigger + divergence count.
  The `[1]` reads stay in the indicator shell (flat globals), satisfying §4.

### 5.3 The thin shell

- One `import ... as mt` (the concrete zone source) + one adapter call per side.
- Flat per-side state globals with `[1]` history (unchanged from SymLo).
- `plotshape` / `alert` wiring (unchanged).

## 6. Stepwise plan (one variable per experiment — `04` §1)

Each step is independently diffed against the 30m gate. **No step merges red.**

1. **Step 1 — Extract pure helpers into the engine library, unchanged.**
   New `RSIZoneDivEngine` library exporting the existing pure helpers. Indicator imports it and
   calls them in place of the inline copies. *Expected: 58/58 identical.* (Pure move, no logic change.)
2. **Step 2 — Introduce the `ZoneState` adapter for RSIZones only.**
   Build low/high `ZoneState` snapshots from `mint1` in the shell; feed the (still inline) state
   blocks from the snapshot instead of direct `mint1.*` reads. *Expected: 58/58 identical.*
3. **Step 3 — Move the per-side state machine into the engine as `step()`.**
   Collapse the two near-identical per-side blocks into one engine call per side, with `prev*`
   passed explicitly. *Expected: 58/58 identical.* This is the step the UDT collapse got wrong —
   done here with flat-history `prev*` passing, not `var` UDT `[1]`.
4. **Step 4 — Generalize the adapter seam.**
   Define the adapter as the only place a concrete library is named; document the `ZoneState`
   contract so a second zone source can be dropped in. (Optionally demonstrate with a trivial
   fixed-threshold zone source to prove genericity.) *Expected: 58/58 identical for RSIZones.*
5. **Step 5 — Publish + pin the engine library; update the indicator to the published import.**
   Follows the `pine-publish` skill (private publish, `import user/RSIZoneDivEngine/1`).
   Re-freeze if the published import path changes anything (it should not).

## 7. Risks / anti-patterns to watch

- **L1 (`var` UDT `[1]`)** — the whole point. `ZoneState` is per-bar/non-`var`; per-side history
  stays flat. Verified at Step 3.
- **L2 (stateful call in conditional)** — the adapter must hoist every `mint1.*` edge read to a
  per-bar global *before* building the snapshot (SymLo already does this; keep it).
- **P3 (preserve↔normalize drift)** — this refactor is **regression-preserving** by intent. The
  gate is a gate, not a measurement. Any signal change is a bug to root-cause, not a normalization.
- **P7/P8 (vacuous window)** — the 30m gate has both polarities richly (27/31); the diff harness
  reports exact dates. Capture with `TV_MAX_BARS=9000`.
- **Publish/identity traps** — engine publish uses the registered-copy flow (`pine_copy`), never
  orphan facade save/new (`03` §4). `shorttitle` ≤ 10 chars (`01` §6).

## 8. Deliverables

- `scripts/engine/rszonediv_engine.pine` — the generic engine library (new).
- `scripts/rszonediv_generic.pine` — the thin indicator shell (RSIZones adapter + engine import).
- Updated `scripts/reference/` — re-frozen gate if any step legitimately shifts behavior (none expected).
- This plan + step diffs recorded in the PR.

## 9. Open questions for the reviewer

1. **Engine as a published library vs. inline include?** Pine has no local includes — reuse across
   indicators requires a published library (`import user/.../N`). Plan assumes published (Step 5).
2. **One generic shell vs. keep SymLo as the RSIZones-specific build?** Leaning to: the generic
   shell *becomes* the RSIZones build (adapter = RSIZones), so there's a single source of truth.
3. **Demonstrate genericity with a second zone source now, or defer?** Leaning to defer (Step 4
   optional) — prove the seam is clean by contract, add a second source when one is actually needed.
