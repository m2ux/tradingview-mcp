import CDP from 'chrome-remote-interface';
import { tvError } from './core/err.js';

let client = null;
let targetInfo = null;
// Overridable via TV_CDP_HOST/TV_CDP_PORT (or CDP_HOST/CDP_PORT) env vars.
// Default is 127.0.0.1, not localhost: on some Windows machines localhost
// resolves to ::1 first, and Electron's --remote-debugging-port only listens on IPv4.
export const CDP_HOST = process.env.TV_CDP_HOST || process.env.CDP_HOST || '127.0.0.1';
export const CDP_PORT = Number(process.env.TV_CDP_PORT || process.env.CDP_PORT) || 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;
// CDP calls can hang forever (wedged electron page, IPv6 localhost falling back
// to IPv4, single-WS-per-target contention). Bound every network call so the
// server surfaces a clear, retryable error instead of stalling.
const CDP_CALL_TIMEOUT_MS = Number(process.env.TV_CDP_TIMEOUT_MS) || 10000;

/**
 * Race `promise` against a timeout that rejects with a transient CDP error.
 * The timer is unref'd and cleared on settle so it never keeps the event loop
 * alive or fires after the call already resolved.
 */
export function withTimeout(promise, ms = CDP_CALL_TIMEOUT_MS, label = 'CDP call') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error(`${label} timed out after ${ms}ms`),
      { retryable: true, code: 'TV_CDP_TIMEOUT' }
    )), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
      // Quick liveness check — bounded so a silently dead socket triggers
      // reconnect instead of returning a wedged client.
      await withTimeout(
        client.Runtime.evaluate({ expression: '1', returnByValue: true }),
        3000,
        'CDP liveness probe'
      );
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
        throw targetId
          ? tvError('TV_TARGET_NOT_FOUND', `CDP target ${targetId} not found — is the tab still open?`, {
            resolution: { by: 'target_id', ref: targetId },
            hint: 'The referenced tab is gone. Call tab_list to enumerate open tabs and re-target by chart_id or layout name.',
          })
          : tvError('TV_NO_CHART_TAB', 'No TradingView chart target found. Is TradingView open with a chart?', {
            hint: 'TradingView is reachable but no chart tab is open. Open one with tab_new({ layout: "new" }) or tab_new({ layout: "<saved name>" }), then retry.',
          });
      }
      targetInfo = target;
      client = await withTimeout(
        CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id }),
        CDP_CALL_TIMEOUT_MS,
        'CDP connect'
      );

      // Enable required domains
      await withTimeout(client.Runtime.enable(), CDP_CALL_TIMEOUT_MS, 'CDP Runtime.enable');
      await withTimeout(client.Page.enable(), CDP_CALL_TIMEOUT_MS, 'CDP Page.enable');
      await withTimeout(client.DOM.enable(), CDP_CALL_TIMEOUT_MS, 'CDP DOM.enable');

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw tvError('TV_NOT_CONNECTED', `CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`, {
    hint: 'TradingView Desktop is not reachable on the CDP endpoint. Launch it with tv_launch, or start it with --remote-debugging-port=9222, then retry.',
  });
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
 * Prefix used to force target resolution by saved-layout name:
 * `layout:OIL_IG` matches only by layout name (never by chart_id / URL).
 */
export const LAYOUT_TARGET_PREFIX = 'layout:';

