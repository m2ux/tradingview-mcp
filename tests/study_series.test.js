/**
 * Unit tests for getStudySeries result shaping.
 * Pure unit (mocked CDP eval) — no TradingView Desktop required.
 *
 * Run: node --test tests/study_series.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStudySeries } from '../src/core/data.js';

// Mock the page-context result that getStudySeries' evaluate() returns.
// `raw` mirrors the in-page payload: { found, study, entity_id, plot_ids,
// bar_count, total_available, bars:[{time, plots}], price? }.
function mockDeps(raw) {
  const calls = [];
  const evaluate = async (expr) => { calls.push(expr); return raw; };
  evaluate.calls = calls;
  return { _deps: { evaluate }, evaluate };
}

const basePage = {
  found: true,
  study: 'RSI Zone Divergence',
  entity_id: 'abc123',
  plot_ids: ['plot_0', 'plot_1'],
  bar_count: 3,
  total_available: 3139,
  bars: [
    { time: 1000, plots: { plot_0: 0, plot_1: 1 } },
    { time: 2000, plots: { plot_0: 2.123456789, plot_1: null } },
    { time: 3000, plots: { plot_0: null, plot_1: 3 } },
  ],
  price: null,
};

describe('getStudySeries() — result shaping', () => {
  it('returns rounded bars with plot ids mapped', async () => {
    const { _deps } = mockDeps(basePage);
    const res = await getStudySeries({ study: 'RSI', _deps });
    assert.equal(res.success, true);
    assert.equal(res.study, 'RSI Zone Divergence');
    assert.equal(res.bar_count, 3);
    assert.equal(res.total_available, 3139);
    assert.deepEqual(res.plot_ids, ['plot_0', 'plot_1']);
    // 8-dp rounding applied, null preserved
    assert.equal(res.bars[1].plots.plot_0, 2.12345679);
    assert.equal(res.bars[1].plots.plot_1, null);
  });

  it('summary mode returns per-plot stats instead of bars', async () => {
    const { _deps } = mockDeps(basePage);
    const res = await getStudySeries({ study: 'RSI', summary: true, _deps });
    assert.ok(!res.bars, 'no bars in summary mode');
    assert.deepEqual(res.summary.plot_0, { min: 0, max: 2.12345679, last: 2.12345679, non_null_count: 2 });
    assert.deepEqual(res.summary.plot_1, { min: 1, max: 3, last: 3, non_null_count: 2 });
  });

  it('summary handles an all-null plot without Infinity leakage', async () => {
    const page = { ...basePage, plot_ids: ['plot_0'], bars: [{ time: 1, plots: { plot_0: null } }] };
    const { _deps } = mockDeps(page);
    const res = await getStudySeries({ summary: true, _deps });
    assert.deepEqual(res.summary.plot_0, { min: null, max: null, last: null, non_null_count: 0 });
  });

  it('include_price passes the aligned price array through', async () => {
    const page = { ...basePage, price: [{ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] };
    const { _deps } = mockDeps(page);
    const res = await getStudySeries({ include_price: true, _deps });
    assert.equal(res.price.length, 1);
    assert.equal(res.price[0].close, 1.5);
  });

  it('omits price key when page returned none', async () => {
    const { _deps } = mockDeps(basePage);
    const res = await getStudySeries({ _deps });
    assert.ok(!('price' in res));
  });

  it('throws when the study is not found on chart', async () => {
    const { _deps } = mockDeps({ found: false, error: 'No study matching "ZZZ" on chart.' });
    await assert.rejects(() => getStudySeries({ study: 'ZZZ', _deps }), /No study matching/);
  });

  it('caps count at the shared TV_MAX_BARS ceiling (default 500) and sends it into the page JS', async () => {
    const { _deps, evaluate } = mockDeps(basePage);
    await getStudySeries({ count: 99999, _deps });
    assert.ok(evaluate.calls[0].includes('500'), 'maxBars interpolated as the 500 default');
  });

  it('interpolates the plots filter into the page JS', async () => {
    const { _deps, evaluate } = mockDeps(basePage);
    await getStudySeries({ plots: ['plot_1'], _deps });
    assert.ok(evaluate.calls[0].includes('["plot_1"]'), 'wantPlots serialized into JS');
  });
});
