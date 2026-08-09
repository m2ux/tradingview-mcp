/**
 * Core Pine Script logic — shared between MCP tools and CLI.
 * All functions accept plain options objects and return plain JS objects.
 * They throw on error (callers catch and format).
 */
import { evaluate } from '../connection.js';
import { pressKey, setNativeValueExpression } from './dom.js';
import {
  assertEditorIdentity,
  classifyCompileErrors,
  clickVisibleButton,
  confirmReplaceIfNeeded,
  delay,
  fetchFacadeList,
  fillDialogInput,
  getEditorIdentity,
  getVisibleDialogs,
  isNameInOpenDialog,
  lookupFacadeScript,
  mergeScriptLists,
  openViaOpenDialog,
  resolveAddToChartDialog,
  resolvePublishSaveDialog,
  resolvePublishedIdentity,
  facadeScriptMatches,
  scrapeOpenDialogNames,
  studyCount,
} from './pine_ui.js';

// Monaco finder (injected into TV page) ──
// Note: TradingView's newer Pine editor (React 18+/createRoot) does not expose
// a __reactFiber$ backlink on the Monaco container, so fiber walking fails.
// Presence alone is not enough: a collapsed/zero-size Monaco is not usable.
const FIND_MONACO_CONTAINER = `
  (function() {
    var el = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    return (el.offsetParent !== null || el.getClientRects().length > 0)
      && rect.width >= 40 && rect.height >= 40;
  })()
`;
// Overlay mode exposes labeled Publish/Add controls. Docked bottom-panel Monaco is
// "open" but often icon-only, which breaks pine_add_to_chart / pine_publish.
const FIND_PINE_OVERLAY_READY = `
  (function() {
    var el = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (!((el.offsetParent !== null || el.getClientRects().length > 0)
      && rect.width >= 40 && rect.height >= 40)) return false;
    var btns = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.offsetParent === null && b.getClientRects().length === 0) continue;
      var t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')
        + ' ' + (b.getAttribute('title') || '')).replace(/\\s+/g, ' ').trim();
      if (/publish script/i.test(t) || /move overlay/i.test(t) || /^add to chart/i.test(t)
        || /^update on chart/i.test(t)) return true;
    }
    return false;
  })()
`;
const FIND_MONACO = `
  (function findMonacoEditor() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container;
    var fiberKey;
    for (var i = 0; i < 20; i++) {
      if (!el) break;
      fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var current = el[fiberKey];
    for (var d = 0; d < 15; d++) {
      if (!current) break;
      if (current.memoizedProps && current.memoizedProps.value && current.memoizedProps.value.monacoEnv) {
        var env = current.memoizedProps.value.monacoEnv;
        if (env.editor && typeof env.editor.getEditors === 'function') {
          var editors = env.editor.getEditors();
          if (editors.length > 0) return { editor: editors[0], env: env };
        }
      }
      current = current.return;
    }
    return null;
  })()
`;

/**
 * Opens the Pine Editor and waits for Monaco to become available.
 * Prefers the floating overlay (pine-dialog-button) over bottomWidgetBar docking:
 * docked panel mode hides labeled Publish/Add toolbar actions.
 * Returns true if editor is accessible, false on timeout.
 */
export async function ensurePineEditorOpen() {
  const overlayReady = await evaluate(FIND_PINE_OVERLAY_READY);
  if (overlayReady) return true;

  // Prefer overlay dialog open path — never dock first.
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluate(`
      (function() {
        var btn = document.querySelector('[data-name="pine-dialog-button"]')
          || document.querySelector('[aria-label="Pine"]');
        if (btn) btn.click();
      })()
    `);

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const ready = await evaluate(FIND_PINE_OVERLAY_READY);
      if (ready) return true;
      // Accept plain Monaco once overlay chrome is unlikely to appear this attempt.
      if (i >= 10) {
        const monacoOnly = await evaluate(FIND_MONACO_CONTAINER);
        if (monacoOnly) return true;
      }
    }
  }

  // Last resort: docked bottom panel (icon-only toolbar; weaker for smoke paths).
  for (let attempt = 0; attempt < 2; attempt++) {
    await evaluate(`
      (function() {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        if (bwb) {
          if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab();
          else if (typeof bwb.showWidget === 'function') bwb.showWidget('pine-editor');
        }
      })()
    `);
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200));
      const ready = await evaluate(FIND_MONACO_CONTAINER);
      if (ready) return true;
    }
  }
  return false;
}

