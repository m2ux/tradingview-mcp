import { z } from 'zod';
import { jsonResult, errorResult } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server) {
  server.tool('capture_screenshot', 'Take a screenshot of the TradingView chart', {
    region: z.string().optional().describe('Region to capture: full, chart, strategy_tester (default full)'),
    filename: z.string().optional().describe('Custom filename (without extension)'),
    method: z.string().optional().describe('Capture method: cdp (Page.captureScreenshot) or api (chartWidgetCollection.takeScreenshot) (default cdp)'),
    wait_for_render: z.boolean().optional().describe('Wait for the chart canvas to stabilize before capturing. Use after chart_set_symbol or chart_set_timeframe to avoid stale frames. Soft-timeout: still captures if stabilize budget expires.'),
    stabilize_ms: z.coerce.number().optional().describe('Max ms to wait for canvas stability when wait_for_render is true (default 3000). Shorter budgets avoid MCP timeouts.'),
    target: z.string().optional().describe('Target tab: chart_id, URL substring, CDP target id, or a saved LAYOUT/tab name (e.g. "OIL_IG"; use "layout:<name>" to force layout-name matching). Screenshot requires the composited Desktop tab (shell .tab.active); a background guest has no bitmap. If this tab is in the background the tool focuses it first. Omit to capture the current shell-active tab. Names come from tab_list (layout_name). If the response has "retryable": true, TradingView is momentarily busy — wait ~1s and retry.'),
  }, async ({ region, filename, method, wait_for_render, stabilize_ms, target }) => {
    try {
      return jsonResult(await core.captureScreenshot({
        region, filename, method, waitForRender: wait_for_render, stabilize_ms, target,
      }));
    } catch (err) { return errorResult(err); }
  });

  server.tool('capture_snapshot', 'Capture a full snapshot of the currently displayed chart, headlessly: visible time & price range, OHLCV over the visible bars, active studies (with per-bar series aligned to the visible window), user drawings, Pine graphics (lines/labels/tables/boxes), and a screenshot. One call instead of the multi-tool "Analyze my chart" sequence.', {
    region: z.string().optional().describe('Screenshot region: full, chart, strategy_tester (default chart)'),
    filename: z.string().optional().describe('Custom screenshot filename (without extension)'),
    include_series: z.coerce.boolean().optional().describe('Include per-bar study series aligned to the visible range (default true). Set false for a compact snapshot (current values + levels only).'),
    include_screenshot: z.coerce.boolean().optional().describe('Capture a screenshot and include its file_path (default true)'),
    wait_for_render: z.boolean().optional().describe('Wait for the chart canvas to stabilize before the screenshot (default false). Use after chart_set_symbol/timeframe to avoid a stale frame.'),
    stabilize_ms: z.coerce.number().optional().describe('Max ms to wait for canvas stability when wait_for_render is true (default 3000)'),
    target: z.string().optional().describe('Target tab: chart_id, URL substring, CDP target id, or a saved LAYOUT/tab name (e.g. "OIL_IG"; use "layout:<name>" to force layout-name matching). Chart reads are headless. The screenshot (when include_screenshot is true) requires the composited Desktop tab and will focus it if it is in the background. Omit to snapshot the current shell-active tab. Names come from tab_list (layout_name). If the response has "retryable": true, TradingView is momentarily busy — wait ~1s and retry.'),
  }, async ({ region, filename, include_series, include_screenshot, wait_for_render, stabilize_ms, target }) => {
    try {
      return jsonResult(await core.captureSnapshot({
        region, filename, include_series, include_screenshot, wait_for_render, stabilize_ms, target,
      }));
    } catch (err) { return errorResult(err); }
  });
}
