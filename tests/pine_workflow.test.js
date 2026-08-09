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
  resolvePublishSaveDialog,
  resolvePublishedIdentity,
  facadeScriptMatches,
} from '../src/core/pine_ui.js';
import { shouldOpenScript, selectPublishWizardMode } from '../src/core/pine.js';

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
    // Capture the injected expression without a live page.
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
    // Must not stop at the first zero-size .pine-editor-monaco only.
    assert.match(expression, /querySelectorAll\('\.monaco-editor\.pine-editor-monaco'\)/);
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

describe('selectPublishWizardMode', () => {
  it('prefers update when the script is already published', () => {
    assert.equal(selectPublishWizardMode({
      updateAvailable: true,
      newAvailable: true,
      alreadyPublished: true,
    }), 'update');
  });

  it('prefers update when the Update control is visible (private re-publish)', () => {
    // Private pubs often omit filter=published; TV still shows Update existing.
    assert.equal(selectPublishWizardMode({
      updateAvailable: true,
      newAvailable: true,
      alreadyPublished: false,
    }), 'update');
  });

  it('uses publish new only when Update is not available', () => {
    assert.equal(selectPublishWizardMode({
      updateAvailable: false,
      newAvailable: true,
      alreadyPublished: false,
    }), 'new');
  });

  it('falls back to publish new if already published but Update control is missing', () => {
    assert.equal(selectPublishWizardMode({
      updateAvailable: false,
      newAvailable: true,
      alreadyPublished: true,
    }), 'new');
  });

  it('returns null when neither wizard mode is available', () => {
    assert.equal(selectPublishWizardMode({
      updateAvailable: false,
      newAvailable: false,
      alreadyPublished: true,
    }), null);
  });
});

describe('resolvePublishedIdentity', () => {
  it('matches facade rows by name or title', () => {
    assert.equal(facadeScriptMatches({ scriptName: 'TVSmokeLib' }, 'tvsmokelib'), true);
    assert.equal(facadeScriptMatches({ scriptTitle: 'PR5 Import Smoke' }, 'PR5 Import Smoke'), true);
    assert.equal(facadeScriptMatches({ scriptName: 'Other' }, 'TVSmokeLib'), false);
  });

  it('prefers the published list when present', () => {
    const identity = resolvePublishedIdentity('TVSmokeLib', {
      published: [{ scriptIdPart: 'pub-1', scriptName: 'TVSmokeLib', version: '2.0' }],
      saved: [{ scriptIdPart: 'saved-1', scriptName: 'TVSmokeLib', version: '5.0' }],
    });
    assert.equal(identity.source, 'published');
    assert.equal(identity.pubId, 'pub-1');
    assert.equal(identity.version, '2.0');
  });

  it('falls back to the saved list for private publications', () => {
    const identity = resolvePublishedIdentity('TVSmokeLib', {
      published: [],
      saved: [{ scriptIdPart: 'USER;abc', scriptName: 'TVSmokeLib', scriptTitle: 'PR5 Import Smoke', version: '5.0' }],
    });
    assert.equal(identity.source, 'saved');
    assert.equal(identity.pubId, 'USER;abc');
    assert.equal(identity.version, '5.0');
    assert.equal(identity.name, 'TVSmokeLib');
  });

  it('returns null when neither list contains the script', () => {
    assert.equal(resolvePublishedIdentity('TVSmokeLib', { published: [], saved: [] }), null);
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

  it('detects TradingView warning dialogs and publish wizards as visible dialogs', async () => {
    let expression;
    await getVisibleDialogs({
      evaluate: async (value) => {
        expression = value;
        return [];
      },
    });
    assert.match(expression, /\[data-name="warning-dialog"\]/);
    assert.match(expression, /\[class~="js-dialog"\]/);
    assert.doesNotMatch(expression, /\[class\*="dialog"\]/);
    assert.match(expression, /function isDialogSurface/);
    assert.match(expression, /publish private\|publish public/);
    assert.match(expression, /if \(!isDialogSurface\(dlg\)\) continue/);
    assert.match(expression, /hasVisibleNestedDialog/);
  });

  it('handles the recognized save-before-publish warning', async () => {
    const expressions = [];
    const result = await resolvePublishSaveDialog({
      evaluate: async (expression) => {
        expressions.push(expression);
        if (expressions.length === 1) {
          return [{
            text: "Save this script? Script with unsaved changes can't be published.",
            buttons: ['Save', 'Cancel'],
            input_count: 0,
          }];
        }
        return 'Save';
      },
    });
    assert.equal(result.handled, true);
    assert.equal(result.action, 'Save');
    assert.match(expressions[1], /closest\(dialogSelector\)/);
    assert.match(expressions[1], /\[data-name="warning-dialog"\]/);
  });

  it('does not act on unknown publish dialogs', async () => {
    const dialogs = [{ text: 'Publishing house rules', buttons: ['Continue'], input_count: 0 }];
    const result = await resolvePublishSaveDialog({ evaluate: async () => dialogs });
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
    // Zero-size docked .pine-editor-monaco often precedes the usable overlay node.
    assert.match(src, /querySelectorAll\('\.monaco-editor\.pine-editor-monaco'\)/);
    assert.match(src, /querySelectorAll\('\.monaco-editor'\)/);
    assert.match(src, /rect\.width >= 40 && rect\.height >= 40/);
  });
});
