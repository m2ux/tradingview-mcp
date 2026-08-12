# TradingView MCP — Claude Instructions

87 tools by default (94 with TV_ALLOW_DANGEROUS=1) for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "Give me an indicator's history"
- `data_get_study_series` with `study: "<name>"` → per-bar plot series for one study (no replay loop); `include_price: true` aligns OHLC by time, `summary: true` returns compact per-plot stats

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_open` → open by registered identity (Open dialog); never treat Monaco inject as open
2. `pine_copy` / `pine_save_as` → registered copy for publishable scripts (not orphan facade save/new)
3. `pine_set_source` → inject code (pass `script_name` to refuse wrong header identity)
4. `pine_save` → save to TradingView cloud and verify against the buffer's script (flags `bound_mismatch` on the unbound-editor trap); if `verified:false` or `bound_mismatch`, run `pine_bind` first
4b. `pine_bind` → fetch a saved script's facade source into the buffer and confirm the match — establishes the binding `pine_save` verifies against
5. `pine_add_to_chart` → add open script to chart (prefer over `indicator_add` for fresh My scripts)
6. `pine_publish` → publish library/script; returns pubId + version for `import user/Lib/N`
7. `pine_smart_compile` → compile + check errors (`import_errors` for unpublished imports)
8. `pine_list_scripts` → list with `ui_visible` / `published_version` (orphan detection)
9. `indicator_get_inputs` → align `in_*` inputs before visual verify
10. `pine_get_errors` / `pine_get_console` → compilation errors and log.info()
11. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
12. `pine_new` → blank template only (does not register cloud identity)
13. `pine_read_script` → read a saved script's source by name/id **without opening it** (no editor/dialog side effects); prefer over `pine_open` + `pine_get_source` for read-only access to a dependency

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage drawing templates"
Saved style templates for a drawing tool (Fib Channel, parallel channel, etc.):
1. `draw_template_list` with `drawing_type: "fibonacci channel"` → template names (omit type to list aliases)
2. `draw_template_get` with `drawing_type` + `name` → native content object
3. `draw_template_save` with `drawing_type` + `name` + `content` and/or `from_template` (clone then deep-merge) → create/overwrite in TradingView cloud

Use friendly types (`fibonacci channel`, `parallel channel`, `trend line`) or raw `LineTool*` ids.

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `ui_evaluate` → run arbitrary JavaScript in the page context (prefer discrete tools when one exists)
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "Work across multiple tabs"
- `tab_list` → list open chart tabs (gives chart_id for each)
- `tab_switch` → switch the active tab by index (moves UI focus + re-attaches)
- `tv_attach` → attach the CDP client to a chart by `chart_id`/URL substring **without UI focus** (reaches background tabs); also the reconnect path when `tv_health_check` reports "Not connected"
- Read tools (`chart_get_state`, `quote_get`, `data_get_ohlcv`, `data_get_study_values`, `data_get_study_series`, `data_get_pine_*`, `capture_screenshot`) accept an optional `target` (chart_id / URL substring) → read that tab **without** switching the active tab

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working (if "Not connected", use `tv_attach` to re-attach)

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`