// Read a chart tab's live per-tab state (symbol, resolution, layout name).
// Runs in that tab's own page context so the values are always live, never
// the cached values getSavedCharts() can return for a layout.
//
// Desktop 3.3+ dropped `_chartWidgetCollection.currentChart()`. The layout
// name now lives on `_loadChartService._state.chartList[]` keyed by chart_id
// (`url`). Keep the currentChart() path as a fallback for older builds.
const TAB_PROBE_JS = `(function() {
  var out = { symbol: null, resolution: null, layout_name: null };
  try {
    var root = window.TradingViewApi || {};
    var chart = root._activeChartWidgetWV && root._activeChartWidgetWV.value
      ? root._activeChartWidgetWV.value() : null;
    if (chart) {
      try { out.symbol = chart.symbol(); } catch (e) {}
      try { out.resolution = chart.resolution(); } catch (e) {}
    }
    var col = root._chartWidgetCollection;
    if (col && typeof col.currentChart === 'function') {
      var meta = null;
      try { meta = col.currentChart(); } catch (e) {}
      if (meta) {
        var ln = meta.name || (meta.metaInfo && (meta.metaInfo.name || meta.metaInfo.title)) || null;
        if (ln) out.layout_name = ln;
      }
    }
    if (!out.layout_name) {
      var id = (location.pathname.split('/chart/')[1] || '').split('/')[0];
      var load = root._loadChartService;
      var state = load && load._state && typeof load._state.value === 'function' ? load._state.value() : null;
      var list = state && state.chartList;
      if (id && Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].url === id && list[i].name) { out.layout_name = list[i].name; break; }
        }
      }
    }
  } catch (e) {}
  return out;
})()`;

// One evaluate, all open/recent chart_id → layout name. Shared by tab_list
// and findTargetByRef so we do not open a scoped socket per tab.
const LAYOUT_MAP_JS = `(function() {
  try {
    var load = window.TradingViewApi && window.TradingViewApi._loadChartService;
    var state = load && load._state && typeof load._state.value === 'function' ? load._state.value() : null;
    var list = state && state.chartList;
    if (!Array.isArray(list)) return null;
    var out = {};
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (row && row.url && row.name) out[String(row.url)] = String(row.name);
    }
    return out;
  } catch (e) { return null; }
})()`;

let _layoutNameCache = { at: 0, map: null, targets: null };
const LAYOUT_NAME_TTL_MS = 2000;

/** Pure lookup used by tests and getLayoutNameForTarget. */
export function layoutNameFromChartList(chartList, chartId) {
  if (!Array.isArray(chartList) || !chartId) return null;
  const row = chartList.find((c) => c && String(c.url) === String(chartId));
  return row?.name || null;
}

function _clearLayoutNameCache() {
  _layoutNameCache = { at: 0, map: null, targets: null };
}

async function _ensureLayoutNameCache() {
  const now = Date.now();
  if (_layoutNameCache.map && (now - _layoutNameCache.at) < LAYOUT_NAME_TTL_MS) {
    return _layoutNameCache;
  }
  const targets = await listTargets();
  const charts = targets.filter((t) => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url || ''));
  let map = {};
  for (const chart of charts.slice(0, 3)) {
    let c = null;
    try {
      c = await makeScopedClient(chart);
      const { result } = await c.Runtime.evaluate({ expression: LAYOUT_MAP_JS, returnByValue: true });
      if (result?.value && typeof result.value === 'object') {
        map = result.value;
        if (Object.keys(map).length) break;
      }
    } catch {
      /* try the next chart tab */
    }
  }
  _layoutNameCache = { at: now, map, targets };
  return _layoutNameCache;
}

/**
 * Best-effort live layout name for a chart target id. Never throws — returns
 * null when the layout name cannot be read. Used to enrich tab_list rows.
 */
export async function getLayoutNameForTarget(targetId, _probe) {
  const probe = _probe || getLayoutNameForTarget._probe;
  if (probe) {
    try { return (await probe(targetId)) || null; } catch { return null; }
  }
  try {
    const { map, targets } = await _ensureLayoutNameCache();
    const t = (targets || []).find((x) => x.id === targetId);
    const chartId = t?.url?.match(/\/chart\/([^/?]+)/)?.[1];
    if (chartId && map && map[chartId]) return map[chartId];
  } catch {
    /* degrade to per-tab probe */
  }

  // Per-tab fallback (currentChart() on older Desktop, or in-page chartList).
  const timeoutMs = getLayoutNameForTarget._timeoutMs ?? 1500;
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('layout-name probe timed out')), timeoutMs)
  );
  try {
    return await Promise.race([
      (async () => {
        const c = await makeScopedClient(targetId);
        const { result } = await c.Runtime.evaluate({ expression: TAB_PROBE_JS, returnByValue: true });
        return result?.value?.layout_name || null;
      })(),
      timeout,
    ]);
  } catch {
    return null;
  }
}

