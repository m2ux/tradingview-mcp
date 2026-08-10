/**
 * Unit tests for tab-targeted reads (issue #13).
 * Pure unit (mocked fetch / CDP eval) — no TradingView Desktop required.
 *
 * Run: node --test tests/target_reads.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findTargetByRef, isTransientCdpError } from '../src/connection.js';
import { getStudySeries, getStudyValues, getOhlcv, getQuote } from '../src/core/data.js';
import { getState } from '../src/core/chart.js';
import { captureScreenshot } from '../src/core/capture.js';
import { readFileSync, existsSync, rmSync } from 'fs';

const TARGETS = [
  { id: 'T1', type: 'page', title: 'Chart A', url: 'https://www.tradingview.com/chart/od9I4OCz/?symbol=ES1' },
  { id: 'T2', type: 'page', title: 'Chart B', url: 'https://www.tradingview.com/chart/abc12345/?symbol=NQ1' },
  { id: 'SH', type: 'page', title: 'shell', url: 'app://-/window/index.html' },
];

function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => TARGETS });
  return () => { globalThis.fetch = original; };
}

describe('findTargetByRef()', () => {
  let restore;
  beforeEach(() => { restore = stubFetch(); });
  afterEach(() => { restore(); });

  it('resolves a raw CDP target id', async () => {
    const t = await findTargetByRef('T2');
    assert.equal(t.id, 'T2');
  });

  it('resolves a chart_id from the URL segment', async () => {
    const t = await findTargetByRef('od9I4OCz');
    assert.equal(t.id, 'T1');
  });

  it('resolves a URL substring', async () => {
    const t = await findTargetByRef('abc12345');
    assert.equal(t.id, 'T2');
  });

  it('returns null for a falsy ref', async () => {
    assert.equal(await findTargetByRef(null), null);
    assert.equal(await findTargetByRef(''), null);
  });

  it('throws a clear error when nothing matches', async () => {
    await assert.rejects(() => findTargetByRef('nope'), /No open chart tab matches target "nope"/);
  });
});

describe('isTransientCdpError()', () => {
  it('flags socket-close / busy signatures as transient', () => {
    for (const msg of [
      'WebSocket is not open: readyState 3 (CLOSED)',
      'Target closed',
      'Connection closed',
      'fetch failed',
      'read ECONNRESET',
    ]) {
      assert.equal(isTransientCdpError(new Error(msg)), true, msg);
    }
  });

  it('does not flag genuine JS / logic errors', () => {
    for (const msg of [
      'JS evaluation error: SyntaxError: Unexpected identifier',
      'No open chart tab matches target "x"',
      'Study not found.',
      'symbol is required',
    ]) {
      assert.equal(isTransientCdpError(new Error(msg)), false, msg);
    }
  });
});

// --- scoped reads honor an injected _deps.evaluate (target plumbing) ---

const seriesPage = {
  found: true, study: 'RSI Zone Divergence', entity_id: 'e1', plot_ids: ['plot_0'],
  bar_count: 1, total_available: 10, bars: [{ time: 1000, plots: { plot_0: 1.5 } }], price: null,
};

function depsReturning(raw) {
  const calls = [];
  const evaluate = async (expr) => { calls.push(expr); return raw; };
  evaluate.calls = calls;
  return { _deps: { evaluate }, evaluate };
}

describe('targeted reads — _deps.evaluate plumbing', () => {
  it('getStudySeries prefers _deps.evaluate (the scoped path)', async () => {
    const { _deps, evaluate } = depsReturning(seriesPage);
    const res = await getStudySeries({ study: 'RSI', _deps });
    assert.equal(res.success, true);
    assert.equal(evaluate.calls.length, 1);
  });

  it('getStudyValues uses _deps.evaluate', async () => {
    const { _deps, evaluate } = depsReturning([]);
    const res = await getStudyValues({ _deps });
    assert.equal(res.success, true);
    assert.equal(evaluate.calls.length, 1);
  });

  it('getOhlcv uses _deps.evaluate', async () => {
    const page = { bars: [{ time: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 5 }], total_bars: 1, source: 'direct_bars' };
    const { _deps, evaluate } = depsReturning(page);
    const res = await getOhlcv({ _deps });
    assert.equal(res.success, true);
    assert.equal(evaluate.calls.length, 1);
  });

  it('chart getState uses _deps.evaluate', async () => {
    const page = { symbol: 'ES1!', resolution: '60', chartType: 1, studies: [] };
    const { _deps, evaluate } = depsReturning(page);
    const res = await getState({ _deps });
    assert.equal(res.symbol, 'ES1!');
    assert.equal(evaluate.calls.length, 1);
  });
});

// --- getQuote targeted symbol switch + restore ---

describe('getQuote() — targeted symbol switch + restore', () => {
  // Drives the quote flow: current symbol, a quote payload, and records the
  // setSymbol() calls made during the brief switch + restore.
  function quoteDeps({ currentSymbol = 'ES1!', quote = { symbol: 'NQ1!', last: 21000, close: 21000 } } = {}) {
    const evalCalls = [];
    const asyncCalls = [];
    const setSymbolArgs = [];
    const evaluate = async (expr) => {
      evalCalls.push(expr);
      // The current-symbol probe is a bare `<CHART_API>.symbol()` expression.
      if (expr.trim().endsWith('.symbol()') && !expr.includes('function')) return currentSymbol;
      // The main quote read (an IIFE) returns the full quote payload.
      return quote;
    };
    const evaluateAsync = async (expr) => {
      asyncCalls.push(expr);
      const m = expr.match(/setSymbol\((".*?")/);
      if (m) setSymbolArgs.push(JSON.parse(m[1]));
      return undefined;
    };
    const waitForChartReady = async () => true;
    return { _deps: { evaluate, evaluateAsync, waitForChartReady }, evalCalls, asyncCalls, setSymbolArgs };
  }

  it('switches to the requested symbol then restores the original', async () => {
    const { _deps, setSymbolArgs } = quoteDeps({ currentSymbol: 'ES1!' });
    const res = await getQuote({ symbol: 'NQ1!', _deps });
    assert.equal(res.success, true);
    // First the requested symbol, then the restore to the original.
    assert.deepEqual(setSymbolArgs, ['NQ1!', 'ES1!']);
  });

  it('does not switch when the chart already shows the requested symbol', async () => {
    const { _deps, setSymbolArgs, asyncCalls } = quoteDeps({ currentSymbol: 'ES1!' });
    await getQuote({ symbol: 'ES1!', _deps });
    assert.deepEqual(setSymbolArgs, []);
    assert.equal(asyncCalls.length, 0);
  });

  it('reads the current chart symbol when no symbol is given', async () => {
    const { _deps, setSymbolArgs } = quoteDeps({ currentSymbol: 'ES1!', quote: { symbol: 'ES1!', last: 5000, close: 5000 } });
    const res = await getQuote({ _deps });
    assert.equal(res.success, true);
    assert.deepEqual(setSymbolArgs, []);
  });
});

// --- captureScreenshot({ target }) targeted capture ---

describe('captureScreenshot({ target })', () => {
  const targetId = 'T1';
  function stubFetchForTarget() {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/json/list')) {
        return { json: async () => [{ id: targetId, type: 'page', url: 'https://www.tradingview.com/chart/od9I4OCz/?symbol=ES1' }] };
      }
      return original(url);
    };
    return () => { globalThis.fetch = original; };
  }

  function makeScopedSpy(pngB64) {
    const calls = { evaluated: [], shots: [] };
    const client = {
      Runtime: { evaluate: async ({ expression }) => { calls.evaluated.push(expression); return { result: { value: null } }; } },
      Page: { captureScreenshot: async (params) => { calls.shots.push(params); return { data: pngB64 }; }, enable: async () => {} },
      close: async () => {},
    };
    return { client, calls };
  }

  it('captures from the targeted tab via a scoped client and writes the file', async (t) => {
    const restore = stubFetchForTarget();
    const png = Buffer.from('fake-png-target').toString('base64');
    const { client, calls } = makeScopedSpy(png);
    const fname = `test_target_capture_${Date.now()}`;
    const path = (await import('path')).join(process.cwd(), 'screenshots', `${fname}.png`);
    try {
      const res = await captureScreenshot({
        region: 'full', filename: fname, target: 'od9I4OCz',
        _deps: { makeScopedClient: async (tid) => { assert.equal(tid, targetId); return client; } },
      });
      assert.equal(res.success, true);
      assert.equal(res.chart_id, 'od9I4OCz');
      assert.equal(res.target, 'od9I4OCz');
      assert.equal(calls.shots.length, 1, 'one screenshot taken on the scoped client');
      assert.ok(existsSync(res.file_path), 'screenshot file written');
      assert.equal(readFileSync(res.file_path).toString(), 'fake-png-target');
    } finally {
      restore();
      if (existsSync(path)) rmSync(path);
    }
  });

  it('errors clearly when the target matches no open tab', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => [] });
    try {
      await assert.rejects(() => captureScreenshot({ target: 'nope', _deps: { makeScopedClient: async () => ({}) } }), /No open chart tab matches/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
