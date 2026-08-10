#!/usr/bin/env node
// Regression harness: re-capture the live study series and diff against a
// frozen reference baseline produced by capture_study_series.mjs. Fails (exit 1)
// if signals change identity/timing or values drift beyond tolerance — guards
// against regression while optimizing the detector, and quantifies agreement.
//
// Usage:
//   node scripts/diff_study_series.mjs --target od9I4OCz \
//        --ref scripts/reference/rszonediv_4d_300.json [--tol 1e-6]
import CDP from 'chrome-remote-interface';
import { readFileSync } from 'fs';

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

const BARS_PATH = 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()';
function seriesExpr(studyName, maxBars, wantPrice) {
  return `(function() {
    var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
    var sources = chart.model().model().dataSources();
    var filter = ${JSON.stringify(studyName)};
    var maxBars = ${maxBars};
    var target = null;
    for (var si=0; si<sources.length; si++){ var s=sources[si]; if(!s.metaInfo) continue;
      try{ var meta=s.metaInfo(); var name=meta.description||meta.shortDescription||''; if(!name) continue;
        if(!filter || name.indexOf(filter)!==-1){ target=s; break; } }catch(e){} }
    if(!target) return { found:false, error:'No study matching "'+filter+'"' };
    var meta2=target.metaInfo(); var plotIds=(meta2.plots||[]).map(function(p){return p.id;});
    var items=(target._data&&target._data._items)?target._data._items:[];
    var total=items.length; var startIdx=Math.max(0,total-maxBars); var bars=[];
    for(var i=startIdx;i<total;i++){ var it=items[i]; if(!it||!it.value) continue;
      var plotsOut={}; for(var vi=0;vi<plotIds.length;vi++){ var raw=it.value[vi+1]; plotsOut[plotIds[vi]]=(typeof raw==='number'&&isFinite(raw))?raw:null; }
      bars.push({time:it.value[0],plots:plotsOut}); }
    var price=null;
    if(${wantPrice?'true':'false'}){ try{ var mainBars=${BARS_PATH}; var byTime={}; for(var bi=0;bi<bars.length;bi++)byTime[bars[bi].time]=true;
      price=[]; var end=mainBars.lastIndex(),first=mainBars.firstIndex();
      for(var gi=first;gi<=end;gi++){ var v=mainBars.valueAt(gi); if(v&&byTime[v[0]]) price.push({time:v[0],open:v[1],high:v[2],low:v[3],close:v[4],volume:v[5]||0}); } }catch(e){price=null;} }
    var sym=''; try{sym=chart.model().mainSeries().symbol();}catch(e){}
    var res=''; try{res=chart.model().mainSeries().interval();}catch(e){}
    return { found:true, study:meta2.description||'', plot_ids:plotIds, symbol:sym, interval:res, bar_count:bars.length, total_available:total, bars:bars, price:price };
  })()`;
}

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const charts = targets.filter(t => t.url?.includes('tradingview.com/chart'));
const t = targetSel ? charts.find(x => x.url.includes(targetSel)) : charts[0];
if (!t) { console.error('No matching chart target'); process.exit(2); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();
const evalExpr = async (expr) => {
  const r = await c.Runtime.evaluate({ expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate failed');
  return r.result?.value;
};

const live = await evalExpr(seriesExpr(study, count, true));
const rsi = await evalExpr(seriesExpr(rsiStudy, count, false));
await c.close();
if (!live || !live.found) { console.error('live study not found'); process.exit(2); }

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
