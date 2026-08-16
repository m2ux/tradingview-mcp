/**
 * Unit tests for issue #23 — resolve a chart tab by its layout/tab name for
 * read + capture tools, expose layout_name in tab_list, and make layout_list
 * report live (not stale) symbol/resolution for the current layout.
 * Pure unit (mocked fetch / CDP) — no TradingView Desktop required.
 *
 * Run: node --test tests/issue23_layout_target.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findTargetByRef, getLayoutNameForTarget } from '../src/connection.js';
import { layoutList } from '../src/core/ui.js';
import { list as tabList } from '../src/core/tab.js';

const TARGETS = [
  { id: 'T1', type: 'page', title: 'OIL_IG — TradingView', url: 'https://www.tradingview.com/chart/od9I4OCz/?symbol=TVC%3AUKOIL' },
  { id: 'T2', type: 'page', title: 'GOLD — TradingView', url: 'https://www.tradingview.com/chart/abc12345/?symbol=OANDA%3AXAUUSD' },
  { id: 'SH', type: 'page', title: 'shell', url: 'app://-/window/index.html' },
];

// Map of targetId -> layout name the live probe returns.
const LAYOUTS = { T1: 'OIL_IG', T2: 'GOLD' };

function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => TARGETS });
  return () => { globalThis.fetch = original; };
}

function stubProbe() {
  const original = getLayoutNameForTarget._probe;
  getLayoutNameForTarget._probe = async (id) => LAYOUTS[id] ?? null;
  return () => { getLayoutNameForTarget._probe = original; };
}

describe('findTargetByRef() — layout/tab name resolution', () => {
  let restoreFetch, restoreProbe;
  beforeEach(() => { restoreFetch = stubFetch(); restoreProbe = stubProbe(); });
  afterEach(() => { restoreFetch(); restoreProbe(); });

  it('resolves an exact layout name (case-insensitive)', async () => {
    assert.equal((await findTargetByRef('OIL_IG')).id, 'T1');
    assert.equal((await findTargetByRef('oil_ig')).id, 'T1');
  });

  it('resolves the layout: prefixed form', async () => {
    assert.equal((await findTargetByRef('layout:GOLD')).id, 'T2');
  });

  it('layout: prefix does not fall back to chart_id/URL matching', async () => {
    // "od9I4OCz" is T1's chart_id, but as a layout-name it matches nothing.
    await assert.rejects(() => findTargetByRef('layout:od9I4OCz'), /No open chart tab showing layout/);
  });

  it('resolves by tab title when no layout name matches', async () => {
    const t = await findTargetByRef('GOLD');
    assert.equal(t.id, 'T2');
  });

  it('resolves a unique substring of a layout name', async () => {
    assert.equal((await findTargetByRef('OIL')).id, 'T1');
  });

  it('still resolves chart_id and URL substring (no regression)', async () => {
    assert.equal((await findTargetByRef('od9I4OCz')).id, 'T1');
    assert.equal((await findTargetByRef('abc12345')).id, 'T2');
  });

  it('throws a clear error mentioning layout names when nothing matches', async () => {
    await assert.rejects(() => findTargetByRef('nope'), /layout names/);
  });
});

describe('tab_list() — layout_name enrichment', () => {
  let restoreFetch, restoreProbe;
  beforeEach(() => { restoreFetch = stubFetch(); restoreProbe = stubProbe(); });
  afterEach(() => { restoreFetch(); restoreProbe(); });

  it('exposes the live layout_name per chart tab so a title can be resolved', async () => {
    const res = await tabList();
    assert.equal(res.success, true);
    const t1 = res.tabs.find((t) => t.id === 'T1');
    const t2 = res.tabs.find((t) => t.id === 'T2');
    assert.equal(t1.layout_name, 'OIL_IG');
    assert.equal(t1.chart_id, 'od9I4OCz');
    assert.equal(t2.layout_name, 'GOLD');
  });
});

describe('layoutList() — live symbol/resolution for the current layout', () => {
  it('overwrites the stale saved symbol/resolution with the live chart values', async () => {
    // getSavedCharts returns stale symbol=CLSK for the open OIL_IG layout; the
    // live chart shows UKOIL. layoutList must report UKOIL and flag it current.
    // The injected evaluateAsync emulates the in-page merge: the page-side JS
    // reads live symbol+currentChart() and applies them to the matching row.
    const evaluateAsync = async () => ({
      source: 'internal_api',
      live: { name: 'OIL_IG', symbol: 'TVC:UKOIL', resolution: '30' },
      layouts: [
        { id: 1, name: 'OIL_IG', symbol: 'TVC:UKOIL', resolution: '30', is_current: true },
        { id: 2, name: 'GOLD', symbol: 'OANDA:XAUUSD', resolution: '60', is_current: false },
      ],
    });
    const res = await layoutList({ evaluateAsync });
    assert.equal(res.current_layout, 'OIL_IG');
    const cur = res.layouts.find((l) => l.name === 'OIL_IG');
    assert.equal(cur.symbol, 'TVC:UKOIL');
    assert.equal(cur.is_current, true);
    const other = res.layouts.find((l) => l.name === 'GOLD');
    assert.equal(other.symbol, 'OANDA:XAUUSD'); // untouched
    assert.equal(other.is_current, false);
  });

  it('surfaces a null current_layout when no chart is active', async () => {
    const evaluateAsync = async () => ({ source: 'internal_api', live: { name: null }, layouts: [] });
    const res = await layoutList({ evaluateAsync });
    assert.equal(res.current_layout, null);
    assert.equal(res.layout_count, 0);
  });
});

describe('not-on-an-open-tab errors — agent can open the tab and retry', () => {
  let restoreFetch, restoreProbe;
  beforeEach(() => { restoreFetch = stubFetch(); restoreProbe = stubProbe(); });
  afterEach(() => { restoreFetch(); restoreProbe(); });

  it('layout: prefix of a saved-but-closed layout carries TV_TAB_NOT_OPEN + a tab_new hint', async () => {
    await assert.rejects(
      () => findTargetByRef('layout:CLOSED_LAYOUT'),
      (err) => {
        assert.equal(err.code, 'TV_TAB_NOT_OPEN');
        assert.deepEqual(err.resolution, { by: 'layout', name: 'CLOSED_LAYOUT' });
        assert.match(err.hint, /tab_new\(\{ layout: "CLOSED_LAYOUT" \}\)/);
        return true;
      },
    );
  });

  it('plain unmatched target carries TV_TARGET_NOT_FOUND + a tab_new hint', async () => {
    await assert.rejects(
      () => findTargetByRef('NO_SUCH_THING'),
      (err) => {
        assert.equal(err.code, 'TV_TARGET_NOT_FOUND');
        assert.match(err.hint, /tab_new/);
        return true;
      },
    );
  });

  it('errorResult surfaces code + resolution + hint to the agent payload', async () => {
    const { errorResult } = await import('../src/tools/_format.js');
    let err;
    try { await findTargetByRef('layout:CLOSED_LAYOUT'); } catch (e) { err = e; }
    const res = errorResult(err);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(res.isError, true);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'TV_TAB_NOT_OPEN');
    assert.deepEqual(payload.resolution, { by: 'layout', name: 'CLOSED_LAYOUT' });
    assert.match(payload.hint, /tab_new/);
  });
});
