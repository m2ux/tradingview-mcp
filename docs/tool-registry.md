# Tool Registry — TradingView MCP

> plain-language guide to every operation · 2026-08-08 · audience: users and engineers
> Companion to [architecture.md](architecture.md). That doc explains the layers; this one explains what the agent can actually *do*.

## How To Read This

The registry is the menu of named operations an agent (via MCP) or a person (via the `tv` CLI) can call. It is **curated, not generated**: each tool wraps one or more of TradingView's internal, undocumented APIs into a single task-shaped operation. There is no public TradingView API being mirrored — the tools line up with what TradingView can *do*, not with any official endpoint list.

Each tool below gives three things in plain language: **what it offers**, and **its limitations** — the practical edges you will hit.

**A note on availability.** 82 tools are always on (including `ui_evaluate`). Five **power tools** are gated off by default and only appear when the operator sets `TV_ALLOW_DANGEROUS=1`: `tv_update`, `tv_launch`, `alert_delete`, `draw_clear`, `batch_run`. Gated tools are marked **🔒 gated** below.

---

## Chart

Read and control the chart itself — symbol, timeframe, type, and view.

### `chart_get_state`
- **Offers:** The chart's identity in one call — symbol, timeframe, chart type, and every indicator with its entity IDs.
- **Limitations:** A snapshot, not live; call again after you change something. Entity IDs are per-session — don't reuse them across reconnects.

### `chart_set_symbol`
- **Offers:** Switch the chart to any ticker TradingView knows (`AAPL`, `BTCUSD`, `ES1!`, `NYMEX:CL1!`).
- **Limitations:** Only exact symbols resolve; if you're unsure of the ticker, run `symbol_search` first.

### `chart_set_timeframe`
- **Offers:** Change resolution — minutes (`1`,`5`,`15`,`60`), or `D`/`W`/`M`.
- **Limitations:** Only resolutions TradingView offers; exotic intervals may be rejected. The current symbol's data governs what's available.

### `chart_set_type`
- **Offers:** Switch chart style — Candles, Line, Area, Renko, Kagi, HeikinAshi, and more (by name or number).
- **Limitations:** Types that need special data (Renko, P&F) can behave differently on thin symbols.

### `chart_manage_indicator`
- **Offers:** Add or remove a study.
- **Limitations:** Needs the **full indicator name** ("Relative Strength Index", not "RSI"). For search-by-name adds, prefer `indicator_add`.

### `chart_get_visible_range` / `chart_set_visible_range`
- **Offers:** Read the visible date/bar window, or zoom to an exact unix-timestamp range.
- **Limitations:** Uses unix seconds; out-of-data ranges clamp to whatever bars exist.

### `chart_scroll_to_date`
- **Offers:** Center the view on a date (ISO format, `2025-01-15`).
- **Limitations:** Can't center on a date with no bars; it lands on the nearest available.

### `symbol_info`
- **Offers:** Rich metadata on the current symbol — name, exchange, type, description.
- **Limitations:** Current chart symbol only; doesn't take an argument.

### `symbol_search`
- **Offers:** Find tickers by name or keyword.
- **Limitations:** Returns TradingView's search ranking; the symbol you want may not be first.

---

## Data

Prices, indicators, strategy results, and the drawings your Pine scripts make.

### `data_get_ohlcv`
- **Offers:** OHLCV bars; `summary=true` gives compact stats instead of every bar.
- **Limitations:** Capped at 500 bars per call. Use `summary=true` by default to save context.

### `quote_get`
- **Offers:** Real-time quote — price, OHLC, volume.
- **Limitations:** Quoting a symbol *other* than the current chart briefly switches the chart and restores it (~1–2s, serializes parallel calls).

### `depth_get`
- **Offers:** Order book / DOM data.
- **Limitations:** Only where the symbol and your TradingView plan actually provide depth.

### `data_get_study_values`
- **Offers:** Current values from all visible indicators (RSI, MACD, BB, EMAs, custom `plot()`s).
- **Limitations:** Visible studies only; hidden studies don't report.

### `data_get_indicator`
- **Offers:** Info and input values for a study.
- **Limitations:** Protected/encrypted indicators return encoded blobs — use `data_get_study_values` for their numbers instead.

