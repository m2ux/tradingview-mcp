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
//        --ref scripts/reference/rszonediv_4d_300.json [--tol 1e-6]
import { readFileSync } from 'fs';
import { getStudySeries } from '../src/core/data.js';
import { getState } from '../src/core/chart.js';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined ? dflt : v;
}
const refPath = arg('ref', null);
const targetSel = arg('target', null);
const tol = parseFloat(arg('tol', '1e-6'));
if (!refPath) { console.error('--ref required'); process.exit(2); }

const ref = JSON.parse(readFileSync(refPath, 'utf8'));
const study = ref.study;
const count = ref.bar_count;
const rsiStudy = ref.rsi_study || 'Relative Strength Index';
// Re-target the exact study the baseline froze, when its entity id was
// recorded — avoids first-match name drift if a duplicate study is on chart.
const entityId = arg('entity-id', ref.entity_id || null);

let live, rsi, state;
try {
  live = await getStudySeries({ study, entity_id: entityId, count, include_price: true, target: targetSel });
  rsi = await getStudySeries({ study: rsiStudy, count, target: targetSel }).catch(() => null);
  state = await getState({ target: targetSel }).catch(() => null);
} catch (e) {
  console.error(e.message || 'live study not found');
  process.exit(2);
}
if (!live) { console.error('live study not found'); process.exit(2); }
live.symbol = state?.symbol ?? null;
live.interval = state?.resolution ?? null;

const rsiByTime = new Map();
if (rsi && rsi.found) for (const b of rsi.bars) rsiByTime.set(b.time, b.plots.RelativeStrengthIndex ?? b.plots.plot_0 ?? null);
const livePrice = new Map(); for (const p of live.price || []) livePrice.set(p.time, p);
const liveByTime = new Map(); for (const b of live.bars) liveByTime.set(b.time, b.plots);

// --- Diff ---
let problems = 0;
const note = (m) => { console.log('  [DIFF] ' + m); problems++; };

if (live.symbol !== ref.symbol) note(`symbol ${live.symbol} != ref ${ref.symbol}`);
if (String(live.interval) !== String(ref.interval)) note(`interval ${live.interval} != ref ${ref.interval}`);

// Signal set comparison (by time + plot id + fired).
const sigOf = (plots) => ref.plot_ids.filter(pid => plots[pid] && plots[pid] !== 0).map(pid => pid).sort().join('+');
const refSigs = new Map(), liveSigs = new Map();
for (const r of ref.rows) { const s = sigOf(r); if (s) refSigs.set(r.time, s); }
for (const b of live.bars) { const s = sigOf(b.plots); if (s) liveSigs.set(b.time, s); }

console.log(`ref signals=${refSigs.size} live signals=${liveSigs.size} (tol=${tol})`);
for (const [time, s] of refSigs) {
  if (!liveSigs.has(time)) note(`missing live signal @ ${new Date(time*1000).toISOString().slice(0,10)} (${s})`);
  else if (liveSigs.get(time) !== s) note(`signal side changed @ ${new Date(time*1000).toISOString().slice(0,10)}: ref=${s} live=${liveSigs.get(time)}`);
}
for (const [time, s] of liveSigs) if (!refSigs.has(time)) note(`extra live signal @ ${new Date(time*1000).toISOString().slice(0,10)} (${s})`);

// Value drift on shared bars (study plots + rsi + close).
let compared = 0, maxPlotDrift = 0, maxRsiDrift = 0, maxCloseDrift = 0;
for (const r of ref.rows) {
  const lp = liveByTime.get(r.time); if (!lp) continue;
  compared++;
  for (const pid of ref.plot_ids) {
    const a = r[pid], b = lp[pid];
    if (a == null || b == null) continue;
    const d = Math.abs(a - b); if (d > maxPlotDrift) maxPlotDrift = d;
    if (d > tol) note(`plot ${pid} drift @ ${r.iso.slice(0,10)}: ref=${a} live=${b}`);
  }
  const lr = rsiByTime.get(r.time);
  if (r.rsi != null && lr != null) { const d = Math.abs(r.rsi - lr); if (d > maxRsiDrift) maxRsiDrift = d; }
  const lc = livePrice.get(r.time)?.close;
  if (r.close != null && lc != null) { const d = Math.abs(r.close - lc); if (d > maxCloseDrift) maxCloseDrift = d; }
}

console.log(`compared bars=${compared}/${ref.rows.length}`);
console.log(`max drift: plot=${maxPlotDrift} rsi=${maxRsiDrift.toExponential(2)} close=${maxCloseDrift}`);

if (problems === 0) { console.log('\nPASS — live matches reference.'); process.exit(0); }
console.log(`\nFAIL — ${problems} difference(s).`); process.exit(1);