// ── Pure / offline functions ──

export function analyze({ source }) {
  const lines = source.split('\n');
  const diagnostics = [];

  let isV6 = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//@version=6')) { isV6 = true; break; }
    if (trimmed.startsWith('//@version=')) break;
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    break;
  }

  const arrays = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromMatch = line.match(/(\w+)\s*=\s*array\.from\(([^)]*)\)/);
    if (fromMatch) {
      const name = fromMatch[1].trim();
      const args = fromMatch[2].trim();
      const size = args === '' ? 0 : args.split(',').length;
      arrays.set(name, { name, size, line: i + 1 });
      continue;
    }
    const newMatch = line.match(/(\w+)\s*=\s*array\.new(?:<\w+>|_\w+)\((\d+)?/);
    if (newMatch) {
      const name = newMatch[1].trim();
      const size = newMatch[2] !== undefined ? parseInt(newMatch[2], 10) : null;
      arrays.set(name, { name, size, line: i + 1 });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = /array\.(get|set)\(\s*(\w+)\s*,\s*(-?\d+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const method = match[1];
      const arrName = match[2];
      const idx = parseInt(match[3], 10);
      const info = arrays.get(arrName);
      if (!info || info.size === null) continue;
      if (idx < 0 || idx >= info.size) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `array.${method}(${arrName}, ${idx}) — index ${idx} out of bounds (array size is ${info.size})`,
          severity: 'error',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstLastPattern = /(\w+)\.(first|last)\(\)/g;
    let match;
    while ((match = firstLastPattern.exec(line)) !== null) {
      const arrName = match[1];
      if (arrName === 'array') continue;
      const info = arrays.get(arrName);
      if (info && info.size === 0) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `${arrName}.${match[2]}() called on possibly empty array (declared with size 0)`,
          severity: 'warning',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes('strategy.entry') || trimmed.includes('strategy.close')) {
      let hasStrategyDecl = false;
      for (const l of lines) {
        if (l.trim().startsWith('strategy(')) { hasStrategyDecl = true; break; }
      }
      if (!hasStrategyDecl) {
        diagnostics.push({
          line: i + 1, column: 1,
          message: 'strategy.entry/close used but no strategy() declaration found — did you mean to use indicator()?',
          severity: 'error',
        });
        break;
      }
    }
  }

  if (!isV6 && source.includes('//@version=')) {
    const vMatch = source.match(/\/\/@version=(\d+)/);
    if (vMatch && parseInt(vMatch[1]) < 5) {
      diagnostics.push({
        line: 1, column: 1,
        message: `Script uses Pine v${vMatch[1]} — consider upgrading to v6 for latest features`,
        severity: 'info',
      });
    }
  }

  return {
    success: true,
    issue_count: diagnostics.length,
    diagnostics,
    note: diagnostics.length === 0 ? 'No static analysis issues found. Use pine_compile or pine_smart_compile for full server-side compilation check.' : undefined,
  };
}

export async function check({ source, _deps } = {}) {
  const env = _deps?.env || process.env;
  const fetchFn = _deps?.fetch || fetch;
  // The compile check uploads Pine source to TradingView's facade — gate it
  // behind explicit operator opt-in so an agent can't exfiltrate source by
  // default.
  if (env.TV_ALLOW_PINE_CHECK_UPLOAD !== '1') {
    throw new Error('pine_check uploads source to TradingView\'s server and is disabled by default. Set TV_ALLOW_PINE_CHECK_UPLOAD=1 on the server process to allow it, or use pine_analyze for offline static analysis.');
  }

  const formData = new URLSearchParams();
  formData.append('source', source);

  const response = await fetchFn(
    'https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.tradingview.com/',
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`TradingView API returned ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  const errors = [];
  const warnings = [];
  const inner = result?.result;

  if (inner) {
    if (inner.errors2 && inner.errors2.length > 0) {
      for (const e of inner.errors2) {
        errors.push({
          line: e.start?.line, column: e.start?.column,
          end_line: e.end?.line, end_column: e.end?.column,
          message: e.message,
        });
      }
    }
    if (inner.warnings2 && inner.warnings2.length > 0) {
      for (const w of inner.warnings2) {
        warnings.push({ line: w.start?.line, column: w.start?.column, message: w.message });
      }
    }
  }

  if (result.error && typeof result.error === 'string') {
    errors.push({ message: result.error });
  }

  const compiled = errors.length === 0;
  return {
    success: true,
    compiled,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    note: compiled ? 'Pine Script compiled successfully.' : undefined,
  };
}

// ── Functions requiring TradingView connection ──

export async function getSource() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor or Monaco not found in React fiber tree.');

  const source = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `);

  if (source === null || source === undefined) {
    throw new Error('Monaco editor found but getValue() returned null.');
  }

  return { success: true, source, line_count: source.split('\n').length, char_count: source.length };
}

export async function setSource({ source, script_name } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  if (script_name) {
    await assertEditorIdentity(script_name);
  }

  const escaped = JSON.stringify(source);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco found but setValue() failed.');
  return {
    success: true,
    lines_set: source.split('\n').length,
    script_name: script_name || undefined,
  };
}

export async function compile() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const clicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var fallback = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!fallback && /^(Add to chart|Update on chart)/i.test(text)) {
          fallback = btns[i];
        }
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) {
          saveBtn = btns[i];
        }
      }
      if (fallback) { fallback.click(); return fallback.textContent.trim(); }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!clicked) {
    await pressKey('Enter', 2);
  }

  await new Promise(r => setTimeout(r, 2000));
  return { success: true, button_clicked: clicked || 'keyboard_shortcut', source: 'dom_fallback' };
}

