# Refactoring Playbook — Minimal Changes, Collapse Limits, Side-Parameterization, Symmetry

> Hard-won process lessons from taking `RSIZoneDiv` through: v5→v6 conversion, a failed UDT
> mirror-collapse, a regression-preserving unification, and a fully-symmetric variant.

## 1. Sequence minimal, individually-verified changes

Do not bundle. The working sequence that isolated the v6 regression was:

1. Convert v5→v6 (built-in converter). **Test** → regression (2/3).
2. Hoist direct `ta.*` out of conditionals (clears warnings). **Test** → still 2/3.
3. Gate trough flags for `bool na` timing. **Test** → still 2/3 (ruled out `bool na`).
4. Hoist stateful library method calls out of conditionals. **Test** → **3/3 green.**

Each step had a hypothesis and a test. When a step didn't fix it, that *ruled out* a cause —
which is progress. If we had bundled 2+3+4, we could not have attributed the fix.

**Principle.** One variable per experiment; re-run the diff after each; a step that doesn't
move the needle eliminates a hypothesis and is therefore not wasted.

## 2. Respect the limits of "verbatim collapse"

The instinct "these two blocks are near-identical, collapse them into a UDT" failed because
the duplication carried **`[1]` series history**, and `var` UDT fields don't preserve that
(see `01-pine-language-semantics.md` §1). 

**Rule.** Before collapsing duplicated stateful code, classify every captured variable:
- **Pure / per-bar value** → safe to move into a function or UDT.
- **History-read (`x[1]`, `ta.*`)** → must stay a flat global series; pass its `[1]` into a
  pure function as `prevX`.

## 3. Side-parameterization (the pattern that worked)

The successful unification kept state flat and pushed direction into a `dir` parameter:

```pine
better(dir, a, b) => dir > 0 ? a < b : a > b          // "more extreme for this side"
f_mom_zcap(dir, capEn, rcap, prevZcap, tol, mid) =>
    capEn ? better(dir, rcap, prevZcap - dir * tol) ? rcap : prevZcap : mid
```

- `dir = +1` → low (bullish) side; `dir = -1` → high (bearish) side.
- All `[1]` / `ta.*` stay in global scope; helpers are **pure next-value logic** taking
  `prev*` args.
- Bind `dir` once per side at the call site; share everything else.

## 4. Don't assume directional symmetry — verify against the original

A subtle bug: the range-metrics accumulation (`f_summit_peak`, `f_band_peak`,
`f_summit_trough`) was initially written direction-aware via `better(dir,...)`, on the
assumption that the high side mirrors the low side. The **original code used `>` (max) on
both sides** for these. The fix was to make those helpers **direction-independent**.

**Principle.** "These two sides should be mirror images" is a hypothesis to *check against
the source*, not a fact. The original may share a max-accumulation across both directions.

## 5. Regression-preserving vs behavior-normalizing — decide, then label

- The **340-unified** version was regression-preserving: it deliberately kept the high-side
  `pph_con_b := p_hi[1]` quirk verbatim so signals stayed 3/3. Header comment says so.
- The **fully-symmetric** variants (SymLo / SymHi) were behavior-normalizing: they removed
  *all* asymmetry, accepting the baseline might shift. New baselines were frozen for each.

**Rule.** Put the intent in the file header (`Reference version: ...` + what is preserved vs
normalized) so a future reader knows whether the baseline is a gate or a measurement.

## 6. When unifying asymmetric sides, generate BOTH directions and measure

Rather than argue which side's structure is "correct," produce both fully-symmetric variants
(both-sides-on-low-structure and both-sides-on-high-structure), capture each, and diff the
signal sets. The data decides which normalization is preferable. This session: SymLo matched
the 3/3 baseline on the 300-bar UKOIL window.

**Measured result (UKOIL 5m, full 3717-bar depth).** Once the window contained both
polarities (see `02` §7 — coverage matters), the two variants discriminated cleanly:

| Side | baseline | SymLo | SymHi |
|------|----------|-------|-------|
| LOW (11) | 11 | identical | identical |
| HIGH (12) | 12 | **11** — drops `2026-07-23 18:15` | 12 — identical |

- **LOW identical across all three** → both rewrites preserved the low-side chain. SymLo's
  native low side and SymHi's normalized-to-high low side agree on every bar. Strong evidence
  the low-side unification is behavior-neutral.
- **HIGH differs by one** → the asymmetry surfaces only on the side whose structure was
  swapped. SymHi's high side is the native chain, so it matches baseline exactly. SymLo's high
  side uses the low-side `f_price_rcap` (`prevRp > 1` range-established gate) + `zcapChange`
  topk, which suppresses a second, higher peak whose range gate wasn't yet satisfied.

**Takeaway.** The symmetric forms are *behaviorally* distinguishable precisely where the
structure differs — and only when the window exercises that structure. Generate both, capture
both, and let a both-polarities window arbitrate.

**Decision (2026-08-12).** Adopted **SymLo** — both sides unified onto the low-side structure —
as the canonical direction. Rationale: its low side fired 11/11 identical to baseline (zero cost
on the side that was already correct), and the stricter high side (11 vs 12 HIGH, via the
`prevRp > 1` range-established gate) is the intended normalization, not a regression. Verified
saved cloud `RSIZoneSymLo` v2.0 (386 lines) matches the canonical source. SymHi superseded.

## 7. Enumerate asymmetries explicitly before rewriting

List every low↔high difference as a labeled item (A, B, C…) with file:line references before
touching code. For `RSIZoneDiv` the peak-price chain had six: `con_b` capture, `con_w`
gating, dead `hit_b`, `scap` structure, `rcap` latch/range-gate, and `topk` edge source.
A written inventory prevents "fixing" three and silently shipping the other three.

## 8. Keep a paper trail of provenance

Intermediate probes and step files (`rszonediv_step1`, `rszonediv_debug`,
`rszonediv_collapsed`, `udt_hist_probe`) were retained, not deleted. When a later step
regresses, being able to re-capture an earlier step and diff isolates the breaking change
immediately. Disk is cheap; re-deriving a lost intermediate state is not.
