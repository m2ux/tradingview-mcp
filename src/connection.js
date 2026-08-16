import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
// Overridable via TV_CDP_HOST/TV_CDP_PORT (or CDP_HOST/CDP_PORT) env vars.
// Default is 127.0.0.1, not localhost: on some Windows machines localhost
// resolves to ::1 first, and Electron's --remote-debugging-port only listens on IPv4.
export const CDP_HOST = process.env.TV_CDP_HOST || process.env.CDP_HOST || '127.0.0.1';
export const CDP_PORT = Number(process.env.TV_CDP_PORT || process.env.CDP_PORT) || 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

/**
 * A non-loopback CDP endpoint exposes an authenticated TradingView session
 * to whatever lives on that host/network — refuse unless the operator has
 * explicitly opted in with TV_ALLOW_REMOTE_CDP=1.
 */
export function assertLoopbackHost(host = CDP_HOST, env = process.env) {
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'];
  if (!loopback.includes(host) && env.TV_ALLOW_REMOTE_CDP !== '1') {
    throw new Error(
      `CDP host "${host}" is not loopback. Remote CDP exposes your TradingView session to the network; ` +
      'set TV_ALLOW_REMOTE_CDP=1 on the server process if you really intend this.',
    );
  }
}

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

export async function getClient() {
  assertLoopbackHost();
  if (client) {
    try {
      // Quick liveness check
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect(targetId = null) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = targetId ? await findTargetById(targetId) : await findChartTarget();
      if (!target) {
        throw new Error(targetId
          ? `CDP target ${targetId} not found — is the tab still open?`
          : 'No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Re-attach the cached CDP client to a specific target id.
 * Used by tab_switch so subsequent reads (chart_get_state, data_get_*,
 * quote_get, screenshots) follow the activated tab instead of staying
 * glued to the target picked at first connect.
 */
export async function reconnectTo(targetId) {
  if (client) {
    try { await client.close(); } catch { /* already gone */ }
    client = null;
    targetInfo = null;
  }
  return connect(targetId);
}

/**
 * Fetch all CDP page targets from `/json/list`. Single transport-owned
 * path — finders and tab.js route through here rather than each issuing
 * their own `fetch` against the HTTP endpoint.
 */
export async function listTargets() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  return resp.json();
}

async function findChartTarget() {
  const targets = await listTargets();
  // Prefer targets with tradingview.com/chart in the URL
  return targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url))
    || null;
}

async function findTargetById(id) {
  const targets = await listTargets();
  return targets.find(t => t.id === id) || null;
}

/**
 * Resolve a `target` reference to a CDP page target. Accepts a CDP target id,
 * a chart_id (the /chart/<id> URL segment), or a URL substring, in that order.
 * Only TradingView chart pages are considered for chart_id/URL matching.
 * Throws when nothing matches — callers surface this as a clear tool error.
 */
export async function findTargetByRef(ref) {
  if (!ref) return null;
  const wanted = String(ref);
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page');
  const byId = pages.find(t => t.id === wanted);
  if (byId) return byId;
  const charts = pages.filter(t => /tradingview\.com\/chart/i.test(t.url || ''));
  return charts.find(t => (t.url.match(/\/chart\/([^/?]+)/)?.[1]) === wanted)
    || charts.find(t => (t.url || '').includes(wanted))
    || (() => { throw new Error(`No open chart tab matches target "${wanted}". Use tab_list to see chart_ids.`); })();
}

/**
 * True when an error looks like TradingView's CDP endpoint transiently closing
 * a scoped socket (or refusing a second concurrent client on a chart the
 * shared client already holds) — i.e. "service busy, retry", not a real failure.
 */
export function isTransientCdpError(e) {
  return /WebSocket is not open|readyState|CLOSED|Target closed|Connection closed|fetch failed|ECONNRESET|EPIPE/i.test(e?.message || '');
}

// ─── Scoped-client factory + pool ────────────────────────────────────
const SCOPED_POOL_SIZE = 8;
// LRU-8 default — proven sizing against the same CDP endpoint (RUDE-labs
// sibling design). Tunable via TV_CDP_POOL_SIZE for operators who hit a
// different wedge threshold.
const scopedPool = new Map();
let scopedPoolSize = Number(process.env.TV_CDP_POOL_SIZE) || SCOPED_POOL_SIZE;

async function _makeScopedClientRaw(targetInfo) {
  const c = await CDP({ host: CDP_HOST, port: CDP_PORT, target: targetInfo.id ?? targetInfo });
  await c.Runtime.enable();
  await c.Page.enable();
  await c.DOM.enable();
  return c;
}

function _evictScoped(key) {
  const entry = scopedPool.get(key);
  if (!entry) return;
  scopedPool.delete(key);
  try { entry.client.close?.(); } catch { /* already gone */ }
}

/**
 * Drop a target's pooled client without closing it. Callers that close a
 * scoped client themselves call this first so the pool never retains a
 * reference to a socket it no longer controls.
 */
export function evictScopedClient(targetInfo) {
  const id = targetInfo.id ?? targetInfo;
  scopedPool.delete(id);
}

// A pooled client is reusable only while its socket is open. chrome-remote-interface
// exposes readyState on the client; 1 (OPEN) means live. Anything else is stale.
function _isLive(client) {
  try {
    const rs = client?.readyState ?? client?._ws?.readyState;
    return rs === undefined || rs === 1;
  } catch {
    return false;
  }
}

async function _pruneScopedPool() {
  while (scopedPool.size > scopedPoolSize) {
    // Map preserves insertion order — the first entry is the least-recently-used.
    const oldest = scopedPool.keys().next().value;
    _evictScoped(oldest);
  }
}

/**
 * Transport-owned scoped-client factory. Opens (or reuses from the LRU pool)
 * a CDP client for a specific target. Borrowers should NOT close the client —
 * the pool evicts on LRU overflow or drainScopedPool() at disconnect.
 */
export async function makeScopedClient(targetInfo, opts = {}) {
  const id = targetInfo.id ?? targetInfo;
  if (scopedPool.has(id)) {
    const entry = scopedPool.get(id);
    if (_isLive(entry.client)) {
      // LRU refresh: delete + re-insert moves it to the end (most-recently-used).
      scopedPool.delete(id);
      scopedPool.set(id, entry);
      return entry.client;
    }
    // Stale entry (socket closed outside the pool) — drop it and open fresh.
    scopedPool.delete(id);
  }
  const client = await _makeScopedClientRaw(targetInfo);
  scopedPool.set(id, { client });
  await _pruneScopedPool();
  return client;
}

/**
 * Close all pooled scoped clients and clear the pool. Used on disconnect.
 */
export async function drainScopedPool() {
  for (const [, entry] of scopedPool) {
    try { await entry.client.close(); } catch { /* already gone */ }
  }
  scopedPool.clear();
}

/**
 * Run fn with an evaluate helper attached to a specific chart target,
 * independent of the shared cached client. Reads use this to aim at a
 * background tab without switching the MCP's active tab. The scoped client
 * is always closed afterward. Rejects page JS exceptions like evaluate().
 *
 * TradingView's CDP endpoint occasionally closes a freshly-opened scoped
 * socket (readyState CLOSED) when the shared dev-tools endpoint is busy — a
 * transient race, not a real failure. Retry a few times with backoff before
 * giving up. When it still fails after retries, the error is marked
 * `retryable: true` so callers (and the tool layer) can tell the agent to
 * adopt a wait/retry strategy rather than treating it as fatal.
 */
export async function withTargetEvaluate(ref, fn) {
  const target = await findTargetByRef(ref);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    let c = null;
    try {
      c = await makeScopedClient(target);
      const scoped = async (expression, opts = {}) => {
        const result = await c.Runtime.evaluate({
          expression,
          returnByValue: true,
          awaitPromise: opts.awaitPromise ?? false,
          ...opts,
        });
        if (result.exceptionDetails) {
          const msg = result.exceptionDetails.exception?.description
            || result.exceptionDetails.text
            || 'Unknown evaluation error';
          throw new Error(`JS evaluation error: ${msg}`);
        }
        return result.result?.value;
      };
      return await fn(scoped, target);
    } catch (e) {
      lastError = e;
      if (!isTransientCdpError(e) || attempt === 3) {
        if (isTransientCdpError(e)) {
          const err = new Error(`TradingView CDP endpoint is busy (target "${ref}" could not be reached after several attempts). ${e.message}`);
          err.retryable = true;
          err.code = 'TV_CDP_BUSY';
          throw err;
        }
        throw e;
      }
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    } finally {
      if (c) { evictScopedClient(target); try { await c.close(); } catch { /* already gone */ } }
    }
  }
  throw lastError;
}

/**
 * Attach the shared CDP client to a chart by target ref (target id, chart_id,
 * or URL substring). Unlike tab_switch this does not require the tab to become
 * visible, so it can reach background tabs — and it doubles as the reconnect
 * path after a dropped connection. Returns the resolved target info.
 */
export async function attachChart(ref) {
  const target = await findTargetByRef(ref);
  if (!target) throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
  await reconnectTo(target.id);
  return {
    target_id: target.id,
    chart_id: target.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
    url: target.url,
    title: target.title,
  };
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
  await drainScopedPool();
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
