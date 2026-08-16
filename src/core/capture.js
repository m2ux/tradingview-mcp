/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection, findTargetByRef, withTargetEvaluate, makeScopedClient, evictScopedClient } from '../connection.js';
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

// Round to 8 dp to kill float noise without flattening sub-cent prices (#77).
const _round = (v) => (v == null || typeof v !== 'number' || !isFinite(v) ? null : Math.round(v * 1e8) / 1e8);

// Page-side reader for the whole snapshot. Runs as ONE evaluate() so all
// sub-reads see a single consistent chart moment. Everything is wrapped in
// try/catch so a missing API degrades a section to null instead of failing
// the whole snapshot. Bar windows are derived from the visible time range
// (chart.getVisibleRange → {from,to} unix seconds), and the visible price
// range is the high/low envelope over those same bars.
const SNAPSHOT_READ_JS = `
  (function() {
    var out = {};
    var chart = window.TradingViewApi._activeChartWidgetWV.value();
    try {
      out.symbol = chart.symbol();
      out.resolution = chart.resolution();
      out.chart_type = chart.chartType();
    } catch (e) {}

    var vr = null, from = null, to = null;
    try {
      vr = chart.getVisibleRange();
      if (vr) { from = vr.from; to = vr.to; }
    } catch (e) {}
    out.visible_range = (from != null && to != null) ? { from: from, to: to } : null;

    var bars = null;
    try { bars = chart._chartWidget.model().mainSeries().bars(); } catch (e) {}

    var ohlcv = [];
    var hi = null, lo = null;
    if (bars && typeof bars.lastIndex === 'function') {
      try {
        var end = bars.lastIndex();
        var start = bars.firstIndex();
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (!v) continue;
          var t = v[0];
          if (from != null && t < from) continue;
          if (to != null && t > to) continue;
          ohlcv.push({ time: t, open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 });
          if (hi == null || v[2] > hi) hi = v[2];
          if (lo == null || v[3] < lo) lo = v[3];
        }
      } catch (e) {}
    }
    out.ohlcv = ohlcv;
    out.price_range = (hi != null && lo != null) ? { high: hi, low: lo } : null;

    var studies = [];
    try {
      var all = chart.getAllStudies();
      for (var si = 0; si < all.length; si++) {
        studies.push({ id: all[si].id, name: all[si].name || all[si].title || 'unknown' });
      }
    } catch (e) {}
    out.studies = studies;

    var drawings = [];
    try {
      var shapes = chart.getAllShapes();
      for (var di = 0; di < shapes.length; di++) {
        drawings.push({ id: shapes[di].id, name: shapes[di].name });
      }
    } catch (e) {}
    out.drawings = drawings;

    return out;
  })()
`;

// Per-study plot series, aligned to the visible time window. Reuses the
// in-memory plot-row list (s._data._items) like data_get_study_series, but
// filtered to [from,to] and flattened to {time, plots{pid:val}} rows.
const STUDY_SERIES_JS = (from, to) => `
  (function() {
    var from = ${from == null ? 'null' : from};
    var to = ${to == null ? 'null' : to};
    var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
    var sources = chart.model().model().dataSources();
    var results = [];
    for (var si = 0; si < sources.length; si++) {
      var s = sources[si];
      if (!s.metaInfo) continue;
      try {
        var meta = s.metaInfo();
        var name = meta.description || meta.shortDescription || '';
        if (!name) continue;
        var plotMeta = meta.plots || [];
        var plotIds = [];
        for (var pi = 0; pi < plotMeta.length; pi++) plotIds.push(plotMeta[pi].id);
        var id = null;
        try { id = s.id ? s.id() : null; } catch (e) {}
        var items = (s._data && s._data._items) ? s._data._items : [];
        var rows = [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it || !it.value) continue;
          var t = it.value[0];
          if (from != null && t < from) continue;
          if (to != null && t > to) continue;
          var plots = {};
          for (var vi = 0; vi < plotIds.length; vi++) {
            var raw = it.value[vi + 1];
            plots[plotIds[vi]] = (typeof raw === 'number' && isFinite(raw)) ? raw : null;
          }
          rows.push({ time: t, plots: plots });
        }
        if (rows.length > 0) results.push({ id: id, name: name, plot_ids: plotIds, bars: rows });
      } catch (e) {}
    }
    return results;
  })()
`;

