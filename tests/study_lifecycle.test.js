/**
 * Unit tests for the headless study-lifecycle core (issue #15):
 * studyAdd (chart.createStudy + id-diff) and studyRemove (chart.removeEntity
 * + gone-verification). Pure unit — a mocked evaluate simulates the chart's
 * getAllStudies() id list and records the mutation expressions dispatched.
 *
 * Run: node --test tests/study_lifecycle.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { studyAdd, studyRemove } from '../src/core/study.js';

// Simulate a chart whose study id list evolves as createStudy/removeEntity
// expressions are dispatched. `existing` is the initial id list.
function mockChart({ existing = [] } = {}) {
  const ids = [...existing];
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    if (/getAllStudies\(\)\.map/.test(expr)) return [...ids];
    if (/createStudy/.test(expr)) { ids.push('new_study_1'); return undefined; }
    if (/removeEntity(WithUndo)?\(/.test(expr)) {
      // entity id is bound to a local `var id = "..."` in the generated JS.
      const m = expr.match(/var id = "([^"]+)"/);
      const id = m && m[1];
      const i = ids.indexOf(id);
      if (i !== -1) ids.splice(i, 1);
      return undefined;
    }
    return undefined;
  };
  return { _deps: { evaluate }, calls, ids };
}

describe('studyAdd() — headless createStudy', () => {
  it('creates a study and returns the new entity_id from the id diff', async () => {
    const { _deps } = mockChart({ existing: ['aaa'] });
    const r = await studyAdd({ indicator: 'Relative Strength Index', _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'add');
    assert.equal(r.entity_id, 'new_study_1');
    assert.equal(r.new_study_count, 1);
  });

  it('dispatches createStudy with the full indicator name', async () => {
    const { _deps, calls } = mockChart();
    await studyAdd({ indicator: 'Bollinger Bands', _deps });
    const createCall = calls.find((c) => /createStudy/.test(c));
    assert.ok(createCall, 'a createStudy expression was dispatched');
    assert.ok(createCall.includes('"Bollinger Bands"'), 'full name interpolated');
  });

  it('omits the overlay arg when overlay is not given (default placement)', async () => {
    const { _deps, calls } = mockChart();
    await studyAdd({ indicator: 'Volume', _deps });
    const createCall = calls.find((c) => /createStudy/.test(c));
    assert.ok(/createStudy\("Volume"\)/.test(createCall), 'single-arg createStudy');
  });

  it('passes overlay=false for a pane study when requested', async () => {
    const { _deps, calls } = mockChart();
    await studyAdd({ indicator: 'Volume', overlay: false, _deps });
    const createCall = calls.find((c) => /createStudy/.test(c));
    assert.ok(/var overlay = false/.test(createCall), 'overlay bound to false');
    assert.ok(/createStudy\("Volume", overlay, false, \[\]\)/.test(createCall), 'overlay passed through to createStudy');
  });

  it('requires an indicator name', async () => {
    await assert.rejects(() => studyAdd({ _deps: mockChart()._deps }), /indicator name is required/);
  });

  it('reports success:false with a hint when no new id appears', async () => {
    // createStudy dispatched but the id list never changes (unknown name).
    const calls = [];
    const evaluate = async (expr) => {
      calls.push(expr);
      if (/getAllStudies\(\)\.map/.test(expr)) return [];
      return undefined; // createStudy no-op
    };
    const r = await studyAdd({ indicator: 'Not A Real Study', _deps: { evaluate } });
    assert.equal(r.success, false);
    assert.equal(r.entity_id, null);
    assert.match(r.note, /no new study id appeared/i);
  });
});

describe('studyRemove() — headless removeEntity', () => {
  it('removes an existing study and verifies it is gone', async () => {
    const { _deps } = mockChart({ existing: ['aaa', 'bbb'] });
    const r = await studyRemove({ entity_id: 'aaa', _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'remove');
    assert.equal(r.entity_id, 'aaa');
    assert.equal(r.removed, true);
  });

  it('dispatches removeEntity with undo disabled by default', async () => {
    const { _deps, calls } = mockChart({ existing: ['aaa'] });
    await studyRemove({ entity_id: 'aaa', _deps });
    const rm = calls.find((c) => /removeEntity/.test(c));
    assert.ok(/removeEntity\(id, \{ disableUndo: true \}\)/.test(rm), 'disableUndo remove');
    assert.ok(/var id = "aaa"/.test(rm), 'entity id bound');
  });

  it('routes through removeEntityWithUndo when undo:true', async () => {
    const { _deps, calls } = mockChart({ existing: ['aaa'] });
    await studyRemove({ entity_id: 'aaa', undo: true, _deps });
    const rm = calls.find((c) => /removeEntityWithUndo/.test(c));
    assert.ok(/removeEntityWithUndo\(id\)/.test(rm));
    assert.ok(/var id = "aaa"/.test(rm), 'entity id bound');
  });

  it('requires entity_id', async () => {
    await assert.rejects(() => studyRemove({ _deps: mockChart()._deps }), /entity_id is required/);
  });

  it('fails fast with a stale-id error when the study is not on the chart', async () => {
    const { _deps } = mockChart({ existing: ['bbb'] });
    const r = await studyRemove({ entity_id: 'aaa', _deps });
    assert.equal(r.success, false);
    assert.equal(r.removed, false);
    assert.match(r.error, /not on the chart/);
  });
});
