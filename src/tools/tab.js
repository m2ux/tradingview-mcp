import { z } from 'zod';
import { jsonResult, errorResult } from './_format.js';
import * as core from '../core/tab.js';
import { attachChart } from '../connection.js';

export function registerTabTools(server) {
  server.tool('tab_list', 'List all open TradingView chart tabs', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_attach', 'Attach the shared CDP client to a chart by chart_id, URL substring, or target id — without requiring the tab to become visible (unlike tab_switch). Also use to reconnect after tv_health_check reports "Not connected". Reads then follow the attached tab. On failure check the "retryable" field: if true, TradingView is momentarily busy — wait ~1s and retry rather than treating it as fatal.', {
    chart_id: z.string().describe('chart_id (the /chart/<id> URL segment), URL substring, or CDP target id. Use tab_list to see chart_ids.'),
  }, async ({ chart_id }) => {
    try {
      const info = await attachChart(chart_id);
      return jsonResult({ success: true, ...info });
    }
    catch (err) { return errorResult(err); }
  });

  server.tool('tab_new', 'Open a new chart tab. Optionally pick what to load in it: layout "new" creates a named blank layout, or pass a saved layout name to open it.', {
    layout: z.string().optional().describe('"new" for a blank new layout, or a saved layout name (substring match). Omit to leave the tab on the layout picker.'),
    name: z.string().optional().describe('Name for the new layout (used with layout: "new"; default "New layout")'),
  }, async ({ layout, name }) => {
    try { return jsonResult(await core.newTab({ layout, name })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('layout_new', 'Create a new named blank chart layout (opens in a new tab)', {
    name: z.string().optional().describe('Layout name (default "New layout")'),
  }, async ({ name }) => {
    try { return jsonResult(await core.newTab({ layout: 'new', name })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_close', 'Close the current chart tab', {}, async () => {
    try { return jsonResult(await core.closeTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_switch', 'Switch to a chart tab by index', {
    index: z.coerce.number().describe('Tab index (0-based, from tab_list)'),
  }, async ({ index }) => {
    try { return jsonResult(await core.switchTab({ index })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
