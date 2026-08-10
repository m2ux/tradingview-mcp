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
    target: z.string().optional().describe('Target tab: chart_id, URL substring, or CDP target id (from tab_list). Captures this tab without switching the active tab. Omit for the attached tab. If the response has "retryable": true, TradingView is momentarily busy — wait ~1s and retry.'),
  }, async ({ region, filename, method, wait_for_render, stabilize_ms, target }) => {
    try {
      return jsonResult(await core.captureScreenshot({
        region, filename, method, waitForRender: wait_for_render, stabilize_ms, target,
      }));
    } catch (err) { return errorResult(err); }
  });
}
