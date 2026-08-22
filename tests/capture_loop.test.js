/**
 * Unit tests for the capture-loop harness helpers (window pin, last-bar drop,
 * signal-set equality / missing / extra / tolerance). No live TradingView.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTime,
  applyWindow,
  signalKey,
  diffStudySeries,
} from '../scripts/lib/study_series_diff.mjs';

const plotIds = ['Long', 'Short'];

function row(time, plots, extra = {}) {
  return { time, iso: new Date(time * 1000).toISOString(), ...plots, ...extra };
}

function liveBar(time, plots) {
  return { time, plots };
}

describe('parseTime / applyWindow', () => {
  it('parses unix seconds and ISO timestamps', () => {
    assert.equal(parseTime(1761760800), 1761760800);
    assert.equal(parseTime('1761760800'), 1761760800);
    assert.equal(parseTime('2025-10-29T18:00:00.000Z'), 1761760800);
    assert.equal(parseTime(null), null);
  });

  it('pins an inclusive from/to window and drops the last bar', () => {
    const rows = [100, 200, 300, 400, 500].map((t) => row(t, { Long: 0 }));
    const pinned = applyWindow(rows, { from: 200, to: 400 });
    assert.deepEqual(pinned.map((r) => r.time), [200, 300, 400]);
    const dropped = applyWindow(pinned, { dropLast: true });
    assert.deepEqual(dropped.map((r) => r.time), [200, 300]);
  });
});

describe('signalKey / diffStudySeries', () => {
  it('treats matching signal sets as a pass', () => {
    const ref = {
      symbol: 'UKOIL',
      interval: '30',
      plot_ids: plotIds,
      rows: [
        row(100, { Long: 1, Short: 0 }),
        row(200, { Long: 0, Short: 0 }),
      ],
    };
    const live = {
      symbol: 'UKOIL',
      interval: '30',
      bars: [
        liveBar(100, { Long: 1, Short: 0 }),
        liveBar(200, { Long: 0, Short: 0 }),
      ],
    };
    const d = diffStudySeries({ ref, live, tol: 1e-6 });
    assert.equal(d.problems, 0);
    assert.equal(d.refSignals, 1);
    assert.equal(d.compared, 2);
    assert.equal(signalKey({ Long: 1, Short: 0 }, plotIds), 'Long');
  });

  it('flags missing, extra, side-change, and value drift beyond tolerance', () => {
    const ref = {
      plot_ids: plotIds,
      rows: [
        row(100, { Long: 1, Short: 0 }),
        row(200, { Long: 0, Short: 1 }),
        row(300, { Long: 2, Short: 0 }, { iso: '2025-01-01T00:00:00.000Z' }),
      ],
    };
    const live = {
      bars: [
        liveBar(100, { Long: 0, Short: 1 }),
        liveBar(300, { Long: 2.5, Short: 0 }),
        liveBar(400, { Long: 1, Short: 0 }),
      ],
    };
    const d = diffStudySeries({ ref, live, tol: 0.1 });
    assert.ok(d.notes.some((n) => n.includes('signal side changed')));
    assert.ok(d.notes.some((n) => n.includes('missing live signal')));
    assert.ok(d.notes.some((n) => n.includes('extra live signal')));
    assert.ok(d.notes.some((n) => n.includes('plot Long drift')));
    assert.ok(d.problems >= 4);
  });
});
