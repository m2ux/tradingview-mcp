# Capture-loop tooling (study-series reference + regression harness)

Debug/test loop for developing and safely changing Pine indicators against a
**frozen reference plot**. Built for the `data_get_study_series` feature; works
against any chart tab over CDP. Use it to (a) capture a known-good baseline of a
study's per-bar signal + price series, and (b) prove a later edit hasn't regressed
that baseline before you trust the change.

## Why

`data_get_study_values` returns only the *current* bar. `data_get_study_series`
returns the in-memory historical plot series. These scripts wrap that capability
into a repeatable capture → freeze → edit → re-capture → diff loop, so indicator
work (optimization, refactors, rewrites) is guarded by an objective baseline
instead of eyeballing the chart.

## Scripts

### `scripts/capture_study_series.mjs`
Captures a frozen reference plot (price + study signal series, optionally joined
with a companion RSI study) from a chart tab.

```bash
node scripts/capture_study_series.mjs \
  --target od9I4OCz \              # chart_id / URL substring of the tab (see /json/list)
  --study "RSI Zone Divergence" \  # substring of the study's description
  --rsi "Relative Strength Index" \# companion study to join by time (optional)
  --count 300 --price \
  --from 1761760800 --to 1786510800 --drop-last \
  --timeframes 5,15,30 \
  --calc-time \
  --out scripts/reference/my_baseline.json
```

- Emits `<out>` (JSON) and `<out>.csv` (flat sidecar for plotting/diffing).
- `--from` / `--to` pin an inclusive unix-second or ISO window so new live bars
  do not slide the capture.
- `--drop-last` omits the still-forming last bar.
- `--timeframes 5,15,30` captures the same study on each resolution (restores
  the original afterwards) and writes `<out>_<tf>.json` plus an `_mtf` manifest.
- `--calc-time` records `calculation_time_ms` / `ms_per_bar` when the study
  model exposes a calculationTime.
- `--target` selects the browser tab; omit to use the first chart target. Find
  targets at `http://localhost:9222/json/list`.

### `scripts/diff_study_series.mjs`
Re-captures the live series and diffs it against a frozen reference. Exit 0 = no
regression, exit 1 = differences found.

```bash
node scripts/diff_study_series.mjs \
  --target od9I4OCz \
  --ref scripts/reference/rszonediv_4d_300.json \
  [--tol 1e-6] [--from 1761760800 --to 1786510800 --drop-last]
```

Compares, per shared bar: fired-signal identity (which plot, which side), signal
timing (by bar time), study plot values, companion-RSI values, and close price.
Reports max drift per channel. `--from` / `--to` / `--drop-last` (or the
reference file's `window`) keep the comparison on the pinned range so the
still-forming last bar is out of the signal set.

### `scripts/pine_push.js` / `pine_pull.js`
Read/write the Pine editor source over CDP. Both accept a tab selector via the
`TARGET` env var (chart_id or URL substring); default is the first chart target.

```bash
TARGET=od9I4OCz node scripts/pine_push.js   # push scripts/current.pine + compile
```

## Typical loop

```bash
# 1. Freeze the baseline from the chart under test
node scripts/capture_study_series.mjs --target <tab> --study "<name>" --count 300 --price \
  --from 1761760800 --to 1786510800 --drop-last \
  --out scripts/reference/base.json

# 2. Back up the original source
#    (pine_get_source via MCP, or:) TARGET=<tab> node scripts/pine_pull.js

# 3. Edit the Pine, stage to scripts/current.pine, push + compile
TARGET=<tab> node scripts/pine_push.js

# 4. Regression check against the frozen baseline
node scripts/diff_study_series.mjs --target <tab> --ref scripts/reference/base.json
```

A behavior-preserving change must PASS (signals identical). A deliberate logic
change will FAIL by design — the diff then shows exactly which signals moved,
which is the starting point for grading a rewrite.

## Notes / limitations

- Requires TradingView Desktop running with CDP on `:9222` and the target chart
  tab open.
- Only bars currently loaded in the chart are present in `_items`; `total_available`
  in the capture reports the loaded depth.
- `scripts/reference/` holds baselines + source snapshots (`*.pine`) — commit the
  ones you want to keep as oracles.
