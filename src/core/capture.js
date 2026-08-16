/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection, findTargetByRef, makeScopedClient, evictScopedClient } from '../connection.js';
import { captureScreenshot as _capture } from './protocol.js';
import { waitForChartRender } from '../wait.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');

export async function captureScreenshot({
  region, filename, method, waitForRender = false, stabilize_ms, target, _deps,
} = {}) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // When a target tab is given, run against a dedicated connection to that tab
  // (clip bounds evaluate + Page.captureScreenshot) instead of the shared client.
  // _deps.makeScopedClient lets tests substitute a stub CDP connection.
  const scopedFactory = _deps?.makeScopedClient || makeScopedClient;
  const targetInfo = target ? await findTargetByRef(target) : null;
  let scopedClient = null;
  // Lazily connected on first use so the no-target path never opens a socket.
  const ensureScoped = async () => {
    if (!scopedClient) scopedClient = await scopedFactory(targetInfo.id);
    return scopedClient;
  };
  const evalFn = target
    ? async (expr) => {
      const c = await ensureScoped();
      const { result } = await c.Runtime.evaluate({ expression: expr, returnByValue: true });
      return result?.value;
    }
    : evaluate;

  let renderStabilized = null;
  if (waitForRender) {
    // Softer default budget (3s) so MCP clients don't hit -32001; override via stabilize_ms
    const budget = typeof stabilize_ms === 'number' && stabilize_ms >= 0 ? stabilize_ms : 3000;
    renderStabilized = await waitForChartRender(budget, evalFn);
    // Proceed even on timeout — better a slightly stale frame than a hard tool failure
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = (filename || `tv_${region || 'full'}_${ts}`).replace(/[\/\\]/g, '_').replace(/\.\./g, '_');
  const filePath = join(SCREENSHOT_DIR, `${fname}.png`);

  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      await evalFn(`${colPath}.takeScreenshot()`);
      return {
        success: true, method: 'api', waited_for_render: !!waitForRender,
        render_stabilized: renderStabilized,
        note: 'takeScreenshot() triggered — TradingView will save/show the screenshot via its own UI',
      };
    } catch {
      // Fall through to CDP method
    }
  }

  let client;
  try {
    client = target ? await ensureScoped() : await getClient();
    let clip = undefined;

    if (region === 'chart') {
      const bounds = await evalFn(`
        (function() {
          var el = document.querySelector('[data-name="pane-canvas"]')
            || document.querySelector('[class*="chart-container"]')
            || document.querySelector('canvas');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `);
      if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
    } else if (region === 'strategy_tester') {
      const bounds = await evalFn(`
        (function() {
          var el = document.querySelector('[data-name="backtesting"]')
            || document.querySelector('[class*="strategyReport"]');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `);
      if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
    }

    const params = { format: 'png' };
    if (clip) params.clip = clip;

    const { data } = await _capture(client, params);
    writeFileSync(filePath, Buffer.from(data, 'base64'));

    return {
      success: true, method: 'cdp', file_path: filePath, region,
      ...(targetInfo && { target: target, chart_id: targetInfo.url.match(/\/chart\/([^/?]+)/)?.[1] || null }),
      waited_for_render: !!waitForRender,
      render_stabilized: renderStabilized,
      size_bytes: Buffer.from(data, 'base64').length,
    };
  } finally {
    if (scopedClient) { evictScopedClient(targetInfo.id); try { await scopedClient.close(); } catch { /* already gone */ } }
  }
}
