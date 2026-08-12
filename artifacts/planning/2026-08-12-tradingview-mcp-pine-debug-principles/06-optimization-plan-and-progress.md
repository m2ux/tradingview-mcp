# RSIZoneDiv Optimization — Plan & Progress (Resumption Doc)

> Session work package · tradingview-mcp · 2026-08-12 · **Status:** Active — resume here in a new chat
>
> **Companion reading:** `../2026-08-12-tradingview-mcp-pine-debug-principles/` — the principles &
> anti-patterns this session produced (read `01` + `04` before editing Pine; `02` before trusting
> any capture/diff; `03` when a tool misbehaves; `05` when stuck).

---

## 1. Objective

Take the `RSIZoneDiv` Pine indicator (RSI momentum-divergence detector over the `RSIZones`
adaptive-band library) through an **efficiency optimization**: collapse the near-duplicated
low-side / high-side logic into a single side-parameterized superset — without regressions —
as an intermediate step toward a fully refactored indicator.

## 2. Where things stand (the headline)

**The optimization milestone is reached, a direction is chosen, and the canonical source is
merged to `main`.** The fully-symmetric **`RSIZoneSymLo`** variant (both sides unified onto the
*low-side* peak-price structure) is the **adopted canonical** form. It is saved in the TradingView
cloud (`RSIZoneSymLo` v2.0), its source is committed on `main`, and a fresh, both-polarities
baseline is frozen for regression testing.

**Done (2026-08-12, second session):** `feat/pine-save-bind-17` merged to `main` (`8bd6843`) and
the merged SymLo source **re-verified against the frozen 30m baseline** — 58/58 signals identical
(27 LOW / 31 HIGH), 8968/8968 shared bars, max plot drift 0. The committed file reproduces the
regression gate byte-for-byte.

**What is NOT done:** the next phase — the "deeper refactor" SymLo was an intermediate toward —
has not started.

## 3. The optimization arc (how we got here)

| Stage | Version | Result | Notes |
|-------|---------|--------|-------|
| Original | `RSIZoneDiv` v28 (v5) | baseline | `scripts/current.pine` on main; frozen as `reference/rszonediv_backup.pine` |
| v6 conversion | built-in converter | regression (2/3) | lazy-eval + `bool na` drift |
| v6 fix | `rszonediv_v6fix.pine` | **3/3 green** | hoisted stateful `mint1.*()` calls out of conditionals (root cause) |
| UDT mirror-collapse | `rszonediv_collapsed.pine` | **failed** | `var` UDT `[1]` field history is not series history → abandoned |
| Unification (regression-preserving) | `rszonediv_unified.pine` ("340-unified") | 3/3 green | side-parameterized helpers; kept high-side `pph_con_b` quirk verbatim |
| Symmetric A/B (behavior-normalizing) | `rszonediv_sym_lo.pine` / `rszonediv_sym_hi.pine` | measured | both-polarities UKOIL 5m window arbitrated |
| **Adopted** | **`RSIZoneSymLo`** (low-side structure, both sides) | **canonical** | see §4 rationale |

Key process lesson baked into the notes: the UDT collapse *compiled clean* but dropped all
signals — only a frozen baseline + signal-set diff caught it. Never trust "it compiled."

## 4. Why SymLo (the measured decision)

Full-depth UKOIL 5m window (3717 bars, both polarities present):

| Side | baseline (unified) | SymLo | SymHi |
|------|--------------------|-------|-------|
| LOW (11) | 11 | **identical** | identical |
| HIGH (12) | 12 | **11** (drops `2026-07-23 18:15`) | 12 (identical) |

- SymLo's **low side = baseline 11/11** → adopting it costs nothing on the already-correct side.
- Its **stricter high side** (11 vs 12) comes from the low-side `f_price_rcap` range-established
  gate (`isWFall and prevRp > 1`) + `zcapChange` topk — the *intended* normalization, not a bug.
- SymHi was the alternative (high-side structure both ways); kept for provenance, now superseded.

## 5. Current artifacts — what lives where

### Repo: main code repo, branch `main` (pushed, `8bd6843`) — **canonical sources now on main**
- `scripts/current.pine` — original `RSIZoneDiv` v28 (v5).
- `scripts/rszonediv_sym_lo.pine` — **adopted SymLo** (386 lines, header `350-symLo`). **Merged.**
- `scripts/rszonediv_sym_hi.pine` — superseded SymHi (390 lines, header `351-symHi`).
- `scripts/rszonediv_unified.pine` — 340-unified baseline.
- `scripts/rszonediv_v6fix.pine`, `rszonediv_collapsed.pine`, `rszonediv_debug.pine`,
  `rszonediv_step1.pine`, `udt_hist_probe.pine` — provenance intermediates (kept per `04` §8).
- `scripts/reference/rszones_v1.pine` — **pinned** published `theansweris42/RSIZones/1` source
  (467 lines). Closes the dependency-freeze gap. Fetch method = the published-scope workaround
  cited in open issue #12.