### `data_get_strategy_results` / `data_get_trades` / `data_get_equity`
- **Offers:** Strategy Tester metrics, trade list, and equity curve.
- **Limitations:** Auto-opens the panel and unhides a hidden strategy (TradingView won't compute reports for hidden ones). Requires a strategy on the chart.

### `data_get_pine_lines` / `data_get_pine_labels` / `data_get_pine_tables` / `data_get_pine_boxes`
- **Offers:** Read what custom Pine indicators draw — price levels, text labels, table rows, zones (`line.new`/`label.new`/`table.new`/`box.new`). Use `study_filter` to target one indicator.
- **Limitations:** The indicator must be **visible** on the chart. Labels are capped (default 50 per study, `max_labels` to override).

---

## Pine Script

Develop, compile, and debug Pine in the editor.

### `pine_get_source` / `pine_set_source`
- **Offers:** Read the editor's code, or inject new code.
- **Limitations:** `pine_get_source` can return 200KB+ on big scripts — avoid unless you're editing.

### `pine_compile` / `pine_smart_compile`
- **Offers:** Add the script to the chart; `smart_compile` detects the button, compiles, checks errors, reports study changes.
- **Limitations:** Acts on the open editor and current chart; a broken script surfaces as compile errors, not exceptions.

### `pine_get_errors` / `pine_get_console`
- **Offers:** Compile errors (Monaco markers) and log output (`log.info()`, errors).
- **Limitations:** Reflects the current editor state — read these after a compile.

### `pine_save` / `pine_new` / `pine_open` / `pine_list_scripts`
- **Offers:** Save to your TradingView cloud, create blank scripts, open/list saved ones.
- **Limitations:** Operates on *your* saved scripts; open needs the exact name.

### `pine_analyze`
- **Offers:** Offline static analysis — array out-of-bounds, unguarded `first()/last()`, bad loop bounds, implicit bool casts. No TradingView connection needed.
- **Limitations:** Static checks only; it doesn't compile or catch runtime errors.

### `pine_check`
- **Offers:** Server-side compile via TradingView's facade.
- **Limitations:** **Uploads your Pine source to TradingView.** Gated behind `TV_ALLOW_PINE_CHECK_UPLOAD=1`; prefer offline `pine_analyze` for proprietary code.

---

## Replay

Practice trading against historical bars.

### `replay_start` / `replay_stop`
- **Offers:** Enter replay (optionally at a date), and exit back to realtime.
- **Limitations:** One replay session at a time; availability depends on symbol/plan.

### `replay_step` / `replay_autoplay`
- **Offers:** Advance one bar, or auto-advance at a set speed (ms).
- **Limitations:** Only while replay is active.

### `replay_trade`
- **Offers:** Paper-trade — buy, sell, close.
- **Limitations:** Replay-only; this is not live trading and touches no broker.

### `replay_status`
- **Offers:** Position, P&L, current replay date.
- **Limitations:** Only meaningful during a replay.

---

## UI

Drive the app's interface when there's no dedicated tool.

### `ui_click` / `ui_hover` / `ui_find_element`
- **Offers:** Interact by aria-label, data-name, text, or class; find elements and their positions.
- **Limitations:** CSS-selector queries are validated to block injection; text/aria selectors are safer. UI text changes between TradingView versions can break a selector.

### `ui_open_panel`
- **Offers:** Open/close/toggle panels — pine-editor, strategy-tester, watchlist, alerts, trading.
- **Limitations:** Known panel names only.

### `ui_keyboard` / `ui_type_text`
- **Offers:** Key presses/shortcuts and typing into the focused input.
- **Limitations:** Goes to whatever has focus; if focus is wrong, keystrokes land in the wrong place.

### `ui_scroll` / `ui_mouse_click`
- **Offers:** Scroll the chart/page; click at exact x/y.
- **Limitations:** Raw coordinate clicks are brittle against layout/DPI changes — prefer `ui_click` by label.

### `ui_evaluate`
- **Offers:** Run arbitrary JavaScript in the TradingView page context for advanced automation.
- **Limitations:** Full page-session power — prefer a discrete tool when one exists. Expression results must be serializable over CDP.

### `ui_fullscreen`
- **Offers:** Toggle fullscreen.
- **Limitations:** Pure view state.

### `layout_list` / `layout_switch`
- **Offers:** List saved layouts; switch by name or ID.
- **Limitations:** Only your saved layouts.

---

## System

The server and the TradingView process itself.

### `tv_health_check`
- **Offers:** CDP connection status plus current chart state.
- **Limitations:** Read-only; safe to call any time.

### `tv_discover`
- **Offers:** Which known TradingView API paths are available and their methods.
- **Limitations:** A probe report — availability varies by TradingView version.

### `tv_ui_state`
- **Offers:** Which panels are open, which buttons are visible/enabled.
- **Limitations:** Reflects current UI only.

### `tv_launch` — 🔒 gated
- **Offers:** Launch TradingView Desktop with CDP enabled; auto-detects Mac/Windows/Linux, including Store/MSIX installs (falls back to a local package copy if needed).
- **Limitations:** Why gated — it spawns/kills processes. `kill_existing` defaults off; killing matches the exact executable path by PID. The MSIX fallback copies ~330MB once, so first launch can take a minute.

### `tv_update` — 🔒 gated
- **Offers:** Update this MCP server — verified git fast-forward of origin/main + `npm ci` when deps change.
- **Limitations:** Heavily guarded. Needs `TV_ALLOW_DANGEROUS=1` to register and `TV_UPDATE_TOKEN` to run; fetches only from allowlisted origins, fast-forwards only to a GPG-signed tag or a pinned SHA, refuses on dirty trees/non-main/diverged history, and `npm ci` failure is fatal. A server restart is required afterward.

---

## Alerts

### `alert_create` / `alert_list`
- **Offers:** Create a price alert on the current symbol; list active alerts.
- **Limitations:** Current chart symbol for create; list reflects TradingView's alert store.

### `alert_delete` — 🔒 gated
- **Offers:** Delete one alert by id, or all active alerts.
- **Limitations:** Why gated — deletion is irreversible. "All" really means all.

---

## Drawing

### `draw_shape`
- **Offers:** Draw horizontal lines, trend lines, rectangles, text.
- **Limitations:** Coordinates are chart price/time points; off-screen shapes still exist even if not visible.

### `draw_list` / `draw_get_properties` / `draw_remove_one`
- **Offers:** List drawings with entity IDs, inspect one, remove one by ID.
- **Limitations:** Removal needs the entity ID from `draw_list`.

### `draw_clear` — 🔒 gated
- **Offers:** Remove every drawing on the chart.
- **Limitations:** Why gated — it wipes all drawings irreversibly.

---

## Capture

### `capture_screenshot`
- **Offers:** Screenshot a region — `full`, `chart`, `strategy_tester`.
- **Limitations:** Saves a file and returns its path (not image bytes). Often the cheapest way to get visual context instead of pulling large datasets.

---

## Indicators

### `indicator_add`
- **Offers:** Search the Indicators dialog and add by name — works for strategies and community scripts too. Returns the new study's entity_id.
- **Limitations:** Name must match a searchable result.

### `indicator_set_inputs`
- **Offers:** Change a study's inputs (length, source, period, …).
- **Limitations:** Needs the study's entity/id and valid input names; protected scripts may not expose inputs.

### `indicator_toggle_visibility`
- **Offers:** Show or hide a study.
- **Limitations:** View state only; hidden studies stop reporting values.

### `indicator_search`
- **Offers:** Search available indicators.
- **Limitations:** Returns TradingView's search results.

---

## Watchlist

### `watchlist_get`
- **Offers:** All symbols in the current watchlist with last price, change, change%.
- **Limitations:** The active watchlist only.

### `watchlist_add` / `watchlist_add_bulk` / `watchlist_remove`
- **Offers:** Add one, add many, or remove symbols.
- **Limitations:** Symbols must resolve; removal matches by symbol.

---

## Pane

### `pane_list` / `pane_focus` / `pane_set_symbol`
- **Offers:** List panes and symbols, focus one by index, set a pane's symbol.
- **Limitations:** 0-based indexes; only panes in the current layout.

### `pane_set_layout`
- **Offers:** Change the grid — single, 2x2, 2h, 3v, and more.
- **Limitations:** Only TradingView's supported layouts.

---

## Tab

### `tab_list` / `tab_new` / `tab_close` / `tab_switch`
- **Offers:** List tabs, open a new one (optionally with a layout), close the current, switch by index.
- **Limitations:** `tab_close` acts on the *current* tab; `tab_switch` uses 0-based index.

### `layout_new`
- **Offers:** Create a named blank layout in a new tab.
- **Limitations:** Creates empty layouts only.

---

## Batch

### `batch_run` — 🔒 gated
- **Offers:** Run one action (screenshot, get OHLCV, …) across many symbols/timeframes in one call.
- **Limitations:** Why gated — it fans out into many operations, amplifying cost and side effects. Each action still obeys its own limits (bar caps, and so on).
