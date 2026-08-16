/**
 * Unit tests for drawFibChannel (no TradingView connection).
 * Run: node --test tests/draw_fib_channel.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawFibChannel,
  normalizeFibDirection,
  FIB_DIRECTION_SOURCES,
} from '../src/core/drawing.js';

const T1 = 1700000000;
const T2 = 1700003600;
const T3 = 1700007200;

const BARS = {
  [T1]: { time: T1, open: 80.2, high: 81.0, low: 79.5, close: 80.8 },
  [T2]: { time: T2, open: 82.0, high: 85.0, low: 81.5, close: 84.0 },
  [T3]: { time: T3, open: 80.0, high: 83.0, low: 78.0, close: 79.0 },
};

const TIMES_ONLY = {
  point: { time: T1 },
  point2: { time: T2 },
  point3: { time: T3 },
};

const EXPLICIT = {
  point: { time: T1, price: 80.5 },
  point2: { time: T2, price: 82.25 },
  point3: { time: T3, price: 79.0 },
};

const TEMPLATE_CONTENT = {
  linewidth: 2,
  levels: [{ coeff: 0 }, { coeff: 0.5 }, { coeff: 1 }],
};

function mockChart(opts = {}) {
  const names = opts.names ?? ['_Accel_T', '_Base_T', '_Decel_T'];
  const content = opts.content ?? TEMPLATE_CONTENT;
  const listOk = opts.listOk ?? true;
  const getOk = opts.getOk ?? true;
  const newId = opts.newId ?? 'PZ9yZF';
  const barMap = opts.bars ?? BARS;
  const calls = [];
  let created = false;

  const evaluate = async (expr) => {
    calls.push({ kind: 'evaluate', expr });
    if (expr.includes('drawFibChannel_lookupBars')) {
      const wantMatch = expr.match(/var want = (\[[^\]]*\])/);
      const want = wantMatch ? JSON.parse(wantMatch[1]) : [];
      const found = want.map((t) => barMap[t] || null);
      const missing = want.filter((t, i) => !found[i]);
      if (missing.length) {
        return { ok: false, error: `No loaded bar at time(s): ${missing.join(', ')}`, missing };
      }
      return { ok: true, bars: found };
    }
    if (expr.includes('getAllShapes')) {
      return created ? [newId] : [];
    }
    return undefined;
  };

  const evaluateAsync = async (expr) => {
    calls.push({ kind: 'evaluateAsync', expr });
    // Plural list path must be checked before the singular get path
    // (`/drawing-template/` is a substring of `/drawing-templates/`).
    if (expr.includes('/drawing-templates/')) {
      return listOk
        ? { ok: true, status: 200, names }
        : { ok: false, status: 404, error: 'list failed' };
    }
    if (expr.includes('/drawing-template/')) {
      return getOk
        ? { ok: true, status: 200, content }
        : { ok: false, status: 404, error: 'get failed' };
    }
    if (expr.includes('createMultipointShape')) {
      created = true;
      return newId;
    }
    return undefined;
  };

  return {
    calls,
    created: () => created,
    _deps: {
      evaluate,
      evaluateAsync,
      getChartApi: async () => 'window.__api',
    },
  };
}

function createCalls(mock) {
  return mock.calls.filter((c) => c.expr.includes('createMultipointShape'));
}

function lookupCalls(mock) {
  return mock.calls.filter((c) => c.expr.includes('drawFibChannel_lookupBars'));
}

describe('normalizeFibDirection', () => {
  it('accepts bullish/bearish and short aliases', () => {
    assert.equal(normalizeFibDirection('bullish'), 'bullish');
    assert.equal(normalizeFibDirection('BULL'), 'bullish');
    assert.equal(normalizeFibDirection('bearish'), 'bearish');
    assert.equal(normalizeFibDirection('bear'), 'bearish');
    assert.equal(normalizeFibDirection(''), null);
    assert.equal(normalizeFibDirection('sideways'), null);
  });

  it('maps L→H→L / H→L→H', () => {
    assert.deepEqual(FIB_DIRECTION_SOURCES.bullish, ['low', 'high', 'low']);
    assert.deepEqual(FIB_DIRECTION_SOURCES.bearish, ['high', 'low', 'high']);
  });
});

describe('drawFibChannel', () => {
  it('creates a fib_channel with three points and the fetched template content', async () => {
    const mock = mockChart();
    const result = await drawFibChannel({
      template: '_Accel_T',
      direction: 'bullish',
      ...EXPLICIT,
      _deps: mock._deps,
    });

    assert.equal(result.success, true);
    assert.equal(result.entity_id, 'PZ9yZF');
    assert.equal(result.template, '_Accel_T');
    assert.equal(result.direction, 'bullish');
    assert.deepEqual(result.sources, ['low', 'high', 'low']);
    assert.equal(result.points[0].price, 80.5);
    assert.equal(result.points[0].source, 'price');
    assert.equal(lookupCalls(mock).length, 0, 'explicit prices skip bar lookup');

    const created = createCalls(mock);
    assert.equal(created.length, 1, 'createMultipointShape called once');
    const expr = created[0].expr;
    assert.ok(expr.includes('"fib_channel"'), 'shape is fib_channel');
    assert.ok(expr.includes('1700000000') && expr.includes('80.5'), 'point 1 in call');
    assert.ok(expr.includes('1700003600') && expr.includes('82.25'), 'point 2 in call');
    assert.ok(expr.includes('1700007200') && expr.includes('79'), 'point 3 in call');
    assert.ok(
      expr.includes(JSON.stringify(TEMPLATE_CONTENT)),
      'template option equals fetched content',
    );
    assert.equal(created[0].kind, 'evaluateAsync', 'create uses evaluateAsync');
  });

  it('bullish time-only loci resolve L→H→L from OHLC', async () => {
    const mock = mockChart();
    const result = await drawFibChannel({
      template: '_Base_T',
      direction: 'bullish',
      ...TIMES_ONLY,
      _deps: mock._deps,
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.points.map((p) => p.source), ['low', 'high', 'low']);
    assert.equal(result.points[0].price, 79.5);
    assert.equal(result.points[1].price, 85.0);
    assert.equal(result.points[2].price, 78.0);
    assert.equal(lookupCalls(mock).length, 1);
    const expr = createCalls(mock)[0].expr;
    assert.ok(expr.includes('79.5') && expr.includes('85') && expr.includes('78'));
  });

  it('bearish time-only loci resolve H→L→H from OHLC', async () => {
    const mock = mockChart();
    const result = await drawFibChannel({
      template: '_Base_T',
      direction: 'bearish',
      ...TIMES_ONLY,
      _deps: mock._deps,
    });

    assert.equal(result.success, true);
    assert.equal(result.direction, 'bearish');
    assert.deepEqual(result.points.map((p) => p.source), ['high', 'low', 'high']);
    assert.equal(result.points[0].price, 81.0);
    assert.equal(result.points[1].price, 81.5);
    assert.equal(result.points[2].price, 83.0);
  });

  it('refuses when a locus time has no loaded bar', async () => {
    const mock = mockChart();
    const result = await drawFibChannel({
      template: '_Base_T',
      direction: 'bullish',
      point: { time: T1 },
      point2: { time: T2 },
      point3: { time: 111 },
      _deps: mock._deps,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /No loaded bar/);
    assert.equal(createCalls(mock).length, 0);
  });

  it('refuses a missing direction without creating', async () => {
    const mock = mockChart();
    const result = await drawFibChannel({
      template: '_Base_T',
      ...TIMES_ONLY,
      _deps: mock._deps,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /direction is required/);
    assert.equal(createCalls(mock).length, 0);
    assert.equal(lookupCalls(mock).length, 0);
  });

  it('accepts whichever LineToolFibChannel template name the caller passes', async () => {
    for (const name of ['_Base_T', '_Decel_T']) {
      const mock = mockChart();
      const result = await drawFibChannel({
        template: name,
        direction: 'bullish',
        ...EXPLICIT,
        _deps: mock._deps,
      });
      assert.equal(result.success, true, name);
      assert.equal(result.template, name);
      assert.equal(createCalls(mock).length, 1, name);
    }
  });

  it('refuses an unknown template name without creating a shape', async () => {
    const mock = mockChart({ names: ['_Base_T'] });
    const result = await drawFibChannel({
      template: 'Nope',
      direction: 'bullish',
      ...TIMES_ONLY,
      _deps: mock._deps,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /not found in \/drawing-templates\/LineToolFibChannel\//);
    assert.deepEqual(result.templates, ['_Base_T']);
    assert.equal(createCalls(mock).length, 0);
    assert.equal(mock.created(), false);
    assert.equal(lookupCalls(mock).length, 0, 'does not look up bars after a list miss');
  });

  it('refuses an empty template name without listing or creating', async () => {
    const mock = mockChart();
    const result = await drawFibChannel({
      template: '   ',
      direction: 'bullish',
      ...TIMES_ONLY,
      _deps: mock._deps,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /template is required/);
    assert.equal(mock.calls.length, 0);
  });

  it('returns success: false when the template list endpoint fails', async () => {
    const mock = mockChart({ listOk: false });
    const result = await drawFibChannel({
      template: '_Accel_T',
      direction: 'bullish',
      ...TIMES_ONLY,
      _deps: mock._deps,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /list failed/);
    assert.equal(createCalls(mock).length, 0);
  });

  it('validates point3.time with requireFinite before creating', async () => {
    const mock = mockChart();
    await assert.rejects(
      () => drawFibChannel({
        template: '_Accel_T',
        direction: 'bullish',
        ...EXPLICIT,
        point3: { time: NaN },
        _deps: mock._deps,
      }),
      /point3\.time must be a finite number/,
    );
    assert.equal(createCalls(mock).length, 0);
  });
});