export async function getErrors() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  return {
    success: true,
    has_errors: errors?.length > 0,
    error_count: errors?.length || 0,
    errors: errors || [],
  };
}

export async function save() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  await pressKey('s', 2);
  await new Promise(r => setTimeout(r, 800));

  // Handle "Save Script" name dialog that appears for new/unsaved scripts
  const dialogHandled = await evaluate(`
    (function() {
      var saveBtn = null;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (text === 'Save' && btns[i].offsetParent !== null) {
          // Check if it's in a dialog (not the Pine Editor save button)
          var parent = btns[i].closest('[class*="dialog"], [class*="modal"], [class*="popup"], [role="dialog"]');
          if (parent) { saveBtn = btns[i]; break; }
        }
      }
      if (saveBtn) { saveBtn.click(); return true; }
      return false;
    })()
  `);

  if (dialogHandled) await new Promise(r => setTimeout(r, 500));

  return { success: true, action: dialogHandled ? 'saved_with_dialog' : 'Ctrl+S_dispatched' };
}

export async function getConsole() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const entries = await evaluate(`
    (function() {
      var results = [];
      var rows = document.querySelectorAll('[class*="consoleRow"], [class*="log-"], [class*="consoleLine"]');
      if (rows.length === 0) {
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]')
          || document.querySelector('[class*="bottom-widgetbar-content"]');
        if (bottomArea) {
          rows = bottomArea.querySelectorAll('[class*="message"], [class*="log"], [class*="console"]');
        }
      }
      if (rows.length === 0) {
        var pinePanel = document.querySelector('.pine-editor-container')
          || document.querySelector('[class*="pine-editor"]')
          || document.querySelector('[class*="layout__area--bottom"]');
        if (pinePanel) {
          var allSpans = pinePanel.querySelectorAll('span, div');
          for (var s = 0; s < allSpans.length; s++) {
            var txt = allSpans[s].textContent.trim();
            if (/^\\d{2}:\\d{2}:\\d{2}/.test(txt) || /error|warning|info/i.test(allSpans[s].className)) {
              rows = Array.from(rows || []);
              rows.push(allSpans[s]);
            }
          }
        }
      }
      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].textContent.trim();
        if (!text) continue;
        var ts = null;
        var tsMatch = text.match(/^(\\d{4}-\\d{2}-\\d{2}\\s+)?\\d{2}:\\d{2}:\\d{2}/);
        if (tsMatch) ts = tsMatch[0];
        var type = 'info';
        var cls = rows[i].className || '';
        if (/error/i.test(cls) || /error/i.test(text.substring(0, 30))) type = 'error';
        else if (/compil/i.test(text.substring(0, 40))) type = 'compile';
        else if (/warn/i.test(cls)) type = 'warning';
        results.push({ timestamp: ts, type: type, message: text });
      }
      return results;
    })()
  `);

  return { success: true, entries: entries || [], entry_count: entries?.length || 0 };
}