/**
 * Resolve a `target` reference to a CDP page target. Resolution order:
 *   1. `layout:<name>`  — strip the prefix and match by saved-layout name only
 *   2. CDP target id
 *   3. chart_id (the /chart/<id> URL segment)
 *   4. URL substring
 *   5. layout/tab name — exact (case-insensitive) then substring, matched
 *      against each chart tab's live layout name and cleaned page title
 * Only TradingView chart pages are considered for chart_id/URL/name matching.
 * Throws when nothing matches — callers surface this as a clear tool error.
 */
export async function findTargetByRef(ref) {
  if (!ref) return null;
  const wanted = String(ref);
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page');
  const charts = pages.filter(t => /tradingview\.com\/chart/i.test(t.url || ''));

  // Forced layout-name resolution.
  const forceLayout = wanted.toLowerCase().startsWith(LAYOUT_TARGET_PREFIX);
  const nameWanted = forceLayout ? wanted.slice(LAYOUT_TARGET_PREFIX.length) : null;

  if (!forceLayout) {
    const byId = pages.find(t => t.id === wanted);
    if (byId) return byId;
    const byChart = charts.find(t => (t.url.match(/\/chart\/([^/?]+)/)?.[1]) === wanted)
      || charts.find(t => (t.url || '').includes(wanted));
    if (byChart) return byChart;
  }

  // Layout-name / tab-title resolution.
  const q = (nameWanted ?? wanted).toLowerCase();
  const titled = [];
  for (const t of charts) {
    const layout_name = await getLayoutNameForTarget(t.id);
    let title = (t.title || '').replace(/^Live stock.*charts on /i, '');
    // The probe returns null when a second CDP client can't attach (e.g. the
    // shared MCP client already holds this tab) — in that case fall back to the
    // page title, which on TradingView is the layout/tab name (e.g. "OIL_IG").
    // Try attaching our own title probe when the page title is empty.
    if (!title.trim() && !layout_name) {
      title = await getLayoutNameForTarget(t.id) || title;
    }
    titled.push({ target: t, layout_name, title });
  }
  const norm = (s) => (s || '').trim().toLowerCase();
  // When a layout name was read it is authoritative; otherwise the cleaned
  // page title is the resolving identity.
  const keyOf = (x) => norm(x.layout_name) || norm(x.title);
  const exact = titled.find(x => keyOf(x) === q);
  if (exact) return exact.target;
  const sub = titled.find(x => keyOf(x).includes(q) && q.length > 0);
  if (sub) return sub.target;

  if (forceLayout) {
    throw tvError('TV_TAB_NOT_OPEN', `No open chart tab showing layout "${nameWanted}".`, {
      resolution: { by: 'layout', name: nameWanted },
      hint: `The layout is saved but not open in any tab. Open it with tab_new({ layout: "${nameWanted}" }) — that tool drives the layout picker and is NOT headless — then retry this call with target: "${nameWanted}".`,
    });
  }
  throw tvError('TV_TARGET_NOT_FOUND', `No open chart tab matches target "${wanted}". Use tab_list to see chart_ids and layout names.`, {
    resolution: { by: 'target', ref: wanted },
    hint: 'If you meant a saved layout that is not currently open, open it first with tab_new({ layout: "<name>" }) then target it by name.',
  });
}

/**
 * True when an error looks like TradingView's CDP endpoint transiently closing
 * a scoped socket (or refusing a second concurrent client on a chart the
 * shared client already holds) — i.e. "service busy, retry", not a real failure.
 */
export function isTransientCdpError(e) {
  if (e?.code === 'TV_CDP_TIMEOUT' || e?.code === 'TV_CDP_BUSY') return true;
  return /WebSocket is not open|readyState|CLOSED|Target closed|Connection closed|fetch failed|ECONNRESET|EPIPE|timed out/i.test(e?.message || '');
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
  const { timeoutMs, ...evalOpts } = opts;
  const result = await withTimeout(
    c.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: evalOpts.awaitPromise ?? false,
      ...evalOpts,
    }),
    timeoutMs ?? CDP_CALL_TIMEOUT_MS,
    'CDP evaluate'
  );
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
  _clearLayoutNameCache();
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