// Pine graphics (line.new/label.new/table.new/box.new) for every study that
// drew any. Mirrors buildGraphicsJS but collects all four collections in one
// pass so the snapshot does a single evaluate instead of four.
const PINE_GRAPHICS_JS = `
  (function() {
    var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
    var sources = chart.model().model().dataSources();
    function collect(pc, collName, mapKey) {
      var items = [];
      try {
        var outer = pc[collName];
        if (outer) {
          var inner = outer.get(mapKey);
          if (inner) {
            var coll = inner.get(false);
            if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
              coll._primitivesDataById.forEach(function(v, id) { items.push(v); });
            }
          }
        }
      } catch (e) {}
      return items;
    }
    var out = { lines: [], labels: [], tables: [], boxes: [] };
    for (var si = 0; si < sources.length; si++) {
      var s = sources[si];
      if (!s.metaInfo) continue;
      try {
        var meta = s.metaInfo();
        var name = meta.description || meta.shortDescription || '';
        if (!name) continue;
        var g = s._graphics;
        if (!g || !g._primitivesCollection) continue;
        var pc = g._primitivesCollection;
        var i;
        var lines = collect(pc, 'dwglines', 'lines');
        for (i = 0; i < lines.length; i++) { var L = lines[i]; if (L.y1 != null && L.y1 === L.y2) out.lines.push({ study: name, price: L.y1 }); }
        var labels = collect(pc, 'dwglabels', 'labels');
        for (i = 0; i < labels.length; i++) { var b = labels[i]; out.labels.push({ study: name, text: b.t || '', price: (b.y != null ? b.y : null) }); }
        var cells = collect(pc, 'dwgtablecells', 'tableCells');
        var tables = {};
        for (i = 0; i < cells.length; i++) {
          var c = cells[i]; var tid = c.tid || 0;
          if (!tables[tid]) tables[tid] = {};
          if (!tables[tid][c.row]) tables[tid][c.row] = {};
          tables[tid][c.row][c.col] = c.t || '';
        }
        for (var tk in tables) {
          var rows = tables[tk]; var rowNums = Object.keys(rows).map(Number).sort(function(a, b) { return a - b; });
          var formatted = [];
          for (i = 0; i < rowNums.length; i++) {
            var cols = rows[rowNums[i]]; var colNums = Object.keys(cols).map(Number).sort(function(a, b) { return a - b; });
            var line = colNums.map(function(cn) { return cols[cn]; }).filter(Boolean).join(' | ');
            if (line) formatted.push(line);
          }
          if (formatted.length) out.tables.push({ study: name, rows: formatted });
        }
        var boxes = collect(pc, 'dwgboxes', 'boxes');
        for (i = 0; i < boxes.length; i++) {
          var bx = boxes[i];
          if (bx.y1 != null && bx.y2 != null) out.boxes.push({ study: name, high: Math.max(bx.y1, bx.y2), low: Math.min(bx.y1, bx.y2) });
        }
      } catch (e) {}
    }
    return out;
  })()
`;

/**
 * Capture a full snapshot of the currently displayed chart: visible time &
 * price range, OHLCV over the visible bars, active studies (with per-bar
 * series aligned to the visible window), user drawings, Pine graphics, and a
 * screenshot. Runs headlessly against the chart model — no DOM/dialogs.
 *
 * Options:
 *   region        screenshot region: full | chart | strategy_tester (default chart)
 *   filename      custom screenshot filename (without extension)
 *   include_series  include per-bar study series (default true)
 *   include_screenshot  capture a screenshot (default true)
 *   wait_for_render  stabilize the canvas before the screenshot (default false)
 *   stabilize_ms   canvas-stability budget when wait_for_render (default 3000)
 *   target         chart_id / URL substring / CDP target id — read this tab
 *                  without switching the active tab
 */
export async function captureSnapshot({
  region = 'chart', filename, include_series = true, include_screenshot = true,
  wait_for_render = false, stabilize_ms, target, _deps,
} = {}) {
  // Read path: injected test evaluate wins, then a target-scoped evaluate,
  // then the shared attached-tab evaluate. withTargetEvaluate closes its
  // scoped socket per call, so resolve to a per-call executor, not a bare fn.
  const evalFn = _deps?.evaluate
    || (target ? (expr, opts) => withTargetEvaluate(target, (ev) => ev(expr, opts)) : evaluate);

  const base = await evalFn(SNAPSHOT_READ_JS);
  if (!base) throw new Error('Could not read chart state. The chart may still be loading.');

  const from = base.visible_range?.from ?? null;
  const to = base.visible_range?.to ?? null;

  let study_series = null;
  if (include_series) {
    const rawSeries = await evalFn(STUDY_SERIES_JS(from, to));
    study_series = (rawSeries || []).map(s => ({
      id: s.id,
      name: s.name,
      plot_ids: s.plot_ids,
      bar_count: s.bars.length,
      bars: s.bars.map(b => {
        const plots = {};
        for (const pid of s.plot_ids) plots[pid] = _round(b.plots[pid]);
        return { time: b.time, plots };
      }),
    }));
  }

  const pineRaw = await evalFn(PINE_GRAPHICS_JS);
  const pine_graphics = {
    lines: (pineRaw?.lines || []).map(l => ({ study: l.study, price: _round(l.price) })),
    labels: (pineRaw?.labels || []).map(l => ({ study: l.study, text: l.text, price: _round(l.price) })),
    tables: pineRaw?.tables || [],
    boxes: (pineRaw?.boxes || []).map(b => ({ study: b.study, high: _round(b.high), low: _round(b.low) })),
  };

  const ohlcv = (base.ohlcv || []).map(b => ({
    time: b.time, open: _round(b.open), high: _round(b.high), low: _round(b.low), close: _round(b.close), volume: b.volume,
  }));

  const result = {
    success: true,
    captured_at: new Date().toISOString(),
    symbol: base.symbol ?? null,
    resolution: base.resolution ?? null,
    chart_type: base.chart_type ?? null,
    visible_range: base.visible_range ?? null,
    price_range: base.price_range ? { high: _round(base.price_range.high), low: _round(base.price_range.low) } : null,
    bar_count: ohlcv.length,
    ohlcv,
    studies: base.studies || [],
    study_count: (base.studies || []).length,
    drawings: base.drawings || [],
    drawing_count: (base.drawings || []).length,
    pine_graphics,
  };
  if (include_series) result.study_series = study_series;

  if (include_screenshot) {
    const shot = await captureScreenshot({
      region, filename, waitForRender: wait_for_render, stabilize_ms, target, _deps,
    });
    result.screenshot = {
      file_path: shot.file_path ?? null,
      region: shot.region ?? region,
      size_bytes: shot.size_bytes ?? null,
      method: shot.method ?? null,
    };
  }

  return result;
}
