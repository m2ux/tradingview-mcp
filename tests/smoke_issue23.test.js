/**
 * Smoke test for issue #23 — run against a LIVE TradingView Desktop instance
 * (CDP on port 9222). Skips gracefully when nothing is listening.
 *
 * Covers the three acceptance criteria:
 *   1. tab_list exposes a layout name per chart tab (title → tab resolvable)
 *   2. a read/capture tool resolves a chart by layout/tab name (target 'OIL_IG')
 *   3. layout_list reports live symbol/resolution for the current layout
 *
 * This exercises the real CDP path (fetch /json/list + per-tab probe +
 * findTargetByRef), NOT a stub — so it validates the actual TradingView wiring.
 * It imports the core modules directly; the MCP server process does NOT need to
 * be running for this test.
 *
 * Run: node --test tests/smoke_issue23.test.js
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const CDP = `http://${process.env.TV_CDP_HOST || '127.0.0.1'}:${process.env.TV_CDP_PORT || 9222}`;

async function cdpUp() {
  try {
    const res = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function firstChartTarget() {
  const res = await fetch(`${CDP}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url || '')) || null;
}

describe('issue #23 smoke — live TradingView', () => {
  let ok = false;
  let mod, tabCore, uiCore, chartCore;

  before(async () => {
    ok = await cdpUp();
    if (!ok) return;
    mod = await import('../src/connection.js');
    tabCore = await import('../src/core/tab.js');
    uiCore = await import('../src/core/ui.js');
    chartCore = await import('../src/core/chart.js');
  });

  it('tab_list exposes a resolvable layout/tab identity per chart tab', async (t) => {
    if (!ok) return t.skip('TradingView not running on CDP 9222');
    const res = await tabCore.list();
    assert.equal(res.success, true);
    assert.ok(res.tab_count >= 1, 'at least one chart tab open');
    const charts = res.tabs.filter((x) => x.is_chart);
    assert.ok(charts.length >= 1, 'has a chart tab');
    for (const tab of charts) {
      assert.ok(tab.chart_id, `tab ${tab.id} has a chart_id`);
      // layout_name may be null on builds without currentChart(); the cleaned
      // title is the fallback a name-target resolves against. At least one
      // identity (layout_name or a non-empty title) must exist to resolve by name.
      const identity = tab.layout_name || tab.title;
      assert.ok(identity && String(identity).length > 0, `tab ${tab.chart_id} has a resolvable name`);
    }
  });

  it('read tool resolves a chart by layout/tab name (target)', async (t) => {
    if (!ok) return t.skip('TradingView not running on CDP 9222');
    // Find a name to target: prefer a live layout_name, else the tab title.
    const res = await tabCore.list();
    const tab = res.tabs.find((x) => x.is_chart && (x.layout_name || x.title));
    assert.ok(tab, 'need at least one chart tab with a name to target');
    const name = tab.layout_name || tab.title.trim();
    assert.ok(name, 'need a non-empty name to target');

    // findTargetByRef must resolve that name to the right chart target.
    const target = await mod.findTargetByRef(name);
    assert.equal(
      target.url.match(/\/chart\/([^/?]+)/)?.[1] || target.url,
      tab.chart_id,
      `name "${name}" resolves to its own chart tab`,
    );

    // And chart_get_state honors it (the real read path).
    const state = await chartCore.getState({ target: name });
    assert.equal(state.success, true);
    assert.ok(state.symbol, 'chart_get_state returns a symbol for the targeted tab');
  });

  it('layout: prefix forces layout-name matching and never aliases a chart_id', async (t) => {
    if (!ok) return t.skip('TradingView not running on CDP 9222');
    // A bare chart_id must NOT be matched by the layout: prefix.
    const chartTarget = await firstChartTarget();
    assert.ok(chartTarget, 'no chart target');
    const chartId = chartTarget.url.match(/\/chart\/([^/?]+)/)?.[1];
    assert.ok(chartId, 'chart_id parsed from URL');
    await assert.rejects(
      () => mod.findTargetByRef(`layout:${chartId}`),
      /No open chart tab showing layout/,
      'layout:<chart_id> must not resolve (prefix is name-only)',
    );
  });

  it('layout_list reports live, not stale, symbol/resolution for the current layout', async (t) => {
    if (!ok) return t.skip('TradingView not running on CDP 9222');
    const layouts = await uiCore.layoutList();
    assert.equal(layouts.success, true);
    assert.ok(Array.isArray(layouts.layouts));
    const current = layouts.layouts.find((l) => l.is_current);
    if (!current) return t.skip('no layout flagged current (cannot verify live symbol against it)');
    // Cross-check against the live chart state.
    const state = await chartCore.getState({});
    assert.equal(
      current.symbol,
      state.symbol,
      `current layout symbol (${current.symbol}) matches live chart symbol (${state.symbol})`,
    );
    assert.equal(
      String(current.resolution),
      String(state.resolution),
      `current layout resolution (${current.resolution}) matches live chart resolution (${state.resolution})`,
    );
  });
});
