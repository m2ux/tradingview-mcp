/**
 * CDP protocol helpers — the single designated module for Page.* and
 * Input.* calls. Domain modules (dom, ui, capture, batch) consume
 * these helpers instead of issuing raw CDP domain calls themselves.
 *
 * Each helper takes a CDP `client` (obtained via getClient() or the scoped-
 * client factory) plus the call-specific params, so callers control the
 * connection lifecycle.
 */
import { withTimeout } from '../connection.js';

export async function captureScreenshot(client, params = {}) {
  // Hidden TradingView chart guests (non-active Desktop tabs) never return
  // from Page.captureScreenshot. Bound the call so MCP sees TV_CDP_TIMEOUT
  // instead of hanging until the client -32001.
  const { timeoutMs, ...rest } = params;
  const ms = typeof timeoutMs === 'number' ? timeoutMs : undefined;
  return withTimeout(client.Page.captureScreenshot(rest), ms, 'Page.captureScreenshot');
}

export async function dispatchMouse(client, ...events) {
  for (const ev of events) {
    await client.Input.dispatchMouseEvent(ev);
  }
}

export async function dispatchKey(client, params) {
  await client.Input.dispatchKeyEvent(params);
}

export async function insertText(client, text) {
  await client.Input.insertText({ text });
}
