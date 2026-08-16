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
  fetchScriptSource,
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
    assert.match(expression, /update existing|publish new version|open my script/);
    assert.match(expression, /body_fallback|isPineWizardText/);
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

describe('fetchScriptSource', () => {
  const SRC = '//@version=6\nlibrary("RSIZones")\nexport f() => 1';

  it('returns the first non-empty source payload', async () => {
    const r = await fetchScriptSource('USER;abc', '6.0', {
      evaluateAsync: async () => ({ ok: true, source: SRC, via: 'GET /get/id/version', attempted: ['GET /get/id/version'] }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, SRC);
    assert.equal(r.via, 'GET /get/id/version');
  });

  it('reports not-ok when no endpoint yields source', async () => {
    const r = await fetchScriptSource('USER;abc', null, {
      evaluateAsync: async () => ({ ok: false, source: null, via: null, attempted: ['GET /get/id', 'GET /get/?script_id_part'] }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.source, null);
    assert.deepEqual(r.attempted, ['GET /get/id', 'GET /get/?script_id_part']);
  });

  it('targets the facade /get/<id>/<version> endpoint and reads the source key', async () => {
    let expression = '';
    await fetchScriptSource('USER;xyz123', '6.0', {
      evaluateAsync: async (expr) => { expression = expr; return { ok: true, source: SRC, via: 'GET /get/id/version', attempted: [] }; },
    });
    assert.match(expression, /USER;xyz123/);
    assert.match(expression, /6\.0/);
    assert.match(expression, /\/get\//);
    assert.match(expression, /j\.source \|\| j\.scriptSource/);
    assert.match(expression, /src\.length > 0/);
  });

  it('requires a scriptIdPart', async () => {
    await assert.rejects(() => fetchScriptSource('', null, { evaluateAsync: async () => ({}) }), /scriptIdPart is required/);
  });
});

describe('readScript (core)', () => {
  it('requires name or script_id', async () => {
    const { readScript } = await import('../src/core/pine.js');
    await assert.rejects(() => readScript({}), /name or script_id is required/);
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
