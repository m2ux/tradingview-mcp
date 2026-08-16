/**
 * Unit tests for structured tool errors (TV_* codes) so a controlling agent can
 * pick the corrective tool programmatically instead of parsing message text.
 * Pure unit (mocked fetch / injected _deps) — no TradingView Desktop required.
 *
 * Run: node --test tests/structured_errors.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { TV_ERROR_CODES, ToolError, tvError } from '../src/core/err.js';
import { errorResult } from '../src/tools/_format.js';
import { findTargetByRef, getLayoutNameForTarget } from '../src/connection.js';
import * as dataCore from '../src/core/data.js';
import { layoutSwitch } from '../src/core/ui.js';

// ── taxonomy sanity ────────────────────────────────────────────────────────
describe('err.js taxonomy', () => {
  it('exposes a frozen code enum and a ToolError carrying code/hint/resolution', () => {
    assert.ok(Object.isFrozen(TV_ERROR_CODES));
    const e = tvError('TV_LAYOUT_NOT_FOUND', 'no layout', { hint: 'use layout_list', resolution: { by: 'layout', name: 'X' } });
    assert.ok(e instanceof Error && e instanceof ToolError);
    assert.equal(e.code, 'TV_LAYOUT_NOT_FOUND');
    assert.equal(e.hint, 'use layout_list');
    assert.deepEqual(e.resolution, { by: 'layout', name: 'X' });
  });
});

// ── errorResult forwards structured fields on non-retryable errors ─────────
describe('errorResult() — structured non-retryable errors reach the agent', () => {
  it('forwards code + hint + resolution', () => {
    const res = errorResult(tvError('TV_NO_STRATEGY', 'no strategy', { hint: 'add one', resolution: { by: 'strategy' } }));
    const p = JSON.parse(res.content[0].text);
    assert.equal(res.isError, true);
    assert.equal(p.success, false);
    assert.equal(p.code, 'TV_NO_STRATEGY');
    assert.equal(p.hint, 'add one');
    assert.deepEqual(p.resolution, { by: 'strategy' });
  });

  it('still marks transient busy errors retryable', () => {
    const err = new Error('WebSocket is not open: readyState 3 (CLOSED)');
    err.retryable = true;
    const res = errorResult(err);
    const p = JSON.parse(res.content[0].text);
    assert.equal(p.retryable, true);
    assert.equal(p.code, 'TV_CDP_BUSY');
    assert.match(p.hint, /wait ~1s/i);
  });
});

// ── target resolution structured errors ────────────────────────────────────
const NO_CHARTS_FETCH = async () => ({ json: async () => [] });

describe('target resolution — structured errors', () => {
  let restoreFetch, restoreProbe;
  beforeEach(() => {
    restoreFetch = (() => { const o = globalThis.fetch; globalThis.fetch = NO_CHARTS_FETCH; return () => { globalThis.fetch = o; }; })();
    restoreProbe = (() => { const o = getLayoutNameForTarget._probe; getLayoutNameForTarget._probe = async () => null; return () => { getLayoutNameForTarget._probe = o; }; })();
  });
  afterEach(() => { restoreFetch(); restoreProbe(); });

  it('layout: prefix yields TV_TAB_NOT_OPEN with a tab_new hint', async () => {
    await assert.rejects(() => findTargetByRef('layout:OIL_IG'), (e) => {
      assert.equal(e.code, 'TV_TAB_NOT_OPEN');
      assert.deepEqual(e.resolution, { by: 'layout', name: 'OIL_IG' });
      assert.match(e.hint, /tab_new/);
      return true;
    });
  });

  it('unmatched target yields TV_TARGET_NOT_FOUND with a tab_new hint', async () => {
    await assert.rejects(() => findTargetByRef('nope'), (e) => {
      assert.equal(e.code, 'TV_TARGET_NOT_FOUND');
      assert.match(e.hint, /tab_new/);
      return true;
    });
  });
});

// ── data reads: study / DOM / strategy structured errors ───────────────────
describe('data reads — structured errors', () => {
  it('getStudySeries surfaces TV_STUDY_NOT_FOUND with a chart_get_state hint', async () => {
    const _deps = { evaluate: async () => ({ found: false, error: 'Study not found.' }) };
    await assert.rejects(() => dataCore.getStudySeries({ study: 'RSI', _deps }), (e) => {
      assert.equal(e.code, 'TV_STUDY_NOT_FOUND');
      assert.match(e.hint, /chart_get_state/);
      return true;
    });
  });

  it('getDepth surfaces TV_DOM_NOT_OPEN with an open-panel hint', async () => {
    const _deps = { evaluate: async () => ({ found: false, error: 'DOM / Depth of Market panel not found.' }) };
    await assert.rejects(() => dataCore.getDepth({ _deps }), (e) => {
      assert.equal(e.code, 'TV_DOM_NOT_OPEN');
      assert.match(e.hint, /ui_open_panel|DOM/i);
      return true;
    });
  });

  it('strategy reads carry TV_NO_STRATEGY + hint inline when none is on the chart', () => {
    // getTrades/getStrategyResults return a success-shaped payload (never throw)
    // because ensureStrategyTesterReady runs a live evaluate first; we verify the
    // in-page branch emits the structured fields by importing the generated JS.
    // Assert the constant this branch uses carries the code via the shared source.
    const src = readFileSync(new URL('../src/core/data.js', import.meta.url), 'utf8');
    assert.match(src, /code: 'TV_NO_STRATEGY'/);
    assert.match(src, /hint: 'Add a strategy study/);
    assert.match(src, /error:.*NO_STRATEGY_ERROR/);
  });
});

// ── ui layout_switch structured error ──────────────────────────────────────
describe('ui layout_switch — structured error', () => {
  it('surfaces TV_LAYOUT_NOT_FOUND with a layout_list hint', async () => {
    // _deps.evaluateAsync returns the in-page "not found" resolution.
    const _deps = {
      evaluateAsync: async () => ({ success: false, error: 'Layout "Nope" not found.', source: 'internal_api' }),
      evaluate: async () => false,
    };
    await assert.rejects(() => layoutSwitch({ name: 'Nope', _deps }), (e) => {
      assert.equal(e.code, 'TV_LAYOUT_NOT_FOUND');
      assert.deepEqual(e.resolution, { by: 'layout', name: 'Nope' });
      assert.match(e.hint, /layout_list/);
      return true;
    });
  });
});
