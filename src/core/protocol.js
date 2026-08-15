/**
 * CDP protocol helpers — the single designated module for Page.*, Input.*,
 * and Emulation.* calls. Domain modules (dom, ui, capture, batch) consume
 * these helpers instead of issuing raw CDP domain calls themselves.
 *
 * Each helper takes a CDP `client` (obtained via getClient() or the scoped-
 * client factory) plus the call-specific params, so callers control the
 * connection lifecycle.
 */

export async function captureScreenshot(client, params = {}) {
  return client.Page.captureScreenshot(params);
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