export async function smartCompile({ require_published_imports = false } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const studiesBefore = await studyCount();

  const buttonClicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var addBtn = null;
      var updateBtn = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!addBtn && /^add to chart/i.test(text)) addBtn = btns[i];
        if (!updateBtn && /^update on chart/i.test(text)) updateBtn = btns[i];
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) saveBtn = btns[i];
      }
      if (addBtn) { addBtn.click(); return 'Add to chart'; }
      if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!buttonClicked) {
    await pressKey('Enter', 2);
  }

  await delay(2500);

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  const studiesAfter = await studyCount();
  const studyAdded = (studiesBefore !== null && studiesAfter !== null) ? studiesAfter > studiesBefore : null;
  const { import_errors, errors: otherErrors } = classifyCompileErrors(errors || []);
  const hasImportErrors = import_errors.length > 0;
  const success = !(require_published_imports && hasImportErrors);

  return {
    success,
    button_clicked: buttonClicked || 'keyboard_shortcut',
    has_errors: (errors?.length || 0) > 0,
    has_import_errors: hasImportErrors,
    import_errors,
    errors: otherErrors,
    all_errors: errors || [],
    study_added: studyAdded,
    require_published_imports: !!require_published_imports,
    error: success ? undefined : 'Import resolve failures detected (unpublished or missing libraries). Publish libraries first.',
  };
}

/**
 * Add / update the currently open Pine script on the active chart (toolbar).
 * Prefers "Add to chart" / "Update on chart" — not "Save and add…".
 */
export async function addToChart() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const dialogsBefore = await getVisibleDialogs();
  if (dialogsBefore.length > 0) {
    throw new Error(
      'Refusing Add to chart while a dialog is already open: '
      + dialogsBefore[dialogsBefore.length - 1].text,
    );
  }

  const before = await studyCount();
  let buttonClicked = null;
  for (let attempt = 0; attempt < 10 && !buttonClicked; attempt++) {
    buttonClicked = await evaluate(`
      (function() {
        var btns = document.querySelectorAll('button');
        var addBtn = null;
        var updateBtn = null;
        for (var i = 0; i < btns.length; i++) {
          var text = btns[i].textContent.trim();
          if (btns[i].offsetParent === null && btns[i].getClientRects().length === 0) continue;
          if (!addBtn && /^add to chart/i.test(text)) addBtn = btns[i];
          if (!updateBtn && /^update on chart/i.test(text)) updateBtn = btns[i];
        }
        if (addBtn) { addBtn.click(); return 'Add to chart'; }
        if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
        return null;
      })()
    `);
    if (!buttonClicked) await delay(200);
  }

  if (!buttonClicked) {
    throw new Error(
      'Add to chart / Update on chart button did not become visible in Pine toolbar within 2 seconds.',
    );
  }

  await delay(500);
  const gate = await resolveAddToChartDialog();
  await delay(1500);

  const dialogsAfter = await getVisibleDialogs();
  if (dialogsAfter.length > 0) {
    throw new Error(
      `Add to chart is blocked by an open dialog: ${dialogsAfter[dialogsAfter.length - 1].text}`,
    );
  }

  const after = await studyCount();
  const studyAdded = (before !== null && after !== null) ? after > before : null;
  const updated = /^Update on chart$/i.test(buttonClicked);

  if (!updated && studyAdded === false) {
    throw new Error(
      `TradingView accepted "${buttonClicked}" but the chart study count did not increase `
      + `(${before} before, ${after} after).`,
    );
  }

  return {
    success: true,
    button_clicked: buttonClicked,
    study_added: studyAdded,
    study_updated: updated,
    save_dialog_handled: gate.handled,
  };
}