- `scripts/reference/rszonediv_*_ukoil_5m_{500,zoom,full}.{json,csv}` — 5m discrimination set.
- `scripts/reference/rszonediv_{v6,unified,sym_lo}_4d_300.{json,csv}` — 4d/300 reference captures.
- `scripts/reference/rszonediv_sym_lo_ukoil_30m_baseline.{json,csv}` — **canonical regression
  gate** (8968 bars, 2025-10-29→2026-08-12, 27 LOW / 31 HIGH). Re-verified against merged source.

### Historical: branch `feat/pine-save-bind-17` (**merged** into main @ `8bd6843`)
- Carried the SymLo/SymHi/unified sources and provenance intermediates; all now on `main`.
- The `pine_bind` / buffer-aware `pine_save` tooling landed earlier via PR #18.

### Repo: `.engineering`, branch `engineering` (pushed, `7a3c26e`)
- `artifacts/planning/2026-08-12-tradingview-mcp-pine-debug-principles/` — the notes + `data/`.

### TradingView cloud (account `theansweris42`)
- `RSIZoneSymLo` v2.0 — adopted, saved clean.
- `RSIZoneDivUni` v2.0 — unified baseline.
- `RSIZoneSymHi` v2.0 — superseded, **still in account** (no headless delete; issue #19).
- `RSIZones` published lib v1.0 — the shared dependency (`PUB;75ceaefbe37b4aebb688a4859aebf0fb`).

## 6. The deterministic debug loop (use this — do not reinvent)

```
edit source (file)
→ pine_bind(script_id)                       # headless: bind buffer↔identity
→ pine_set_source → pine_save                # buffer-aware; check persisted_matches_buffer
→ study_add_pine(script_id) → entity_id      # headless add, no dialog
→ data_get_study_series(entity_id, count)    # unambiguous read
→ diff signal sets vs baseline               # scripts/capture_study_series.mjs + diff_study_series.mjs
```

**Capture-depth gotcha (important):** the capture reads the *latest* N bars of loaded history,
clamped to `TV_MAX_BARS` (default 500) or per-call `max_bars`. To capture a full zoomed-out
window pass a raised cap (e.g. `TV_MAX_BARS=9000`) ≥ `total_available`. **Always confirm both
signal polarities are present in the window before concluding equivalence** — a 500-bar UKOIL 5m
slice had 0 LOW and made all three variants look vacuously identical (see `02` §7 / `05` P7-P8).

## 7. Open issues (tooling gaps that shaped the loop)

- **#17** — headless Pine save/register (no non-DOM create/persist). The remaining DOM dependency.
- **#19** — headless Pine delete (new; raised this session). Why cloud `RSIZoneSymHi` still exists.
- **#12** — `pine_read_script` published scope. The RSIZones pin used a `ui_evaluate` workaround.
- **#13** — tab-targeted reads (`tv_attach` + `target` param).
- **#9** — capture-loop tooling / regression harness.

## 8. Next steps (candidate resume points)

1. ~~**Merge the canonical source.**~~ **Done (2026-08-12):** `feat/pine-save-bind-17` merged to
   `main` @ `8bd6843`; SymLo, SymHi, unified, and all provenance intermediates now live on `main`
   alongside the regression gate.
2. ~~**Freeze the loop on SymLo.**~~ **Done (2026-08-12):** re-captured the 30m series from the
   merged source (entity `va74LI`, `TV_MAX_BARS=9000`) and diffed vs the frozen baseline —
   58/58 signals identical, 8968/8968 shared bars, max plot drift 0. Paper trail verified.
3. **The deeper refactor** SymLo was an intermediate toward — now that both sides share one
   side-parameterized chain, the structure is ready for a true library-generic rewrite (the
   original "library-generic rewrite" goal deferred when the verbatim UDT collapse failed).
   **This is the next real work.**
4. **Optional tooling:** implement #12 (published-scope read) so future dependency pins don't
   need the `ui_evaluate` workaround; #17/#19 to close the headless lifecycle.

## 9. Quick-start for the next chat

```
# Confirm state
git -C /home/mike1/projects/dev/tradingview-mcp branch --show-current      # main
git -C /home/mike1/projects/dev/tradingview-mcp/.engineering branch --show-current  # engineering

# Canonical SymLo source: now on main
git -C /home/mike1/projects/dev/tradingview-mcp show main:scripts/rszonediv_sym_lo.pine

# Regression gate: scripts/reference/rszonediv_sym_lo_ukoil_30m_baseline.json (main)
# Reference chart: TVC:UKOIL 30m (entity va74LI in the 2026-08-12 session — re-derive after restart, never cache entity IDs)
```

**First decision to ask the user:** begin the deeper library-generic refactor (step 3), or close
out the optional tooling gaps (#12 / #17 / #19) first?
