# Anti-Pattern Catalog — Quick Scan

> Fast reference. Each entry: the anti-pattern, how to detect it in the moment, and the fix.
> Cross-links to the detailed docs.

## Process anti-patterns

| # | Anti-pattern | Detection signature | Fix |
|---|--------------|--------------------|-----|
| P1 | **Baseline-free editing** | You're "optimizing" but can't say what green means | Freeze a reference capture first; diff every change (`02` §1) |
| P2 | **Bundled changes** | One commit/step contains >1 hypothesis; a regression can't be attributed | One variable per experiment; test after each (`04` §1) |
| P3 | **Drifting preserve↔normalize** | Started "verbatim collapse," ended changing behavior without re-baselining | Decide the axis up front; label it in the file header (`04` §5) |
| P4 | **Vibe comparison** | "Looks the same" instead of a signal-set diff | Extract signal bars to date sets; diff sets; report exact dates (`02` §4) |
| P5 | **Assuming tab/symbol** | Capture ran, but on the wrong chart/feed | Re-derive tab after any restart; dedicated session tab (`02` §3) |
| P6 | **Deleting intermediates** | A later step regresses and you can't re-diff the prior state | Keep step/probe files for provenance (`04` §8) |
| P7 | **Vacuous equivalence** | "Identical output" on a window where one polarity never fired | Confirm both polarities present before concluding equivalence; widen window otherwise (`02` §7) |
| P8 | **Default-cap window** | Capture reads latest 500 bars; the discriminating history is older | Raise `max_bars`/`TV_MAX_BARS` ≥ `total_available`; check `total_available` in output (`02` §7) |

## Pine-language anti-patterns

| # | Anti-pattern | Detection signature | Fix |
|---|--------------|--------------------|-----|
| L1 | **`var` UDT mirror-collapse** | Clean compile, signals drop to 0 after collapsing into UDT fields with `[1]` | Keep history-read state as flat series; pass `prevX` into pure fns (`01` §1) |
| L2 | **Stateful call in `and`/`or`/ternary** | Mid-series signal lost in v6, no error | Hoist every `ta.*`-wrapping call to a per-bar global before conditionals (`01` §3) |
| L3 | **Direct `ta.*` in a conditional** | Compiler warning; possible history corruption | Hoist to global; then *also* check L2 (warning removal ≠ fix) (`01` §4) |
| L4 | **Relying on v5 `bool na`** | Early-bar timing drift after v6 conversion | Gate flags with `bar_index >= 1` to reproduce v5 timing (`01` §2) |
| L5 | **Long single-line ternary injection** | `Mismatched input 'end of line without line continuation'` after `pine_set_source` | Wrap ternaries at `?`/`:` before injecting; compile to verify (`01` §5) |
| L6 | **`shorttitle` > 10 chars** | Save/identity-guard mismatch | Keep `shorttitle` ≤ 10 chars; it's what `script_name` matches (`01` §6) |
| L7 | **Assuming low↔high mirror symmetry** | Unified helper behaves wrong on one side | Verify against source: original may share max-accumulation across both dirs (`04` §4) |

## Tooling anti-patterns

| # | Anti-pattern | Detection signature | Fix |
|---|--------------|--------------------|-----|
| T1 | **DOM add/update on chart** | Duplicate studies; `study_added:false` ambiguity; missed "Save first?" dialog | `study_add_pine` / `study_remove` headless; save first (`03` §1–2) |
| T2 | **Name-substring capture on duplicates** | Non-deterministic / stale capture | Target by `entity_id` (`02` §2) |
| T3 | **Unbound buffer edit+save** | `verified:false`, `bound_mismatch`, chart not reflecting edits | `pine_bind` then buffer-aware `pine_save`; check `persisted_matches_buffer` (`03` §3) |
| T4 | **Orphan facade save/new** | New script invisible to Open dialog / unpublishable / not resolvable | Use `pine_copy` (registered) — never bare facade save/new (`03` §4) |
| T5 | **Sandboxed `gh`/git-remote** | `Bad credentials` / `connection reset` / `Could not read from remote repository` | Re-run same command with full host permissions before concluding auth is broken (`03` §6) |
| T6 | **`gh pr *` / GraphQL** | GraphQL deprecation failures | REST-only: `gh api repos/...` (`03` §6) |
| T7 | **Gating a flaky tool** | Treating a reliability problem as a trust problem | Build the headless replacement instead; gate is for blast radius (`03` §5) |
| T8 | **Debug plot on non-capturable display** | Debug series absent from `data_get_study_series` | Use a capturable display mode for series you need in diffs (`02` §5) |

## Meta

- **Token-burn signal.** Repeatedly re-attempting the same DOM gesture (open menu, click,
  screenshot) is the tell that you're on the wrong side of the headless/DOM axis. Stop, find
  the headless tool, or file the gap.
- **"It compiled" ≠ "it works."** Three of the worst regressions (L1, L2, L7) compiled clean.
  Only a frozen baseline + signal-set diff catches them.
