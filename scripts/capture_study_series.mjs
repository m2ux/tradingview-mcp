#!/usr/bin/env node
// Capture a frozen reference plot (price + study signal series) from the live
// chart. Used as the regression/performance baseline before optimizing the
// detector. Reads through the MCP core (core/data.js getStudySeries) via the
// `target` param, so it can aim at a specific chart tab WITHOUT opening its own
// raw CDP socket (issue #13). The read path matches the data_get_study_series
// tool exactly.
//
// Usage:
//   node scripts/capture_study_series.mjs --study "RSI Zone Divergence" \
//        --target od9I4OCz --count 300 --price --out scripts/reference/rszonediv_4d_300.json
//   node scripts/capture_study_series.mjs --entity-id FzvERz --count 300 --price
//   node scripts/capture_study_series.mjs --from 1761760800 --to 1786510800 --drop-last
//   node scripts/capture_study_series.mjs --timeframes 5,15,30 --out scripts/reference/base.json
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getStudySeries } from '../src/core/data.js';
import { getState, setTimeframe } from '../src/core/chart.js';
import { evaluate, withTargetEvaluate, KNOWN_PATHS, safeString } from '../src/connection.js';
import { applyWindow } from './lib/study_series_diff.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined ? dflt : v;
}

const study = arg('study', 'RSI Zone Divergence');
const entityId = arg('entity-id', null);
const includePrice = process.argv.includes('--price');
const outPath = arg('out', null);
const rsiStudy = arg('rsi', 'Relative Strength Index');
const targetSel = arg('target', null);
const from = arg('from', null);
const to = arg('to', null);
const dropLast = process.argv.includes('--drop-last');
const wantCalc = process.argv.includes('--calc-time');
const timeframes = String(arg('timeframes', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const windowed = from != null || to != null;
const count = parseInt(arg('count', windowed ? '10000' : '300'), 10);
const maxBars = parseInt(arg('max-bars', String(count)), 10);

function outForTimeframe(base, tf) {
  if (!base) return null;
  return base.replace(/(\.[^.]+)$/, `_${tf}$1`);
}

async function probeCalculationTime() {
  const probe = `
    (function() {
      try {
        var sources = ${KNOWN_PATHS.chartApi}._chartWidget.model().model().dataSources();
        var filter = ${safeString(study || '')};
        var entityId = ${safeString(entityId || '')};
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (!s.metaInfo) continue;
          var sid = null;
          try { sid = s.id ? s.id() : null; } catch (e) {}
          if (entityId && String(sid) !== entityId) continue;
          if (!entityId) {
            var meta = s.metaInfo();
            var name = meta.description || meta.shortDescription || '';
            if (filter && name.indexOf(filter) === -1) continue;
          }
          var ms = null, via = null;
          try {
            if (s._data && typeof s._data.calculationTime === 'number') {
              ms = s._data.calculationTime; via = '_data.calculationTime';
            }
          } catch (e) {}
          try {
            if (ms == null && typeof s.metaInfo().calculationTime === 'number') {
              ms = s.metaInfo().calculationTime; via = 'metaInfo.calculationTime';
            }
          } catch (e) {}
          return { calculation_time_ms: ms, via: via };
        }
      } catch (e) {
        return { calculation_time_ms: null, via: null, error: String(e && e.message || e) };
      }
      return { calculation_time_ms: null, via: null };
    })()
  `;
  try {
    if (targetSel) return await withTargetEvaluate(targetSel, (ev) => ev(probe));
    return await evaluate(probe);
  } catch {
    return { calculation_time_ms: null, via: null };
  }
}

async function captureOnce() {
  const opts = { count, max_bars: maxBars, include_price: includePrice };
  if (targetSel) opts.target = targetSel;
  if (entityId) opts.entity_id = entityId;

  let main;
  try {
    main = await getStudySeries({ study, ...opts });
  } catch (e) {
    console.error(e.message || 'study not found');
    process.exit(1);
  }

  let symbol = null, interval = null;
  try {
    const state = await getState({ target: targetSel });
    symbol = state.symbol ?? null;
    interval = state.resolution ?? null;
  } catch { /* best-effort */ }

  let rsi = null;
  try {
    rsi = await getStudySeries({ study: rsiStudy, count, max_bars: maxBars, target: targetSel });
  } catch { rsi = null; }

  const rsiByTime = new Map();
  if (rsi) {
    for (const b of rsi.bars || []) {
      const v = b.plots.RelativeStrengthIndex ?? b.plots.plot_0;
      rsiByTime.set(b.time, (typeof v === 'number' && isFinite(v)) ? v : null);
    }
  }

  const priceByTime = new Map((main.price || []).map((p) => [p.time, p]));
  let rows = (main.bars || []).map((b) => {
    const p = priceByTime.get(b.time) || null;
    const r = { time: b.time, iso: new Date(b.time * 1000).toISOString(), rsi: rsiByTime.get(b.time) ?? null };
    for (const pid of main.plot_ids) r[pid] = b.plots[pid];
    if (p) { r.open = p.open; r.high = p.high; r.low = p.low; r.close = p.close; r.volume = p.volume; }
    return r;
  });
  rows = applyWindow(rows, { from, to, dropLast });

  const out = {
    captured_at: new Date().toISOString(),
    symbol, interval,
    study: main.study, entity_id: main.entity_id, plot_ids: main.plot_ids,
    rsi_study: rsi ? rsi.study : null,
    bar_count: rows.length,
    total_available: main.total_available,
    window: { from, to, drop_last: dropLast },
    rows,
  };

  if (wantCalc) {
    const calc = await probeCalculationTime();
    out.calculation_time_ms = calc?.calculation_time_ms ?? null;
    out.calculation_time_via = calc?.via ?? null;
    if (rows.length && out.calculation_time_ms != null) {
      out.ms_per_bar = out.calculation_time_ms / rows.length;
    }
  }
  return out;
}

function writeCapture(payload, path) {
  const text = JSON.stringify(payload, null, 2);
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`Captured ${payload.rows.length} bars [${payload.symbol} ${payload.interval}] ${payload.study} -> ${path}`);
    const cols = ['time', 'iso', ...payload.plot_ids, 'rsi', 'open', 'high', 'low', 'close', 'volume'];
    const csv = [cols.join(',')].concat(payload.rows.map((r) => cols.map((k) => (r[k] == null ? '' : r[k])).join(','))).join('\n');
    const csvPath = path.replace(/\.json$/i, '.csv');
    writeFileSync(csvPath, csv);
    console.log(`CSV -> ${csvPath}`);
  } else {
    console.log(text);
  }
}

if (timeframes.length) {
  let original = null;
  try {
    const state = await getState({ target: targetSel });
    original = state.resolution ?? null;
  } catch { /* restore best-effort */ }

  const set = [];
  try {
    for (const tf of timeframes) {
      await setTimeframe({ timeframe: tf });
      const payload = await captureOnce();
      payload.interval = tf;
      const path = outForTimeframe(outPath, tf);
      writeCapture(payload, path);
      set.push({ timeframe: tf, bar_count: payload.bar_count, out: path });
    }
  } finally {
    if (original != null) {
      try { await setTimeframe({ timeframe: String(original) }); } catch { /* leave as-is */ }
    }
  }
  if (outPath) {
    const manifest = outPath.replace(/(\.[^.]+)$/, '_mtf$1');
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, JSON.stringify({ captured_at: new Date().toISOString(), study, timeframes, set }, null, 2));
    console.log(`MTF manifest -> ${manifest}`);
  }
} else {
  writeCapture(await captureOnce(), outPath);
}