export async function newScript({ type }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const typeMap = { indicator: 'indicator', strategy: 'strategy', library: 'library' };
  const templates = {
    indicator: '//@version=6\nindicator("My script")\nplot(close)',
    strategy: '//@version=6\nstrategy("My strategy", overlay=true)\n',
    library: '//@version=6\n// @description TODO: add library description here\nlibrary("MyLibrary")\n',
  };

  const template = templates[type] || templates.indicator;

  // Simply set the source to a new template — this is the most reliable approach
  const escaped = JSON.stringify(template);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco editor not found. Ensure Pine Editor is open.');

  return { success: true, type, action: 'new_script_created', template: typeMap[type] };
}

/**
 * Open a saved script by registered UI identity (Open script dialog).
 * Does NOT inject Monaco into the current buffer — Save/Publish target the opened script.
 */
export async function openScript({ name }) {
  if (!name || !String(name).trim()) throw new Error('Script name is required.');
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const wanted = String(name).trim();
  let facadeMeta = null;
  try {
    facadeMeta = await lookupFacadeScript({ name: wanted });
  } catch {
    // Open dialog may still find UI-registered scripts; continue.
  }

  const openedRes = await openViaOpenDialog(wanted);
  const selected = openedRes?.name || openedRes?.selected || wanted;
  const scriptIdPart = facadeMeta?.scriptIdPart || openedRes?.scriptIdPart || null;
  const version = facadeMeta?.version ?? null;

  if (!openedRes?.opened) {
    throw new Error(
      `Could not open "${wanted}" in the Pine editor (current: "${openedRes?.name || 'unknown'}").`
    );
  }

  const facadeName = facadeMeta
    ? (facadeMeta.scriptName || facadeMeta.scriptTitle || wanted)
    : wanted;
  const header = openedRes.name;
  const ok = [wanted, selected, facadeName]
    .filter(Boolean)
    .some((n) => String(n).toLowerCase() === String(header).toLowerCase());
  if (!ok) {
    throw new Error(
      `Pine editor identity is "${header}", not "${wanted}". `
      + 'Refuse Save/Publish until the correct script is open (use pine_open).'
    );
  }

  return {
    success: true,
    name: header,
    scriptIdPart,
    script_id: scriptIdPart,
    version,
    source: openedRes.via || 'open_dialog',
    opened: true,
  };
}

/**
 * Make a registered copy of a script via Pine UI (never pine-facade save/new alone).
 */
