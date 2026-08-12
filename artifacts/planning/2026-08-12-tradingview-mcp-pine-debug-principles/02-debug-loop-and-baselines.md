# Debug Loop & Baselines — Reference Capture, Targeting, Regression Diffing

> The goal is a **deterministic** loop: edit → save → render → capture → diff. Every failure
> this session traced back to a step that was *not* deterministic (ambiguous target, missed
> dialog, unbound buffer). Make each step return a typed, checkable result.

## 1. Always establish a frozen green baseline first

Before any "efficiency" or "collapse" edit, capture a reference on a known symbol/timeframe
and freeze it. This is your regression gate.

- Capture price **and** the study's signal plots together, aligned by time.
- Store under `scripts/reference/` as both `.json` and `.csv`.
- Tools: `scripts/capture_study_series.mjs` (reads via the same path as
  `data_get_study_series`) → `scripts/diff_study_series.mjs` to diff.

**Reference set used this session:**
- `rszonediv_v6_4d_300.json` — verified-green v6 baseline (3/3 vs v5 reference).
- `rszonediv_unified_4d_300.json` — the 340-unified baseline (3/3 vs v6fix).
- `rszonediv_sym_lo_4d_300.json` — fully-symmetric low-side variant (3/3 vs baseline).

## 2. Target by `entity_id`, never by name substring

`data_get_study_series` / `getStudySeries` historically matched studies by **name substring,
first match wins**. With any duplicate study on the chart, the capture is non-deterministic.

**Rule.** Capture with the exact `entity_id` returned by `study_add_pine` / `study_add`.
Fall back to name substring only when no id exists. The capture script accepts
`--entity-id <id>` (issue #15) — use it.

**Anti-pattern.** "It captured something, must be the right study." If the chart has two
studies with the same title, a name-based capture can silently read the stale one.

## 3. Disambiguate the *chart tab* explicitly

`chart_id` / URL changes across restarts and tab reloads. After a server restart, the tab you
were on is gone; the active tab may be a different symbol/timeframe.

**Rule.** At session start (and after any restart), re-derive the working tab:
`tab_list` → `chart_get_state(target=...)` → confirm `symbol` + `resolution`. Better: set up
a **dedicated session tab** (`tab_new`) with the exact symbol/timeframe, so you are never
recycling a tab whose contents you don't control.

**Anti-pattern.** Assuming the attached tab is the reference chart. This session started on
`IG:OILUK 2m` when the baseline was `TVC:UKOIL`. Symbol feeds differ (IG CFD vs TVC index),
so signals are *not* comparable across them.

## 4. Compare signal *sets*, not vibes

Extract the signal bars (e.g. `plot_0`/`plot_1` nonzero) into date sets and diff the sets.
Report counts and the exact dates that differ. "3/3 PASS" means the set is identical —
anything less is a regression to be root-caused, not approximated.

## 5. Debug plots are essential — but know the capture limits

Liberal debug plotting (`plotshape`, extra `plot(..., display=...)`) is the right instinct.
**But:** `display.none` / `display.data_window`-only plots are **not** returned by
`data_get_study_series`. If a debug series isn't showing up in captures, that is why — it is
a tool limitation, not a logic error. Keep debug series on a *capturable* display mode when
you need them in the diff.

## 6. One variable per experiment; re-baseline when behavior is meant to change

- Change one thing, re-run the diff, confirm green before the next change.
- When you intentionally change behavior (behavior-normalizing), the old baseline becomes a
  *measurement* of the delta. Capture a **new** baseline for the new intended behavior and
  freeze it before the next experiment.

## 7. Verify the window actually contains both signal polarities

A signal-set diff is only as informative as the window's coverage. If the captured window has
zero signals of one polarity, "identical output" is **vacuous** for the logic that produces
that polarity — it never ran.

**Concrete case (UKOIL 5m).** With the default 500-bar capture, all three variants
(baseline / SymLo / SymHi) returned **4 HIGH / 0 LOW**, byte-identical. That looked like full
equivalence — but the low↔high asymmetry the variants target lives almost entirely in the
**low-side peak-price chain**, which never fired. The equivalence was real but *uninformative*.
Only after zooming out and re-capturing at full depth (3717 bars, `TV_MAX_BARS=4000`) did a
LOW set (11) and a discriminating HIGH difference appear.

**Rule.** Before concluding equivalence (or difference), check the captured window has a
non-trivial count of *each* polarity you care about. If a polarity is absent, widen the window
(scroll / zoom / raise the bar cap) until both fire — otherwise the comparison proves nothing
about that side.

**Capture-depth mechanism.** `getStudySeries` clamps `count` to `resolveMaxBars(max_bars)`:
`TV_MAX_BARS` env (server default 500), or a per-call `max_bars`. The capture script reads the
**latest** N bars of loaded history — it does *not* follow the visible/zoom range. So:
- Zooming out loads more history but the capture still takes the **latest** slice unless you
  raise the cap.
- Pass a per-call `max_bars` (or set `TV_MAX_BARS`) ≥ `total_available` to capture the full
  loaded window. Check `total_available` in the output to know how much is actually loaded.

## 8. Keep the loop DOM-free

Every DOM interaction in the loop (Open dialog, "Save before adding?", name menu) is a
non-determinism vector. The deterministic loop uses only headless steps:

```
edit source (file)
→ pine_bind (bind buffer↔identity)        # headless
→ pine_set_source → pine_save (verified)  # buffer-aware, returns persisted_matches_buffer
→ study_add_pine(script_id) → entity_id   # headless add, no dialog
→ data_get_study_series(entity_id)        # unambiguous read
→ diff vs baseline
```

See `03-mcp-tooling-headless-vs-dom.md` for the failure signatures each headless step avoids.
