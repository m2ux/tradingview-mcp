import { z } from 'zod';
import { jsonResult, errorResult } from './_format.js';
import * as core from '../core/data.js';

// Optional tab selector shared by the read tools: a chart_id, URL substring, or
// CDP target id. When given, the read runs against that tab without switching
// the MCP's active tab; when omitted, the attached tab is read.
const targetParam = z.string().optional().describe('Target tab: chart_id, URL substring, or CDP target id (from tab_list). Reads run against this tab without switching the active tab. Omit for the attached tab. If the response has "retryable": true, TradingView is momentarily busy — wait ~1s and retry the same call.');

// Exact-study selector shared by the study read tools. Disambiguates when two
// of the same study are on the chart (name-substring match is non-deterministic
// there — first match wins). When given, entity_id wins over study/study_filter.
const entityIdParam = z.string().optional().describe('Exact study entity ID (from chart_get_state / study_add). Disambiguates duplicate studies; when given it overrides study/study_filter name matching.');

export function registerDataTools(server) {
  server.tool('data_get_ohlcv', 'Get OHLCV bar data from the chart. Use summary=true for compact stats instead of all bars (saves context).', {
    count: z.coerce.number().optional().describe('Number of bars to retrieve (default 100).'),
    max_bars: z.coerce.number().optional().describe('Per-call ceiling for count (default 500, or TV_MAX_BARS). Raise to fetch deeper history.'),
    summary: z.coerce.boolean().optional().describe('Return summary stats (high, low, open, close, avg volume, range) instead of all bars — much smaller output'),
    target: targetParam,
  }, async ({ count, summary, max_bars, target }) => {
    try { return jsonResult(await core.getOhlcv({ count, summary, max_bars, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('data_get_indicator', 'Get indicator/study info and input values', {
    entity_id: z.string().describe('Study entity ID (from chart_get_state)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getIndicator({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_strategy_results', 'Get strategy performance metrics from Strategy Tester. Auto-opens the panel and auto-unhides a hidden strategy (TradingView never computes reports for hidden strategies); result includes unhidden_strategies when that happened.', {}, async () => {
    try { return jsonResult(await core.getStrategyResults()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_trades', 'Get trade list from Strategy Tester. Auto-opens the panel and auto-unhides a hidden strategy.', {
    max_trades: z.coerce.number().optional().describe('Maximum trades to return'),
  }, async ({ max_trades }) => {
    try { return jsonResult(await core.getTrades({ max_trades })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_equity', 'Get equity curve data from Strategy Tester', {}, async () => {
    try { return jsonResult(await core.getEquity()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('quote_get', 'Get real-time quote data for a symbol (price, OHLC, volume). If symbol is provided and differs from the current chart, the chart is briefly switched to fetch the quote and then restored — adds ~1-2s and serializes parallel calls.', {
    symbol: z.string().optional().describe('Symbol to quote (blank = current chart symbol). Non-blank values cause a chart switch + restore.'),
    target: targetParam,
  }, async ({ symbol, target }) => {
    try { return jsonResult(await core.getQuote({ symbol, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('depth_get', 'Get order book / DOM (Depth of Market) data from the chart', {}, async () => {
    try { return jsonResult(await core.getDepth()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'Open the DOM panel in TradingView before using this tool.' }, true); }
  });

  server.tool('data_get_pine_lines', 'Read horizontal price levels drawn by Pine Script indicators (line.new). Returns deduplicated price levels per study. Use study_filter or entity_id to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "Profiler", "NY Levels"). Omit for all.'),
    entity_id: entityIdParam,
    verbose: z.coerce.boolean().optional().describe('Return raw line data with IDs, coordinates, colors (default false — returns only unique price levels)'),
    target: targetParam,
  }, async ({ study_filter, entity_id, verbose, target }) => {
    try { return jsonResult(await core.getPineLines({ study_filter, entity_id, verbose, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('data_get_pine_labels', 'Read text labels drawn by Pine Script indicators (label.new). Returns text and price pairs. Use study_filter or entity_id to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    entity_id: entityIdParam,
    max_labels: z.coerce.number().optional().describe('Max labels per study (default 50). Set higher if you need all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw label data with IDs, colors, positions (default false — returns only text + price)'),
    target: targetParam,
  }, async ({ study_filter, entity_id, max_labels, verbose, target }) => {
    try { return jsonResult(await core.getPineLabels({ study_filter, entity_id, max_labels, verbose, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('data_get_pine_tables', 'Read table data drawn by Pine Script indicators (table.new). Returns formatted text rows per table. Use study_filter or entity_id to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    entity_id: entityIdParam,
    target: targetParam,
  }, async ({ study_filter, entity_id, target }) => {
    try { return jsonResult(await core.getPineTables({ study_filter, entity_id, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('data_get_pine_boxes', 'Read box/zone boundaries drawn by Pine Script indicators (box.new). Returns deduplicated {high, low} price zones. Use study_filter or entity_id to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    entity_id: entityIdParam,
    verbose: z.coerce.boolean().optional().describe('Return all boxes with IDs and coordinates (default false — returns unique price zones)'),
    target: targetParam,
  }, async ({ study_filter, entity_id, verbose, target }) => {
    try { return jsonResult(await core.getPineBoxes({ study_filter, entity_id, verbose, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('data_get_study_values', 'Get current indicator values from the data window for all visible studies (RSI, MACD, Bollinger Bands, EMAs, custom indicators with plot()). Pass entity_id to read just one study.', {
    entity_id: entityIdParam,
    target: targetParam,
  }, async ({ entity_id, target }) => {
    try { return jsonResult(await core.getStudyValues({ entity_id, target })); }
    catch (err) { return errorResult(err); }
  });

  server.tool('data_get_study_series', 'Get historical per-bar plot series for one study (aligned with OHLC optionally). Reads the in-memory computed series — no replay loop. Use summary=true for compact per-plot stats. Pass entity_id to disambiguate duplicate studies (name substring is first-match).', {
    study: z.string().optional().describe('Substring matched against study description (e.g., "RSI", "Profiler"). Omit = first study on chart. Ignored when entity_id is given.'),
    entity_id: entityIdParam,
    count: z.coerce.number().optional().describe('Number of most-recent bars (default 100).'),
    max_bars: z.coerce.number().optional().describe('Per-call ceiling for count (default 500, or TV_MAX_BARS). Raise to align depth with a deep price fetch.'),
    plots: z.array(z.string()).optional().describe('Plot IDs to include (e.g., ["plot_0"]). Omit = all plots.'),
    include_price: z.coerce.boolean().optional().describe('Also return OHLCV aligned by time (default false)'),
    summary: z.coerce.boolean().optional().describe('Return only {min,max,last,non_null_count} per plot instead of bars (default false)'),
    target: targetParam,
  }, async ({ study, entity_id, count, plots, include_price, summary, max_bars, target }) => {
    try { return jsonResult(await core.getStudySeries({ study, entity_id, count, plots, include_price, summary, max_bars, target })); }
    catch (err) { return errorResult(err); }
  });
}