export async function copyScript({ from_name, from_id, new_name, replace = false } = {}) {
  if (!new_name || !String(new_name).trim()) throw new Error('new_name is required.');
  if (!from_name && !from_id) throw new Error('from_name or from_id is required.');

  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const sourceMeta = await lookupFacadeScript({ name: from_name, id: from_id });
  const fromName = sourceMeta.scriptName || sourceMeta.scriptTitle;
  await openScript({ name: fromName });

  // Open script-name menu → Make a copy… (name button = [class*="nameButton"])
  let menuOpened = await evaluate(`
    (function() {
      var widget = document.querySelector('.tv-script-widget');
      if (widget) {
        var nameBtn = widget.querySelector('[class*="nameButton"]');
        if (nameBtn) { nameBtn.click(); return true; }
      }
      var nb = document.querySelector('[class*="nameButton"]');
      if (nb) { nb.click(); return true; }
      var root = document.querySelector('.pine-editor-container')
        || document.querySelector('[class*="pine-editor"]')
        || document.querySelector('[class*="layout__area--bottom"]');
      if (!root) return false;
      var titleBtn = root.querySelector('[data-name="pine-script-title"]')
        || root.querySelector('button[class*="scriptTitle"]')
        || root.querySelector('[class*="scriptName"]');
      if (titleBtn) { titleBtn.click(); return true; }
      return false;
    })()
  `);
  if (!menuOpened) throw new Error('Could not open Pine script name menu.');
  await delay(700);

  const copyClicked = await clickVisibleButton(/make a copy/i);
  if (!copyClicked) throw new Error('"Make a copy…" menu item not found.');
  await delay(600);

  // "Make a copy…" reveals an inline rename input prefilled "<name> copy".
  // Set it to new_name and submit with Enter (no separate confirm button).
  const newName = String(new_name).trim();
  const submitted = await evaluate(`
    (function() {
      var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
      var inp = inputs.find(function(i) {
        return (i.offsetParent !== null || i.getClientRects().length > 0) && /copy$/i.test((i.value || '').trim());
      }) || inputs.find(function(i) { return i.offsetParent !== null || i.getClientRects().length > 0; });
      if (!inp) return { err: 'rename input not found' };
      (${setNativeValueExpression(newName, 'inp')});
      var mk = function(type) { return new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }); };
      inp.dispatchEvent(mk('keydown'));
      inp.dispatchEvent(mk('keypress'));
      inp.dispatchEvent(mk('keyup'));
      return { ok: true };
    })()
  `);
  if (submitted?.err) throw new Error(`Could not set new script name: ${submitted.err}`);
  await delay(800);

  // Trusted Enter as a fallback submit
  try {
    await pressKey('Enter', 0);
  } catch { /* non-fatal */ }
  await delay(900);

  await confirmReplaceIfNeeded(!!replace);
  await delay(1000);

  await assertEditorIdentity(String(new_name).trim());

  let uiVisible = false;
  try {
    uiVisible = await isNameInOpenDialog(String(new_name).trim());
  } catch {
    uiVisible = false;
  }

  let scriptIdPart = null;
  try {
    const meta = await lookupFacadeScript({ name: String(new_name).trim() });
    scriptIdPart = meta.scriptIdPart || null;
  } catch {
    // New copy may lag in facade list briefly
  }

  return {
    success: true,
    name: String(new_name).trim(),
    from: fromName,
    scriptIdPart,
    ui_visible: uiVisible,
    replace: !!replace,
  };
}

/** Alias for copyScript (issue #4 pine_save_as). */
export async function saveAsScript(opts) {
  return copyScript(opts);
}

export function shouldOpenScript(currentName, requestedName) {
  if (!currentName || !requestedName) return true;
  return String(currentName).trim().toLowerCase() !== String(requestedName).trim().toLowerCase();
}

/**
 * Choose publish wizard entry mode from visible controls.
 * TradingView exposes "Update existing script" only when a prior publication
 * exists (public or private). Prefer that over "Publish new script" so smoke
 * re-runs and already-published targets do not create a second publication.
 * Pure helper for unit tests.
 *
 * @param {{ updateAvailable?: boolean, newAvailable?: boolean, alreadyPublished?: boolean }} opts
 * @returns {'update'|'new'|null}
 */
export function selectPublishWizardMode({
  updateAvailable = false,
  newAvailable = false,
  alreadyPublished = false,
} = {}) {
  // Facade/UI agree the script was published → must update when that control exists.
  if (alreadyPublished || updateAvailable) {
    if (updateAvailable) return 'update';
    if (newAvailable) return 'new'; // update control missing; last resort
    return null;
  }
  if (newAvailable) return 'new';
  return null;
}

/**
 * Publish the open (or named) script via the Publish wizard.
 * privacy: 'private' | 'public' (default private).
 */
