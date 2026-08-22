#!/usr/bin/env node
// Regression harness: re-capture the live study series and diff against a
// frozen reference baseline produced by capture_study_series.mjs. Fails (exit 1)
// if signals change identity/timing or values drift beyond tolerance — guards
// against regression while optimizing the detector, and quantifies agreement.
// Reads through the MCP core (core/data.js getStudySeries) via the `target`
// param, so it needs no raw CDP socket of its own (issue #13).
//
// Usage:
//   node scripts/diff_study_series.mjs --target od9I4OCz \
//        --ref scripts/reference/rszonediv_4d_300.json [--tol 1e-6] \
//        [--from 1761760800 --to 1786510800 --drop-last]
import { readFileSync } from 'fs';
import { getStudySeries } from '../src/core/data.js';
import { getState } from '../src/core/chart.js';
import { applyWindow, diffStudySeries } from './lib/study_series_diff.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined ? dflt : v;
}
const refPath = arg('ref', null);
const targetSel = arg('target', null);
const tol = parseFloat(arg('tol', '1e-6'));
const from = arg('from', null);
const to = arg('to', null);
const dropLast = process.argv.includes('--drop-last');
if (!refPath) { console.error('--ref required'); process.exit(2); }

const ref = JSON.parse(readFileSync(refPath, 'utf8'));
ref.rows = applyWindow(ref.rows || [], {
  from: from ?? ref.window?.from,
  to: to ?? ref.window?.to,
  dropLast: dropLast || Boolean(ref.window?.drop_last),
});
const study = ref.study;
const count = Math.max(ref.bar_count || 0, ref.rows.length, parseInt(arg('count', '0'), 10) || 0) || 300;
const rsiStudy = ref.rsi_study || 'Relative Strength Index';
// Re-target the exact study the baseline froze, when its entity id was
// recorded — avoids first-match name drift if a duplicate study is on chart.
const entityId = arg('entity-id', ref.entity_id || null);

const win = {
  from: from ?? ref.window?.from,
  to: to ?? ref.window?.to,
  dropLast: dropLast || Boolean(ref.window?.drop_last),
};

let live, rsi, state;
try {
  live = await getStudySeries({
    study, entity_id: entityId, count, max_bars: count, include_price: true, target: targetSel,
  });
  rsi = await getStudySeries({ study: rsiStudy, count, max_bars: count, target: targetSel }).catch(() => null);
  state = await getState({ target: targetSel }).catch(() => null);
} catch (e) {
  console.error(e.message || 'live study not found');
  process.exit(2);
}
if (!live) { console.error('live study not found'); process.exit(2); }
live.symbol = state?.symbol ?? null;
live.interval = state?.resolution ?? null;
live.bars = applyWindow(live.bars || [], win);
if (live.price) live.price = applyWindow(live.price, win);

const rsiByTime = new Map();
if (rsi && rsi.bars) {
  for (const b of applyWindow(rsi.bars, win)) {
    rsiByTime.set(b.time, b.plots.RelativeStrengthIndex ?? b.plots.plot_0 ?? null);
  }
}

const d = diffStudySeries({ ref, live, rsiByTime, tol });
console.log(`ref signals=${d.refSignals} live signals=${d.liveSignals} (tol=${tol})`);
for (const n of d.notes) console.log('  [DIFF] ' + n);
console.log(`compared bars=${d.compared}/${ref.rows.length}`);
console.log(`max drift: plot=${d.maxPlotDrift} rsi=${d.maxRsiDrift.toExponential(2)} close=${d.maxCloseDrift}`);

if (d.problems === 0) { console.log('\nPASS — live matches reference.'); process.exit(0); }
console.log(`\nFAIL — ${d.problems} difference(s).`); process.exit(1);
