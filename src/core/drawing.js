/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getChartApi as _getChartApi, safeString, requireFinite, KNOWN_PATHS } from '../connection.js';
import { sleep } from '../wait.js';
import { listTemplates, getTemplate } from './drawing_templates.js';

const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

/** OHLC field per TV click: bullish L→H→L, bearish H→L→H. */
export const FIB_DIRECTION_SOURCES = {
  bullish: ['low', 'high', 'low'],
  bearish: ['high', 'low', 'high'],
};

export function normalizeFibDirection(direction) {
  const d = String(direction ?? '').trim().toLowerCase();
  if (d === 'bullish' || d === 'bull') return 'bullish';
  if (d === 'bearish' || d === 'bear') return 'bearish';
  return null;
}

function optionalPrice(point, label) {
  if (point == null || point.price == null || point.price === '') return undefined;
  return requireFinite(point.price, `${label}.price`);
}

function toBarUnix(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return n;
  return n > 1e11 ? n / 1000 : n;
}

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

export async function drawShape({ shape, point, point2, overrides: overridesRaw, text, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const overrides = overridesRaw ? (typeof overridesRaw === 'string' ? JSON.parse(overridesRaw) : overridesRaw) : {};
  const apiPath = await getChartApi();
  const overridesStr = JSON.stringify(overrides || {});
  const textStr = text ? JSON.stringify(text) : '""';

  const p1time = requireFinite(point.time, 'point.time');
  const p1price = requireFinite(point.price, 'point.price');

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  if (point2) {
    const p2time = requireFinite(point2.time, 'point2.time');
    const p2price = requireFinite(point2.price, 'point2.price');
    await evaluate(`
      ${apiPath}.createMultipointShape(
        [{ time: ${p1time}, price: ${p1price} }, { time: ${p2time}, price: ${p2price} }],
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  } else {
    await evaluate(`
      ${apiPath}.createShape(
        { time: ${p1time}, price: ${p1price} },
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  }

  await sleep(200);
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;
  const result = { entity_id: newId };
  return { success: true, shape, entity_id: result?.entity_id };
}

const FIB_CHANNEL_TYPE = 'fibonacci channel';
const FIB_CHANNEL_LIST = '/drawing-templates/LineToolFibChannel/';

async function resolveFibLoci({ direction, point, point2, point3, evaluate }) {
  const sources = FIB_DIRECTION_SOURCES[direction];
  const raw = [point, point2, point3];
  const labels = ['point', 'point2', 'point3'];
  const times = raw.map((p, i) => requireFinite(p?.time, `${labels[i]}.time`));
  const explicit = raw.map((p, i) => optionalPrice(p, labels[i]));
  const needLookup = explicit.some((price) => price === undefined);

  let bars = [null, null, null];
  if (needLookup) {
    const wantIdx = [];
    const want = [];
    for (let i = 0; i < explicit.length; i++) {
      if (explicit[i] === undefined) {
        wantIdx.push(i);
        want.push(toBarUnix(times[i]));
      }
    }
    const looked = await evaluate(`
      (function() { // drawFibChannel_lookupBars
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') {
          return { ok: false, error: 'Main series bars not available' };
        }
        var want = ${JSON.stringify(want)};
        var found = [];
        for (var w = 0; w < want.length; w++) found[w] = null;
        var start = bars.firstIndex();
        var end = bars.lastIndex();
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (!v) continue;
          var bt = v[0] > 1e11 ? v[0] / 1000 : v[0];
          for (var k = 0; k < want.length; k++) {
            if (found[k]) continue;
            if (bt === want[k]) {
              found[k] = { time: v[0], open: v[1], high: v[2], low: v[3], close: v[4] };
            }
          }
        }
        var missing = [];
        for (var m = 0; m < want.length; m++) {
          if (!found[m]) missing.push(want[m]);
        }
        if (missing.length) {
          return { ok: false, error: 'No loaded bar at time(s): ' + missing.join(', '), missing: missing };
        }
        return { ok: true, bars: found };
      })()
    `);
    if (!looked?.ok) {
      return {
        success: false,
        error: looked?.error || 'Failed to resolve OHLC for fib channel loci',
        missing: looked?.missing,
      };
    }
    wantIdx.forEach((locusIdx, k) => { bars[locusIdx] = looked.bars[k]; });
  }

  const points = times.map((time, i) => {
    const source = sources[i];
    if (explicit[i] !== undefined) {
      return { time, price: explicit[i], source: 'price' };
    }
    const bar = bars[i];
    const price = bar?.[source];
    if (!Number.isFinite(price)) {
      return { error: `Bar at ${time} has no ${source}` };
    }
    return { time: bar.time ?? time, price, source };
  });
  const failed = points.find((p) => p.error);
  if (failed) return { success: false, error: failed.error };
  return { success: true, points, sources };
}

/**
 * Draw a Fibonacci channel from a caller-supplied LineToolFibChannel template
 * name, a bullish/bearish direction, and three loci (TV click order: baseline
 * point→point2, offset point3). Times are required; prices default to that
 * bar's OHLC extreme from `direction` (bullish L→H→L, bearish H→L→H).
 * `template` has no default. Refuses if that name is missing from the cloud
 * list — no factory fallback.
 */
export async function drawFibChannel({ template, direction, point, point2, point3, _deps }) {
  const { evaluate, evaluateAsync, getChartApi } = _resolve(_deps);
  const templateDeps = { evaluateAsync };
  const name = String(template ?? '').trim();
  if (!name) {
    return { success: false, error: 'template is required (any exact LineToolFibChannel template name; no default)' };
  }

  const dir = normalizeFibDirection(direction);
  if (!dir) {
    return { success: false, error: 'direction is required: "bullish" (L→H→L) or "bearish" (H→L→H)' };
  }

  const listed = await listTemplates({ drawing_type: FIB_CHANNEL_TYPE, _deps: templateDeps });
  if (!listed.success) {
    return {
      success: false,
      error: listed.error || `Failed to list templates at ${FIB_CHANNEL_LIST}`,
      status: listed.status,
    };
  }
  const names = listed.templates || [];
  if (!names.includes(name)) {
    return {
      success: false,
      error: `Template "${name}" not found in ${FIB_CHANNEL_LIST}. Available: ${names.join(', ') || '(none)'}`,
      templates: names,
    };
  }

  const loaded = await getTemplate({ drawing_type: FIB_CHANNEL_TYPE, name, _deps: templateDeps });
  if (!loaded.success) {
    return {
      success: false,
      error: loaded.error || `Failed to load template "${name}"`,
      status: loaded.status,
    };
  }

  const resolved = await resolveFibLoci({ direction: dir, point, point2, point3, evaluate });
  if (!resolved.success) return resolved;
  const { points } = resolved;
  const [p1, p2, p3] = points;

  const apiPath = await getChartApi();
  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  await evaluateAsync(`
    (async function() {
      var api = ${apiPath};
      return await api.createMultipointShape(
        [
          { time: ${p1.time}, price: ${p1.price} },
          { time: ${p2.time}, price: ${p2.price} },
          { time: ${p3.time}, price: ${p3.price} }
        ],
        { shape: ${safeString('fib_channel')}, template: ${JSON.stringify(loaded.content)} }
      );
    })()
  `);

  await sleep(200);
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;
  return {
    success: true,
    entity_id: newId,
    template: name,
    direction: dir,
    sources: FIB_DIRECTION_SOURCES[dir],
    points,
  };
}

export async function listDrawings() {
  const apiPath = await _getChartApi();
  const shapes = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) { return { id: s.id, name: s.name }; });
    })()
  `);
  return { success: true, count: shapes?.length || 0, shapes: shapes || [] };
}

export async function getProperties({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var props = { entity_id: eid };
      var shape = api.getShapeById(eid);
      if (!shape) return { error: 'Shape not found: ' + eid };
      var methods = [];
      try { for (var key in shape) { if (typeof shape[key] === 'function') methods.push(key); } props.available_methods = methods; } catch(e) {}
      try { var pts = shape.getPoints(); if (pts) props.points = pts; } catch(e) { props.points_error = e.message; }
      try { var ovr = shape.getProperties(); if (ovr) props.properties = ovr; } catch(e) {
        try { var ovr2 = shape.properties(); if (ovr2) props.properties = ovr2; } catch(e2) { props.properties_error = e2.message; }
      }
      try { props.visible = shape.isVisible(); } catch(e) {}
      try { props.locked = shape.isLocked(); } catch(e) {}
      try { props.selectable = shape.isSelectionEnabled(); } catch(e) {}
      try {
        var all = api.getAllShapes();
        for (var i = 0; i < all.length; i++) { if (all[i].id === eid) { props.name = all[i].name; break; } }
      } catch(e) {}
      return props;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, ...result };
}

export async function removeOne({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var before = api.getAllShapes();
      var found = false;
      for (var i = 0; i < before.length; i++) { if (before[i].id === eid) { found = true; break; } }
      if (!found) return { removed: false, error: 'Shape not found: ' + eid, available: before.map(function(s) { return s.id; }) };
      api.removeEntity(eid);
      var after = api.getAllShapes();
      var stillExists = false;
      for (var j = 0; j < after.length; j++) { if (after[j].id === eid) { stillExists = true; break; } }
      return { removed: !stillExists, entity_id: eid, remaining_shapes: after.length };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id: result?.entity_id, removed: result?.removed, remaining_shapes: result?.remaining_shapes };
}

export async function clearAll() {
  const apiPath = await _getChartApi();
  await _evaluate(`${apiPath}.removeAllShapes()`);
  return { success: true, action: 'all_shapes_removed' };
}