export async function publishScript({ name, id, privacy = 'private', description } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  if (privacy !== 'private' && privacy !== 'public') {
    throw new Error('privacy must be "private" or "public".');
  }

  let scriptName = name;
  if (name || id) {
    const meta = await lookupFacadeScript({ name, id });
    scriptName = meta.scriptName || meta.scriptTitle;
    const identity = await getEditorIdentity();
    if (shouldOpenScript(identity?.name, scriptName)) {
      await openScript({ name: scriptName });
    }
  } else {
    const identity = await getEditorIdentity();
    if (!identity?.name) throw new Error('No script identity in editor. Pass name/id or open a script first.');
    scriptName = identity.name;
  }

  await assertEditorIdentity(scriptName);

  const clickPublishEntry = async () => {
    // Pine-specific label only — never the global community "Publish" control
    // ("Share your idea with the trade community").
    return clickVisibleButton(/publish script/i);
  };

  let publishClicked = await clickPublishEntry();
  if (!publishClicked) throw new Error('Publish script button not found.');

  let publishDialogs = [];
  let saveHandled = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const saveGate = await resolvePublishSaveDialog();
    if (saveGate.handled) {
      saveHandled = true;
      await assertEditorIdentity(scriptName);
      publishClicked = await clickPublishEntry();
      if (!publishClicked) throw new Error('Publish script button not found after saving.');
    } else if (saveGate.dialogs.length > 0) {
      publishDialogs = saveGate.dialogs;
      break;
    }
    await delay(200);
  }

  if (publishDialogs.length === 0) {
    throw new Error(
      `Publish did not expose a dialog within 3 seconds${saveHandled ? ' after saving' : ''}.`,
    );
  }

  if (publishDialogs.some((dialog) => (
    !/publish (?:new |existing )?script/i.test(dialog.text)
    && !/not on the chart|add to chart/i.test(dialog.text)
  ))) {
    throw new Error(
      'Publish is blocked by an unexpected dialog: '
      + publishDialogs[publishDialogs.length - 1].text,
    );
  }

  // Gate: script not on chart
  const notOnChart = await evaluate(`
    (function() {
      var body = document.body ? document.body.innerText : '';
      return /not on the chart|add to chart/i.test(body)
        && !!document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
    })()
  `);
  if (notOnChart) {
    const interstitialAdd = await clickVisibleButton(/add to chart/i, { withinDialog: true });
    if (!interstitialAdd) {
      try { await addToChart(); } catch { /* continue */ }
    }
    await delay(1000);
    publishClicked = await clickPublishEntry();
    if (!publishClicked) throw new Error('Publish script button not found after Add to chart.');
    await delay(800);
  }

  // Prior publication: public list is authoritative; private pubs often omit it.
  // UI "Update existing script" is the reliable private signal (only shown when
  // a prior publication exists). Never treat mere presence on the saved list
  // as published — every saved script has a scriptIdPart.
  let alreadyPublished = false;
  try {
    const published = await fetchFacadeList('published');
    alreadyPublished = !!(published.scripts || []).some((s) => facadeScriptMatches(s, scriptName));
  } catch {
    alreadyPublished = false;
  }

  // Probe which wizard modes are visible without clicking yet.
  const modeProbe = await evaluate(`
    (function() {
      var dialogSelector = '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]';
      var btns = document.querySelectorAll('button, [role="button"], [role="menuitem"]');
      var updateAvailable = false;
      var newAvailable = false;
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        var container = b.closest(dialogSelector);
        if (!container || (container.offsetParent === null && container.getClientRects().length === 0)) continue;
        var t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')
          + ' ' + (b.getAttribute('title') || '')).replace(/\\s+/g, ' ').trim();
        if (/^update existing script/i.test(t)) updateAvailable = true;
        if (/^publish new script/i.test(t)) newAvailable = true;
      }
      return { updateAvailable: updateAvailable, newAvailable: newAvailable };
    })()
  `) || {};

  const mode = selectPublishWizardMode({
    updateAvailable: !!modeProbe.updateAvailable,
    newAvailable: !!modeProbe.newAvailable,
    alreadyPublished,
  });
  if (!mode) {
    throw new Error('Publish wizard is open, but neither "Publish new script" nor "Update existing script" was found.');
  }

  // Already published / Update control present → Update first. Else Publish new.
  let publishMode = null;
  if (mode === 'update') {
    publishMode = await clickVisibleButton(/^update existing script(?:update existing script)?$/i, { withinDialog: true });
    if (!publishMode) {
      publishMode = await clickVisibleButton(/^publish new script(?:publish new script)?$/i, { withinDialog: true });
    }
  } else {
    publishMode = await clickVisibleButton(/^publish new script(?:publish new script)?$/i, { withinDialog: true });
    if (!publishMode) {
      publishMode = await clickVisibleButton(/^update existing script(?:update existing script)?$/i, { withinDialog: true });
    }
  }
  if (!publishMode) {
    throw new Error('Publish wizard is open, but neither "Publish new script" nor "Update existing script" was found.');
  }
  const isUpdate = /update existing script/i.test(publishMode);

  if (description) {
    const descriptionSet = await fillDialogInput(description, { placeholderRegex: /description|about|summary/i });
    if (!descriptionSet && !isUpdate) {
      throw new Error('Publish wizard description field was not found in a visible dialog.');
    }
    if (descriptionSet) await delay(300);
  }

  const continued = await clickVisibleButton(/^(continue|next)(?:\1)?$/i, { withinDialog: true });
  if (!continued) {
    throw new Error('Publish wizard did not expose a Continue/Next button.');
  }
  await delay(500);

  // Privacy
  if (privacy === 'private') {
    const priv = await clickVisibleButton(/^private$/i, { withinDialog: true });
    if (!priv) {
      // Sometimes a radio/label
      await evaluate(`
        (function() {
          var labels = document.querySelectorAll('label, [role="radio"], button, span');
          for (var i = 0; i < labels.length; i++) {
            var t = (labels[i].textContent || '').trim();
            if (/^private$/i.test(t)) { labels[i].click(); return true; }
          }
          return false;
        })()
      `);
    }
  } else {
    await clickVisibleButton(/^public$/i, { withinDialog: true });
  }
  await delay(400);

  const finalBtn = privacy === 'private'
    ? await clickVisibleButton(/publish private/i, { withinDialog: true })
    : await clickVisibleButton(/publish public|publish$/i, { withinDialog: true });

  if (!finalBtn) {
    throw new Error(`Final Publish ${privacy} button not found in wizard.`);
  }

  // Private publications can lag the facade; poll while confirming the wizard closed.
  let identity = null;
  let lastPublishedError = null;
  let lastSavedError = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    await delay(attempt === 0 ? 800 : 400);
    const dialogsAfterPublish = await getVisibleDialogs();
    const publishDialog = dialogsAfterPublish.find((dialog) => (
      /publish (?:new |existing )?script/i.test(dialog.text)
      || /publish private|publish public/i.test(dialog.text)
    ));
    if (publishDialog && attempt < 8) continue;
    if (publishDialog) {
      throw new Error(
        'Publish wizard is still open after the final Publish action: '
        + publishDialog.text,
      );
    }

    const published = await fetchFacadeList('published');
    const saved = await fetchFacadeList('saved');
    lastPublishedError = published.error || null;
    lastSavedError = saved.error || null;
    identity = resolvePublishedIdentity(scriptName, {
      published: published.scripts || [],
      saved: saved.scripts || [],
    });
    if (identity?.pubId) break;
  }

  if (!identity?.pubId) {
    throw new Error(
      `Publish wizard completed but "${scriptName}" was not found in pine-facade `
      + 'published or saved lists. '
      + (lastPublishedError || lastSavedError || 'Check the UI for errors.'),
    );
  }

  return {
    success: true,
    name: identity.name,
    pubId: identity.pubId,
    version: identity.version,
    privacy,
    verification_source: identity.source,
    update_existing: isUpdate,
  };
}

export async function listScripts({ check_ui_visible = true } = {}) {
  const saved = await fetchFacadeList('saved');
  const published = await fetchFacadeList('published');

  let uiNames = null;
  if (check_ui_visible) {
    try {
      const editorReady = await ensurePineEditorOpen();
      if (editorReady) uiNames = await scrapeOpenDialogNames();
    } catch {
      uiNames = null;
    }
  }

  const scripts = mergeScriptLists(saved.scripts || [], published.scripts || [], uiNames);
  return {
    success: true,
    scripts,
    count: scripts.length,
    source: 'internal_api',
    ui_visibility_checked: uiNames !== null,
    error: saved.error || published.error,
  };
}

// Re-export pure helpers for tests
export { classifyCompileErrors, mergeScriptLists, isImportResolveError } from './pine_ui.js';
