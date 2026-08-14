/**
 * Unit tests for captureSnapshot() — the headless one-call chart snapshot.
 * Pure unit: a mocked _deps.evaluate pattern-matches the generated page-JS
 * (base read / study series / pine graphics) and a mocked _deps.makeScopedClient
 * stubs the CDP screenshot so no real TradingView/CDP is needed.
 *
 * Run: node --test tests/capture_snapshot.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureSnapshot } from '../src/core/capture.js';

const BASE_READ = {
  symbol: 'ES1!',
  resolution: '5',
  chart_type: 1,
  visible_range: { from: 1000, to: 2000 },
  ohlcv: [
    { time: 1000, open: 100, high: 110, low: 95, close: 108, volume: 10 },
    { time: 1500, open: 108, high: 120, low: 107, close: 118, volume: 12 },
  ],
  price_range: { high: 120, low: 95 },
  studies: [{ id: 'st1', name: 'Relative Strength Index' }],
  drawings: [{ id: 'dr1', name: 'trend_line' }],
};

const SERIES_READ = [
  {
    id: 'st1',
    name: 'Relative Strength Index',
    plot_ids: ['plot_0'],
    bars: [
      { time: 1000, plots: { plot_0: 55.123456789 } },
      { time: 1500, plots: { plot_0: 61.987654321 } },
    ],
  },
];

const GRAPHICS_READ = {
  lines: [{ study: 'Profiler', price: 24550.123456789 }],
  labels: [{ study: 'Profiler', text: 'PDH 24550', price: 24550.5 }],
  tables: [{ study: 'Profiler', rows: ['Session | NY', 'Bias | Long'] }],
  boxes: [{ study: 'Profiler', high: 24600.25, low: 24500.75 }],
};

// Build a mocked _deps whose evaluate routes on the shape of the expression.
// NOTE: the screenshot's no-target path uses the module-level getClient()
// (not injectable), so unit tests run with include_screenshot:false and assert
// the data payload; the screenshot wiring is exercised by composition with
// captureScreenshot, which is covered separately.
function mockDeps({ base = BASE_READ, series = SERIES_READ, graphics = GRAPHICS_READ } = {}) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    if (/getVisibleRange/.test(expr) && /getAllStudies/.test(expr)) return base;
    if (/dataSources\(\)/.test(expr) && /_data\._items/.test(expr)) return series;
    if (/dwglines/.test(expr) && /dwgboxes/.test(expr)) return graphics;
    return undefined;
  };
  return { _deps: { evaluate }, calls };
}

describe('captureSnapshot() — headless chart snapshot', () => {
  it('assembles range, price range, ohlcv, studies, drawings, and pine graphics', async () => {
    const { _deps } = mockDeps();
    const r = await captureSnapshot({ include_screenshot: false, _deps });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'ES1!');
    assert.equal(r.resolution, '5');
    assert.deepEqual(r.visible_range, { from: 1000, to: 2000 });
    assert.deepEqual(r.price_range, { high: 120, low: 95 });
    assert.equal(r.bar_count, 2);
    assert.equal(r.ohlcv.length, 2);
    assert.equal(r.study_count, 1);
    assert.equal(r.drawing_count, 1);
    assert.equal(r.pine_graphics.lines[0].price, 24550.12345679); // rounded to 8dp
    assert.equal(r.pine_graphics.labels[0].text, 'PDH 24550');
    assert.equal(r.pine_graphics.tables[0].rows.length, 2);
    assert.deepEqual(r.pine_graphics.boxes[0], { study: 'Profiler', high: 24600.25, low: 24500.75 });
  });

  it('includes per-bar study series aligned to the visible range by default', async () => {
    const { _deps } = mockDeps();
    const r = await captureSnapshot({ include_screenshot: false, _deps });
    assert.ok(Array.isArray(r.study_series), 'study_series present');
    assert.equal(r.study_series[0].name, 'Relative Strength Index');
    assert.equal(r.study_series[0].bar_count, 2);
    assert.equal(r.study_series[0].bars[0].plots.plot_0, 55.12345679); // rounded
  });

  it('omits study series when include_series is false', async () => {
    const { _deps, calls } = mockDeps();
    const r = await captureSnapshot({ include_series: false, include_screenshot: false, _deps });
    assert.equal(r.study_series, undefined);
    const seriesCall = calls.find((c) => /_data\._items/.test(c));
    assert.equal(seriesCall, undefined, 'no series read dispatched');
  });

  it('passes the visible time window into the study-series reader', async () => {
    const { _deps, calls } = mockDeps();
    await captureSnapshot({ include_screenshot: false, _deps });
    const seriesCall = calls.find((c) => /_data\._items/.test(c));
    assert.ok(seriesCall.includes('var from = 1000'), 'from bound into series JS');
    assert.ok(seriesCall.includes('var to = 2000'), 'to bound into series JS');
  });

  it('omits the screenshot block when include_screenshot is false', async () => {
    const { _deps } = mockDeps();
    const r = await captureSnapshot({ include_screenshot: false, _deps });
    assert.equal(r.screenshot, undefined);
  });

  it('degrades gracefully when an optional section is empty', async () => {
    const { _deps } = mockDeps({
      base: { ...BASE_READ, studies: [], drawings: [], ohlcv: [], price_range: null },
      series: [],
      graphics: { lines: [], labels: [], tables: [], boxes: [] },
    });
    const r = await captureSnapshot({ include_screenshot: false, _deps });
    assert.equal(r.success, true);
    assert.equal(r.study_count, 0);
    assert.equal(r.drawing_count, 0);
    assert.equal(r.bar_count, 0);
    assert.equal(r.price_range, null);
    assert.deepEqual(r.pine_graphics, { lines: [], labels: [], tables: [], boxes: [] });
  });

  it('throws when the base chart read returns nothing', async () => {
    const evaluate = async () => null;
    await assert.rejects(
      () => captureSnapshot({ include_screenshot: false, _deps: { evaluate } }),
      /Could not read chart state/,
    );
  });
});
