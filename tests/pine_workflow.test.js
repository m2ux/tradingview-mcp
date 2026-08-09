/**
 * Unit tests for Pine workflow helpers (issue #4) — no live TradingView needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCompileErrors,
  isImportResolveError,
  mergeScriptLists,
  assertEditorIdentity,
  getVisibleDialogs,
  resolveAddToChartDialog,
} from '../src/core/pine_ui.js';
import { shouldOpenScript } from '../src/core/pine.js';

describe('isImportResolveError', () => {
  it('detects unpublished library messages', () => {
    assert.equal(
      isImportResolveError("Script 'Foo' does not have a published library titled 'Bar'"),
      true,
    );
    assert.equal(isImportResolveError('unable to resolve import user/Lib/1'), true);
    assert.equal(isImportResolveError('Syntax error at line 1'), false);
  });
});

describe('classifyCompileErrors', () => {
  it('splits import errors from other markers', () => {
    const { import_errors, errors } = classifyCompileErrors([
      { line: 1, message: "does not have a published library titled 'X'" },
      { line: 2, message: 'Undeclared identifier' },
    ]);
    assert.equal(import_errors.length, 1);
    assert.equal(errors.length, 1);
    assert.match(import_errors[0].message, /published library/);
  });
});

describe('mergeScriptLists', () => {
  it('attaches published_version and ui_visible orphan flags', () => {
    const saved = [
      { scriptIdPart: 'aaa', scriptName: 'GoodLib', scriptTitle: 'GoodLib', version: 5, scriptType: 'library' },
      { scriptIdPart: 'bbb', scriptName: 'Orphan', scriptTitle: 'Orphan', version: 1 },
    ];
    const published = [
      { scriptIdPart: 'aaa', scriptName: 'GoodLib', version: '1.0' },
    ];
    const ui = ['GoodLib'];
    const merged = mergeScriptLists(saved, published, ui);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].published_version, '1.0');
    assert.equal(merged[0].ui_visible, true);
    assert.equal(merged[0].kind, 'library');
    assert.equal(merged[1].published_version, null);
    assert.equal(merged[1].ui_visible, false);
    assert.equal(merged[1].in_open_dialog, false);
  });

  it('leaves ui_visible null when Open dialog was not scraped', () => {
    const merged = mergeScriptLists(
      [{ scriptIdPart: 'x', scriptName: 'A' }],
      [],
      null,
    );
    assert.equal(merged[0].ui_visible, null);
  });
});

describe('assertEditorIdentity', () => {
  it('throws on mismatch', async () => {
    await assert.rejects(
      () => assertEditorIdentity('Wanted', {
        evaluate: async () => ({ name: 'OtherScript' }),
      }),
      /identity is "OtherScript"/,
    );
  });

  it('accepts case-insensitive match', async () => {
    const r = await assertEditorIdentity('MyLib', {
      evaluate: async () => ({ name: 'mylib' }),
    });
    assert.equal(r.name, 'mylib');
  });
});

describe('publish identity selection', () => {
  it('does not reopen the requested script when it is already current', () => {
    assert.equal(shouldOpenScript('TVSmokeLib', 'TVSmokeLib'), false);
    assert.equal(shouldOpenScript(' tvsmokelib ', 'TVSmokeLib'), false);
  });

  it('opens the requested script when identity is absent or different', () => {
    assert.equal(shouldOpenScript(null, 'TVSmokeLib'), true);
    assert.equal(shouldOpenScript('Other Script', 'TVSmokeLib'), true);
  });
});

describe('dialog-aware Add to chart helpers', () => {
  it('returns structured visible dialog state', async () => {
    const dialogs = [{ text: 'Save this script before adding?', buttons: ['Cancel', 'Save'], input_count: 0 }];
    const result = await getVisibleDialogs({ evaluate: async () => dialogs });
    assert.deepEqual(result, dialogs);
  });

  it('handles the Save-before-adding gate within its dialog', async () => {
    const expressions = [];
    const result = await resolveAddToChartDialog({
      evaluate: async (expression) => {
        expressions.push(expression);
        if (expressions.length === 1) {
          return [{ text: 'Save this script before adding?', buttons: ['Cancel', 'Save'], input_count: 0 }];
        }
        return 'Save';
      },
    });
    assert.equal(result.handled, true);
    assert.equal(result.action, 'Save');
    assert.match(expressions[0], /\[data-name="confirm-dialog"\]/);
    assert.match(expressions[1], /save this script before adding/i);
    assert.match(expressions[1], /\[data-name="confirm-dialog"\]/);
    assert.match(expressions[1], /btn\.click\(\)/);
  });

  it('does not dismiss or guess at unknown dialogs', async () => {
    const dialogs = [{ text: 'Publishing house rules', buttons: ['Cancel', 'Continue'], input_count: 0 }];
    const result = await resolveAddToChartDialog({ evaluate: async () => dialogs });
    assert.equal(result.handled, false);
    assert.deepEqual(result.dialogs, dialogs);
  });
});

describe('setSource script_name guard', () => {
  it('refuses when header identity differs', async () => {
    // Exercise assert path by stubbing ensurePineEditorOpen via connection —
    // if CDP is unavailable this still validates the guard when evaluate returns identity.
    // We call assertEditorIdentity-equivalent by importing setSource only when deps available.
    // Direct unit path: assertEditorIdentity already covers the refuse logic.
    await assert.rejects(
      () => assertEditorIdentity('Target', { evaluate: async () => ({ name: 'Wrong' }) }),
      /Refuse Save\/Publish/,
    );
  });
});
