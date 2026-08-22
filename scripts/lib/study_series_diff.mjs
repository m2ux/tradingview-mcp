/**
 * Pure helpers for the capture → freeze → diff harness.
 * No CDP / TradingView imports — unit-tested in tests/capture_loop.test.js.
 */

/** Unix seconds from a unix integer/string or an ISO timestamp. */
export function parseTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const s = String(value).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.trunc(Number(s));
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Invalid time: ${value}`);
  return Math.floor(ms / 1000);
}

/**
 * Slice rows by inclusive unix-second window and optionally drop the
 * still-forming last bar.
 */
export function applyWindow(rows, { from, to, dropLast } = {}) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  const fromTs = from == null ? null : parseTime(from);
  const toTs = to == null ? null : parseTime(to);
  if (fromTs != null) out = out.filter((r) => Number(r.time) >= fromTs);
  if (toTs != null) out = out.filter((r) => Number(r.time) <= toTs);
  if (dropLast && out.length) out = out.slice(0, -1);
  return out;
}

export function signalKey(plots, plotIds) {
  return (plotIds || []).filter((pid) => plots?.[pid] && plots[pid] !== 0).sort().join('+');
}

/**
 * Compare a frozen reference capture to a live series.
 * `ref` is a capture JSON ({ rows, plot_ids, symbol, interval }).
 * `live` is a getStudySeries-shaped object ({ bars, plot_ids, symbol, interval, price }).
 */
export function diffStudySeries({
  ref,
  live,
  rsiByTime = new Map(),
  livePrice,
  tol = 1e-6,
} = {}) {
  const notes = [];
  const note = (m) => notes.push(m);
  const priceMap = livePrice || new Map((live?.price || []).map((p) => [p.time, p]));

  if (live?.symbol != null && ref?.symbol != null && live.symbol !== ref.symbol) {
    note(`symbol ${live.symbol} != ref ${ref.symbol}`);
  }
  if (live?.interval != null && ref?.interval != null
    && String(live.interval) !== String(ref.interval)) {
    note(`interval ${live.interval} != ref ${ref.interval}`);
  }

  const plotIds = ref.plot_ids || [];
  const refSigs = new Map();
  const liveSigs = new Map();
  for (const r of ref.rows || []) {
    const s = signalKey(r, plotIds);
    if (s) refSigs.set(r.time, s);
  }
  for (const b of live?.bars || []) {
    const s = signalKey(b.plots, plotIds);
    if (s) liveSigs.set(b.time, s);
  }

  for (const [time, s] of refSigs) {
    if (!liveSigs.has(time)) note(`missing live signal @ ${new Date(time * 1000).toISOString().slice(0, 10)} (${s})`);
    else if (liveSigs.get(time) !== s) {
      note(`signal side changed @ ${new Date(time * 1000).toISOString().slice(0, 10)}: ref=${s} live=${liveSigs.get(time)}`);
    }
  }
  for (const [time, s] of liveSigs) {
    if (!refSigs.has(time)) note(`extra live signal @ ${new Date(time * 1000).toISOString().slice(0, 10)} (${s})`);
  }

  const liveByTime = new Map();
  for (const b of live?.bars || []) liveByTime.set(b.time, b.plots);

  let compared = 0;
  let maxPlotDrift = 0;
  let maxRsiDrift = 0;
  let maxCloseDrift = 0;
  for (const r of ref.rows || []) {
    const lp = liveByTime.get(r.time);
    if (!lp) continue;
    compared++;
    for (const pid of plotIds) {
      const a = r[pid];
      const b = lp[pid];
      if (a == null || b == null) continue;
      const d = Math.abs(a - b);
      if (d > maxPlotDrift) maxPlotDrift = d;
      if (d > tol) note(`plot ${pid} drift @ ${(r.iso || '').slice(0, 10)}: ref=${a} live=${b}`);
    }
    const lr = rsiByTime.get(r.time);
    if (r.rsi != null && lr != null) {
      const d = Math.abs(r.rsi - lr);
      if (d > maxRsiDrift) maxRsiDrift = d;
    }
    const lc = priceMap.get(r.time)?.close;
    if (r.close != null && lc != null) {
      const d = Math.abs(r.close - lc);
      if (d > maxCloseDrift) maxCloseDrift = d;
    }
  }

  return {
    problems: notes.length,
    notes,
    compared,
    maxPlotDrift,
    maxRsiDrift,
    maxCloseDrift,
    refSignals: refSigs.size,
    liveSignals: liveSigs.size,
  };
}
