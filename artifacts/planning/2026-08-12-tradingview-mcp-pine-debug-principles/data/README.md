# Reference Captures — Evidence for the Debug-Principles Notes

> Frozen signal/price series captured from the live chart via `scripts/capture_study_series.mjs`
> (the same read path as `data_get_study_series`). These are the datasets behind the conclusions
> in `02` §7 (window coverage), `04` §6 (SymLo/SymHi discrimination), and `05` P7/P8.
> Each `.json` has a `.csv` sidecar for quick plotting/diffing.

## UKOIL 30m — adopted SymLo baseline (regression gate)

| File | Bars | Range | LOW | HIGH | Notes |
|------|------|-------|-----|------|-------|
| `rszonediv_sym_lo_ukoil_30m_baseline.json` | 8968 / 8968 | 2025-10-29 → 2026-08-12 | 27 | 31 | **Canonical baseline.** Full loaded depth, both polarities richly represented. The regression gate for future SymLo changes. |

Captured with `TV_MAX_BARS=9000` (overrides the 500-bar default; see `02` §7).

## UKOIL 5m — three-way symmetric-variant discrimination (3717 bars)

| File | Variant | LOW | HIGH | vs baseline |
|------|---------|-----|------|-------------|
| `rszonediv_unified_ukoil_5m_full.json` | baseline (340-unified) | 11 | 12 | — |
| `rszonediv_sym_lo_ukoil_5m_full.json` | SymLo (low-side structure, both sides) | 11 | **11** | drops HIGH `2026-07-23 18:15` |
| `rszonediv_sym_hi_ukoil_5m_full.json` | SymHi (high-side structure, both sides) | 11 | 12 | identical |

- **LOW identical across all three** → both rewrites preserved the low-side chain (the adopted
  SymLo is behavior-neutral on the side that was already correct).
- **HIGH differs by one** → the asymmetry surfaces only on the side whose structure was swapped.
  SymLo's high side applies the `prevRp > 1` range-established gate, suppressing a second, higher
  peak whose gate wasn't yet satisfied.

**Window-coverage caveat (the point of `02` §7 / P7).** At the *default* 500-bar capture these
three were byte-identical (4 HIGH / 0 LOW) — a vacuous equivalence, because the low-side chain
never fired in that slice. The discrimination only appeared after zooming out and re-capturing at
full depth. Always confirm both polarities are present before concluding equivalence.

## Provenance

- Symbol `TVC:UKOIL`; entity IDs from `study_add_pine` (session-specific — do not cache across restarts).
- 5m captures: 3717 bars (window at time of capture); 30m baseline: 8968 bars.
- These are *measurements* of the behavior-normalizing symmetric rewrites, not gates on the
  original v6 baseline (that gate is `rszonediv_v6_4d_300.json` under `scripts/reference/`).
