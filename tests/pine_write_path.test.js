/**
 * Unit tests for the typed Pine write path (issue #15C):
 *  - addToChart returns action added|updated|blocked_dialog and surfaces a
 *    blocking modal (e.g. "Save this script before adding?") as success:false
 *    instead of the old silent success:true.
 *  - save returns a verifiable saved identity {script_id, version, verified}.
 *
 * Pure unit — all page/facade/DOM seams are injected via _deps.
 *
 * Run: node --test tests/pine_write_path.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addToChart, save, extractDeclaredTitle } from '../src/core/pine.js';

// Build the _deps seam for addToChart. `script` drives the mocked page state:
//   { button, beforeCount, afterCount, preDialogs, postDialogs }
function addDeps(script) {
  const evaluate = async (expr) => {
    if (/Add to chart|Update on chart/.test(expr) && /querySelectorAll/.test(expr)) return script.button;
    return undefined;
  };
  let dialogCall = 0;
  return {
    evaluate,
    ensurePineEditorOpen: async () => true,
    studyCount: async () => script.counts.shift(),
    getVisibleDialogs: async () => (dialogCall++ === 0 ? script.preDialogs : script.postDialogs),
  };
}

const noDialogs = [];

describe('addToChart() — typed results', () => {
  it('reports action "added" when Add to chart grows the study count', async () => {
    const _deps = addDeps({ button: 'Add to chart', counts: [1, 2], preDialogs: noDialogs, postDialogs: noDialogs });
    const r = await addToChart({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'added');
    assert.equal(r.study_added, true);
  });

  it('reports action "updated" when Update on chart re-renders in place', async () => {
    const _deps = addDeps({ button: 'Update on chart', counts: [1, 1], preDialogs: noDialogs, postDialogs: noDialogs });
    const r = await addToChart({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'updated');
    assert.equal(r.study_added, false);
  });

  it('surfaces a pre-existing modal as blocked_dialog before clicking', async () => {
    const dlg = { text: 'Save this script before adding?', buttons: ['Save', 'Cancel'], input_count: 0 };
    const _deps = addDeps({ button: null, counts: [1, 1], preDialogs: [dlg], postDialogs: [dlg] });
    const r = await addToChart({ _deps });
    assert.equal(r.success, false);
    assert.equal(r.action, 'blocked_dialog');
    assert.equal(r.reason, 'save_before_add');
    assert.equal(r.dialog.text, dlg.text);
  });

  it('surfaces a post-click modal as blocked_dialog (save-before-add)', async () => {
    const dlg = { text: 'Do you want to save this script before adding to chart?', buttons: ['Save', "Don't save"], input_count: 0 };
    const _deps = addDeps({ button: 'Add to chart', counts: [1, 1], preDialogs: noDialogs, postDialogs: [dlg] });
    const r = await addToChart({ _deps });
    assert.equal(r.success, false);
    assert.equal(r.action, 'blocked_dialog');
    assert.equal(r.reason, 'save_before_add');
    assert.equal(r.button_clicked, 'Add to chart');
  });

  it('warns when Add was clicked but the count did not increase (duplicate avoided)', async () => {
    const _deps = addDeps({ button: 'Add to chart', counts: [2, 2], preDialogs: noDialogs, postDialogs: noDialogs });
    const r = await addToChart({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'added');
    assert.equal(r.study_added, false);
    assert.match(r.warning, /did not increase/);
  });
});

// Build the _deps seam for save. `script` drives identity + facade lookups.
// getEditorBufferInfo is injected as null (no readable buffer) so save() falls
// back to the version-bump heuristic — the path these tests exercise.
function saveDeps(script) {
  return {
    evaluate: async () => script.dialogHandled,
    ensurePineEditorOpen: async () => true,
    pressKey: async () => {},
    getEditorIdentity: async () => ({ name: script.name }),
    getEditorBufferInfo: async () => null,
    lookupFacadeScript: async () => {
      const e = script.entries.shift();
      if (!e) throw new Error('not found');
      return e;
    },
  };
}

describe('save() — verifiable saved identity', () => {
  it('returns script_id/version and verified=true when the version bumps', async () => {
    const _deps = saveDeps({
      name: 'RSI Zone Divergence',
      dialogHandled: false,
      entries: [
        { scriptIdPart: 'abc', version: 4, modified: true },   // before
        { scriptIdPart: 'abc', version: 5, modified: null },   // after
      ],
    });
    const r = await save({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'saved');
    assert.equal(r.script_id, 'abc');
    assert.equal(r.version, 5);
    assert.equal(r.verified, true);
  });

  it('marks verified=false and notes when the identity cannot be re-resolved', async () => {
    const _deps = saveDeps({
      name: 'Ghost',
      dialogHandled: false,
      entries: [null, null], // both facade lookups fail
    });
    const r = await save({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.verified, false);
    assert.match(r.note, /may not have persisted/);
  });

  it('reports saved_with_dialog when the name dialog was confirmed', async () => {
    const _deps = saveDeps({
      name: 'New Script',
      dialogHandled: true,
      entries: [null, { scriptIdPart: 'xyz', version: 1, modified: null }],
    });
    const r = await save({ _deps });
    assert.equal(r.action, 'saved_with_dialog');
    assert.equal(r.script_id, 'xyz');
    assert.equal(r.verified, true); // freshly created
  });
});

// save() with a readable buffer: verifies against the BUFFER's script, not the
// header name (issue #17 — the unbound-editor trap behind verified:false).
describe('save() — buffer-aware verification (issue #17)', () => {
  const BUFFER_SRC = '//@version=4\nstudy(title="Pin Bar RSI Divergence with Auto Fibonacci", shorttitle="PBI")\nplot(close)\n';

  it('verifies by re-fetching the buffer script source and matching the buffer', async () => {
    const _deps = {
      evaluate: async () => false,
      ensurePineEditorOpen: async () => true,
      pressKey: async () => {},
      getEditorIdentity: async () => ({ name: 'Test_Script_1' }),
      getEditorBufferInfo: async () => ({ source: BUFFER_SRC, declared_title: 'Pin Bar RSI Divergence with Auto Fibonacci', char_count: BUFFER_SRC.length }),
      lookupFacadeScript: async ({ name, id } = {}) => {
        if (id === 'USER;test1' || name === 'Test_Script_1') return { scriptIdPart: 'USER;test1', scriptName: 'Test_Script_1', scriptTitle: 'Pin Bar RSI Divergence with Auto Fibonacci', version: '43.0', modified: 1673466816 };
        throw new Error('not found');
      },
      fetchScriptSource: async () => ({ ok: true, source: BUFFER_SRC, via: 'GET /get/id' }),
    };
    const r = await save({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.script_id, 'USER;test1');
    assert.equal(r.verified, true);
    assert.equal(r.persisted_matches_buffer, true);
    assert.equal(r.resolved_by, 'header_name');
    assert.equal(r.buffer_title, 'Pin Bar RSI Divergence with Auto Fibonacci');
  });

  it('flags bound_mismatch when header and buffer resolve to different scripts', async () => {
    const _deps = {
      evaluate: async () => false,
      ensurePineEditorOpen: async () => true,
      pressKey: async () => {},
      getEditorIdentity: async () => ({ name: 'RSIZoneDivUni' }),               // header
      getEditorBufferInfo: async () => ({ source: BUFFER_SRC, declared_title: 'Pin Bar RSI Divergence with Auto Fibonacci', char_count: BUFFER_SRC.length }), // buffer
      lookupFacadeScript: async ({ name, id } = {}) => {
        if (name === 'RSIZoneDivUni' || id === 'USER;rsi') return { scriptIdPart: 'USER;rsi', scriptName: 'RSIZoneDivUni', version: '2.0', modified: 1786459090 };
        if (name === 'Pin Bar RSI Divergence with Auto Fibonacci' || id === 'USER;test1') return { scriptIdPart: 'USER;test1', scriptName: 'Test_Script_1', scriptTitle: 'Pin Bar RSI Divergence with Auto Fibonacci', version: '43.0', modified: 1673466816 };
        throw new Error('not found');
      },
      fetchScriptSource: async () => ({ ok: false, source: null, via: null }),
    };
    const r = await save({ _deps });
    assert.equal(r.bound_mismatch, true);
    assert.match(r.warning, /bound to different scripts/);
  });
});

describe('extractDeclaredTitle', () => {
  it('reads indicator/strategy/library first-arg titles', () => {
    assert.equal(extractDeclaredTitle('//@version=6\nindicator("My Ind", overlay=true)'), 'My Ind');
    assert.equal(extractDeclaredTitle('strategy(\'My Strat\')'), 'My Strat');
    assert.equal(extractDeclaredTitle('library("MyLib")'), 'MyLib');
    assert.equal(extractDeclaredTitle('study(title="Pin Bar RSI Divergence", shorttitle="PBI")'), 'Pin Bar RSI Divergence');
    assert.equal(extractDeclaredTitle('plot(close)'), null);
    assert.equal(extractDeclaredTitle('not a string' && null), null);
  });
});
