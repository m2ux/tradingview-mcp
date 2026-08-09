import { z } from 'zod';
import { jsonResult } from './_format.js';
import { requestUiEvaluateApproval } from './ui_evaluate_approval.js';
import * as core from '../core/ui.js';

export function registerUiTools(server) {
  server.tool('ui_click', 'Click a UI element by aria-label, data-name, text content, or class substring. Set trusted=true to escalate to a trusted CDP click when a synthetic click is ignored (React handlers that disregard untrusted events).', {
    by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
    value: z.string().describe('Value to match against the chosen selector strategy'),
    trusted: z.coerce.boolean().optional().describe('Escalate to a trusted CDP click if the synthetic click does not activate the control (default false)'),
  }, async ({ by, value, trusted }) => {
    try { return jsonResult(await core.click({ by, value, trusted })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_set_input', 'Set a React-controlled input/textarea value (bypasses the value tracker so React registers it). Resolves the input by placeholder/aria-label/name regex.', {
    value: z.string().describe('Text to set'),
    match: z.string().optional().describe('Regex matched against placeholder/aria-label/name (default: name|script|title|search|description)'),
    within_dialog: z.coerce.boolean().optional().describe('Scope to the open dialog (default true)'),
  }, async ({ value, match, within_dialog }) => {
    try { return jsonResult(await core.setInput({ value, match, within_dialog })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_wait_for', 'Poll a page-context expression until it returns truthy or times out. Use instead of fixed sleeps to wait for UI state.', {
    expression: z.string().describe('JS expression that evaluates truthy when the desired state is reached'),
    timeout_ms: z.coerce.number().optional().describe('Max wait in ms (default 5000)'),
    interval_ms: z.coerce.number().optional().describe('Poll interval in ms (default 150)'),
  }, async ({ expression, timeout_ms, interval_ms }) => {
    try { return jsonResult(await core.waitFor({ expression, timeout_ms, interval_ms })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_fiber_action', 'Invoke a component\'s own action handler (e.g. onClick) by walking the React fiber chain of a resolved element. Reliable when raw DOM gestures are swallowed. Gated behind TV_ALLOW_DANGEROUS=1.', {
    by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
    value: z.string().describe('Value to match'),
    prop: z.string().optional().describe('memoizedProps handler name to invoke (default "onClick")'),
    args: z.array(z.any()).optional().describe('Arguments to pass to the handler'),
  }, async ({ by, value, prop, args }) => {
    try { return jsonResult(await core.fiberAction({ by, value, prop, args })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('net_request', 'Authenticated page-context fetch — bypass DOM driving where a backend endpoint exists (e.g. pine-facade REST). Runs fetch() in the page with session cookies. https: only. Gated behind TV_ALLOW_DANGEROUS=1.', {
    url: z.string().describe('Absolute https: URL to request'),
    method: z.string().optional().describe('HTTP method (default GET)'),
    body: z.string().optional().describe('Request body (for POST/PUT)'),
    headers: z.record(z.string()).optional().describe('Extra request headers'),
    timeout_ms: z.coerce.number().optional().describe('Timeout in ms (default 8000)'),
  }, async ({ url, method, body, headers, timeout_ms }) => {
    try { return jsonResult(await core.netRequest({ url, method, body, headers, timeout_ms })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_open_panel', 'Open, close, or toggle TradingView panels (pine-editor, strategy-tester, watchlist, alerts, trading)', {
    panel: z.enum(['pine-editor', 'strategy-tester', 'watchlist', 'alerts', 'trading']).describe('Panel name'),
    action: z.enum(['open', 'close', 'toggle']).describe('Action to perform'),
  }, async ({ panel, action }) => {
    try { return jsonResult(await core.openPanel({ panel, action })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_fullscreen', 'Toggle TradingView fullscreen mode', {}, async () => {
    try { return jsonResult(await core.fullscreen()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('layout_list', 'List saved chart layouts', {}, async () => {
    try { return jsonResult(await core.layoutList()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('layout_switch', 'Switch to a saved chart layout by name or ID', {
    name: z.string().describe('Name or ID of the layout to switch to'),
  }, async ({ name }) => {
    try { return jsonResult(await core.layoutSwitch({ name })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_keyboard', 'Press keyboard keys or shortcuts (e.g., Enter, Escape, Alt+S, Ctrl+Z)', {
    key: z.string().describe('Key to press (e.g., "Enter", "Escape", "Tab", "a", "ArrowUp")'),
    modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'meta'])).optional().describe('Modifier keys to hold (e.g., ["ctrl", "shift"])'),
  }, async ({ key, modifiers }) => {
    try { return jsonResult(await core.keyboard({ key, modifiers })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_type_text', 'Type text into the currently focused input/textarea element', {
    text: z.string().describe('Text to type into the focused element'),
  }, async ({ text }) => {
    try { return jsonResult(await core.typeText({ text })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_hover', 'Hover over a UI element by aria-label, data-name, or text content', {
    by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
    value: z.string().describe('Value to match'),
  }, async ({ by, value }) => {
    try { return jsonResult(await core.hover({ by, value })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_scroll', 'Scroll the chart or page up/down/left/right', {
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
    amount: z.coerce.number().optional().describe('Scroll amount in pixels (default 300)'),
  }, async ({ direction, amount }) => {
    try { return jsonResult(await core.scroll({ direction, amount })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_mouse_click', 'Click at specific x,y coordinates on the TradingView window', {
    x: z.coerce.number().describe('X coordinate (pixels from left)'),
    y: z.coerce.number().describe('Y coordinate (pixels from top)'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default left)'),
    double_click: z.coerce.boolean().optional().describe('Double click (default false)'),
  }, async ({ x, y, button, double_click }) => {
    try { return jsonResult(await core.mouseClick({ x, y, button, double_click })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_find_element', 'Find UI elements by text, aria-label, or CSS selector and return their positions', {
    query: z.string().describe('Text content, aria-label value, or CSS selector to search for'),
    strategy: z.enum(['text', 'aria-label', 'css']).optional().describe('Search strategy (default: text)'),
  }, async ({ query, strategy }) => {
    try { return jsonResult(await core.findElement({ query, strategy })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  // Restored from PR #1 removal: registers only with TV_ALLOW_UI_EVALUATE=1,
  // and each invocation elicits an explicit human approval before Runtime.evaluate.
  server.tool(
    'ui_evaluate',
    'Execute JavaScript in the TradingView page context. Requires TV_ALLOW_UI_EVALUATE=1 and a manual human approval on every call (MCP elicitation). Prefer discrete tools when one exists.',
    {
      expression: z.string().describe('JavaScript expression to evaluate in the page context. Wrap in IIFE for complex logic.'),
    },
    {
      title: 'Evaluate page JavaScript',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
    async ({ expression }) => {
      try {
        const decision = await requestUiEvaluateApproval({
          elicitor: server.server,
          expression,
        });
        if (!decision.approved) {
          return jsonResult({ success: false, error: decision.reason || 'ui_evaluate not approved' }, true);
        }
        return jsonResult(await core.uiEvaluate({ expression }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
