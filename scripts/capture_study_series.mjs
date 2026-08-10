#!/usr/bin/env node
// Capture a frozen reference plot (price + study signal series) from the live
// chart via CDP. Used as the regression/performance baseline before optimizing
// the detector. Injects the SAME evaluate-expression as core/data.js
// getStudySeries so the baseline matches the tool's behavior exactly.
//
// Usage:
//   node scripts/capture_study_series.mjs --study "RSI Zone Divergence" \
//        --count 300 --price --out scripts/reference/rszonediv_4d_300.json
import CDP from 'chrome-remote-interface';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

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

const BARS_PATH = 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()';

function seriesExpr(studyName, maxBars, wantPrice) {
  return `(function() {
    var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
    var sources = chart.model().model().dataSources();
    var filter = ${JSON.stringify(studyName)};
    var maxBars = ${maxBars};
    var target = null;
    for (var si = 0; si < sources.length; si++) {
      var s = sources[si];
      if (!s.metaInfo) continue;
      try {
        var meta = s.metaInfo();
        var name = meta.description || meta.shortDescription || '';
        if (!name) continue;
        if (!filter || name.indexOf(filter) !== -1) { target = s; break; }
      } catch(e) {}
    }
    if (!target) return { found:false, error:'No study matching "' + filter + '"' };
    var meta2 = target.metaInfo();
    var plotIds = (meta2.plots||[]).map(function(p){return p.id;});
    var entityId = null; try { entityId = target.id ? target.id() : null; } catch(e) {}
    var items = (target._data && target._data._items) ? target._data._items : [];
    var total = items.length;
    var startIdx = Math.max(0, total - maxBars);
    var bars = [];
    for (var i = startIdx; i < total; i++) {
      var it = items[i];
      if (!it || !it.value) continue;
      var plotsOut = {};
      for (var vi = 0; vi < plotIds.length; vi++) {
        var raw = it.value[vi+1];
        plotsOut[plotIds[vi]] = (typeof raw === 'number' && isFinite(raw)) ? raw : null;
      }
      bars.push({ time: it.value[0], plots: plotsOut });
    }
    var price = null;
    if (${wantPrice ? 'true' : 'false'}) {
      try {
        var mainBars = ${BARS_PATH};
        var byTime = {}; for (var bi=0;bi<bars.length;bi++) byTime[bars[bi].time]=true;
        price = [];
        var end = mainBars.lastIndex(), first = mainBars.firstIndex();
        for (var gi = first; gi <= end; gi++) {
          var v = mainBars.valueAt(gi);
          if (v && byTime[v[0]]) price.push({ time:v[0], open:v[1], high:v[2], low:v[3], close:v[4], volume:v[5]||0 });
        }
      } catch(e) { price = null; }
    }
    var sym=''; try { sym = chart.model().mainSeries().symbol(); } catch(e){}
    var res=''; try { res = chart.model().mainSeries().interval(); } catch(e){}
    return { found:true, study: meta2.description||'', entity_id: entityId, plot_ids: plotIds,
             symbol: sym, interval: res, bar_count: bars.length, total_available: total, bars: bars, price: price };
  })()`;
}

const targetSel = arg('target', null); // chart_id or URL substring to pick the CDP tab
const targets = await (await fetch('http://localhost:9222/json/list')).json();
const charts = targets.filter(t => t.url?.includes('tradingview.com/chart'));
let t = targetSel ? charts.find(x => x.url.includes(targetSel)) : charts[0];
if (!t) {
  console.error('No matching TradingView chart target. Available:');
  charts.forEach(x => console.error('  ' + x.url));
  process.exit(1);
}
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

async function evalExpr(expr) {
  const r = await c.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

const main = await evalExpr(seriesExpr(study, count, includePrice));
if (!main || !main.found) { console.error(main?.error || 'study not found'); await c.close(); process.exit(1); }

// Companion RSI series (for divergence grading), aligned by time.
const rsi = await evalExpr(seriesExpr(rsiStudy, count, false));
const rsiByTime = new Map();
if (rsi && rsi.found) {
  for (const b of rsi.bars) {
    const v = b.plots.RelativeStrengthIndex ?? b.plots.plot_0;
    rsiByTime.set(b.time, (typeof v === 'number' && isFinite(v)) ? v : null);
  }
}

// Flatten to an aligned, analysis-ready row set.
const rows = main.bars.map(b => {
  const p = (main.price || []).find(x => x.time === b.time) || null;
  const r = { time: b.time, iso: new Date(b.time * 1000).toISOString(), rsi: rsiByTime.get(b.time) ?? null };
  for (const pid of main.plot_ids) r[pid] = b.plots[pid];
  if (p) { r.open = p.open; r.high = p.high; r.low = p.low; r.close = p.close; r.volume = p.volume; }
  return r;
});

const out = {
  captured_at: new Date().toISOString(),
  symbol: main.symbol, interval: main.interval,
  study: main.study, entity_id: main.entity_id, plot_ids: main.plot_ids,
  rsi_study: rsi && rsi.found ? rsi.study : null,
  bar_count: main.bar_count, total_available: main.total_available,
  rows,
};

const text = JSON.stringify(out, null, 2);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  console.log(`Captured ${rows.length} bars [${main.symbol} ${main.interval}] ${main.study} -> ${outPath}`);
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
await c.close();
