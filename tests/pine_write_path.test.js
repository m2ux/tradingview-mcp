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
import { addToChart, save } from '../src/core/pine.js';

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
function saveDeps(script) {
  return {
    evaluate: async () => script.dialogHandled,
    ensurePineEditorOpen: async () => true,
    pressKey: async () => {},
    getEditorIdentity: async () => ({ name: script.name }),
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
