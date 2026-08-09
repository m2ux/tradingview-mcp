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
} from '../src/core/pine_ui.js';

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

describe('getEditorIdentity overlay preference', () => {
  it('prefers visible h2 and usable Monaco over zero-size docked ghost', async () => {
    const { getEditorIdentity } = await import('../src/core/pine_ui.js');
    let expression = '';
    await getEditorIdentity({
      evaluate: async (expr) => {
        expression = expr;
        return { name: 'TVSmokeLib', source: 'h2' };
      },
    });
    assert.match(expression, /querySelectorAll\('h2'\)/);
    assert.match(expression, /usableMonaco|querySelectorAll\('\.monaco-editor/);
    assert.match(expression, /function visible/);
    assert.match(expression, /querySelectorAll\('\.monaco-editor\.pine-editor-monaco'\)/);
  });
});

describe('getVisibleDialogs surface filter', () => {
  it('classifies publish wizard surfaces and excludes bare editor shells', async () => {
    let expression;
    await getVisibleDialogs({
      evaluate: async (value) => {
        expression = value;
        return [];
      },
    });
    assert.match(expression, /\[data-name="warning-dialog"\]/);
    assert.match(expression, /\[class~="js-dialog"\]/);
    assert.match(expression, /function isDialogSurface/);
    assert.match(expression, /publish private\|publish public/);
    assert.match(expression, /if \(!isDialogSurface\(dlg\)\) continue/);
    assert.match(expression, /hasVisibleNestedDialog/);
  });
});

describe('setSource script_name guard', () => {
  it('refuses when header identity differs', async () => {
    await assert.rejects(
      () => assertEditorIdentity('Target', { evaluate: async () => ({ name: 'Wrong' }) }),
      /Refuse Save\/Publish/,
    );
  });
});

describe('ensurePineEditorOpen overlay preference', () => {
  it('opens via pine-dialog-button before bottomWidgetBar docking', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/core/pine.js', import.meta.url), 'utf8'),
    );
    const ensureStart = src.indexOf('export async function ensurePineEditorOpen');
    assert.ok(ensureStart >= 0);
    const body = src.slice(ensureStart, ensureStart + 1800);
    const dialogBtn = body.indexOf('pine-dialog-button');
    const dockCall = body.indexOf('activateScriptEditorTab');
    assert.ok(dialogBtn >= 0, 'must target pine-dialog-button for overlay open');
    assert.ok(dockCall >= 0, 'docked fallback must remain');
    assert.ok(dialogBtn < dockCall, 'overlay open must come before docked bottomWidgetBar fallback');
    assert.match(body, /FIND_PINE_OVERLAY_READY|publish script/i);
  });

  it('scans all Monaco nodes instead of querySelector first-hit', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/core/pine.js', import.meta.url), 'utf8'),
    );
    assert.match(src, /querySelectorAll\('\.monaco-editor\.pine-editor-monaco'\)/);
    assert.match(src, /querySelectorAll\('\.monaco-editor'\)/);
    assert.match(src, /rect\.width >= 40 && rect\.height >= 40/);
  });
});
