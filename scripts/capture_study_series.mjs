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
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getStudySeries, getQuote } from '../src/core/data.js';
import { getState } from '../src/core/chart.js';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined ? dflt : v;
}
const study = arg('study', 'RSI Zone Divergence');
const count = parseInt(arg('count', '300'), 10);
const includePrice = process.argv.includes('--price');
const outPath = arg('out', null);
const rsiStudy = arg('rsi', 'Relative Strength Index');
const targetSel = arg('target', null); // chart_id or URL substring to pick the tab

const opts = { count, include_price: includePrice };
if (targetSel) opts.target = targetSel;

let main;
try {
  main = await getStudySeries({ study, ...opts });
} catch (e) {
  console.error(e.message || 'study not found');
  process.exit(1);
}

// getStudySeries doesn't carry symbol/resolution — pull them from a targeted
// chart read so the reference still records them for the diff harness.
let symbol = null, interval = null;
try {
  const state = await getState({ target: targetSel });
  symbol = state.symbol ?? null;
  interval = state.resolution ?? null;
} catch { /* best-effort */ }

// Companion RSI series (for divergence grading), aligned by time.
let rsi = null;
try {
  rsi = await getStudySeries({ study: rsiStudy, count, target: targetSel });
} catch { rsi = null; }

const rsiByTime = new Map();
if (rsi) {
  for (const b of rsi.bars || []) {
    const v = b.plots.RelativeStrengthIndex ?? b.plots.plot_0;
    rsiByTime.set(b.time, (typeof v === 'number' && isFinite(v)) ? v : null);
  }
}

// Flatten to an aligned, analysis-ready row set.
const priceByTime = new Map((main.price || []).map(p => [p.time, p]));
const rows = (main.bars || []).map(b => {
  const p = priceByTime.get(b.time) || null;
  const r = { time: b.time, iso: new Date(b.time * 1000).toISOString(), rsi: rsiByTime.get(b.time) ?? null };
  for (const pid of main.plot_ids) r[pid] = b.plots[pid];
  if (p) { r.open = p.open; r.high = p.high; r.low = p.low; r.close = p.close; r.volume = p.volume; }
  return r;
});

const out = {
  captured_at: new Date().toISOString(),
  symbol, interval,
  study: main.study, entity_id: main.entity_id, plot_ids: main.plot_ids,
  rsi_study: rsi ? rsi.study : null,
  bar_count: main.bar_count, total_available: main.total_available,
  rows,
};

const text = JSON.stringify(out, null, 2);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  console.log(`Captured ${rows.length} bars [${symbol} ${interval}] ${main.study} -> ${outPath}`);
} else {
  console.log(text);
}

// CSV sidecar for quick plotting/diffing.
if (outPath) {
  const cols = ['time', 'iso', ...main.plot_ids, 'rsi', 'open', 'high', 'low', 'close', 'volume'];
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(k => (r[k] == null ? '' : r[k])).join(','))).join('\n');
  const csvPath = outPath.replace(/\.json$/i, '.csv');
  writeFileSync(csvPath, csv);
  console.log(`CSV -> ${csvPath}`);
}
