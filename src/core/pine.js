/**
 * Core Pine Script logic — shared between MCP tools and CLI.
 * All functions accept plain options objects and return plain JS objects.
 * They throw on error (callers catch and format).
 */
import { evaluate } from '../connection.js';
import { pressKey, setNativeValueExpression } from './dom.js';
import { tvError } from './err.js';
import { sleep } from '../wait.js';
import {
  assertEditorIdentity,
  classifyCompileErrors,
  classifyUiDialog,
  clickVisibleButton,
  confirmReplaceIfNeeded,
  dismissBlockingDialogs,
  extractExportedNames,
  fetchFacadeList,
  fetchScriptHistory,
  fetchScriptSource,
  fillDialogInput,
  getEditorBufferInfo,
  getEditorIdentity,
  getVisibleDialogs,
  isNameInOpenDialog,
  lookupFacadeScript,
  mergeScriptLists,
  openViaOpenDialog,
  pineSourcesEqual,
  restorePinePanel,
  scrapeOpenDialogNames,
  studyCount,
} from './pine_ui.js';

// Monaco finder (injected into TV page) ──
// Note: TradingView's newer Pine editor (React 18+/createRoot) does not expose
// a __reactFiber$ backlink on the Monaco container, so fiber walking fails.
// Presence alone is not enough: a collapsed/zero-size Monaco is not usable.
// IMPORTANT: TV often keeps a zero-size docked .pine-editor-monaco in the DOM
// while the real overlay Monaco is a later .monaco-editor sibling. Never use
// querySelector alone — scan all candidates and pick a usable-sized one.
const FIND_MONACO_CONTAINER = `
  (function() {
    function usable(el) {
      if (!el) return false;
      var rect = el.getBoundingClientRect();
      return (el.offsetParent !== null || el.getClientRects().length > 0)
        && rect.width >= 40 && rect.height >= 40;
    }
    var preferred = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
    for (var i = 0; i < preferred.length; i++) {
      if (usable(preferred[i])) return true;
    }
    var any = document.querySelectorAll('.monaco-editor');
    for (var j = 0; j < any.length; j++) {
      if (usable(any[j])) return true;
    }
    return false;
  })()
`;
// Overlay mode exposes labeled Publish/Add controls. Docked bottom-panel Monaco is
// "open" but often icon-only, which breaks pine_add_to_chart / pine_publish.
const FIND_PINE_OVERLAY_READY = `
  (function() {
    function usable(el) {
      if (!el) return false;
      var rect = el.getBoundingClientRect();
      return (el.offsetParent !== null || el.getClientRects().length > 0)
        && rect.width >= 40 && rect.height >= 40;
    }
    var monacoOk = false;
    var nodes = document.querySelectorAll('.monaco-editor.pine-editor-monaco, .monaco-editor');
    for (var n = 0; n < nodes.length; n++) {
      if (usable(nodes[n])) { monacoOk = true; break; }
    }
    if (!monacoOk) return false;
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
    function usable(el) {
      if (!el) return false;
      var rect = el.getBoundingClientRect();
      return (el.offsetParent !== null || el.getClientRects().length > 0)
        && rect.width >= 40 && rect.height >= 40;
    }
    var container = null;
    var preferred = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
    for (var p = 0; p < preferred.length; p++) {
      if (usable(preferred[p])) { container = preferred[p]; break; }
    }
    if (!container) {
      var any = document.querySelectorAll('.monaco-editor');
      for (var a = 0; a < any.length; a++) {
        if (usable(any[a])) { container = any[a]; break; }
      }
    }
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
      await sleep(200);
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
      await sleep(200);
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
  if (!editorReady) throw tvError('TV_PINE_EDITOR_CLOSED', 'Could not open Pine Editor or Monaco not found in React fiber tree.', {
    hint: 'Open the editor with ui_open_panel({ panel: "pine-editor", action: "open" }), then retry.',
  });

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

  await sleep(2000);
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

/**
 * Save the currently-open Pine script and VERIFY it persisted — against the
 * script the editor buffer actually belongs to, not just the header name.
 *
 * Root cause fixed here (issue #17 / the pine_save verified:false false-negative
 * from #15): the editor header name and the Monaco buffer can be bound to
 * different scripts (buffer=Test_Script_1 while header reads RSIZoneDivUni).
 * The old code resolved the facade identity by header name, so it compared the
 * WRONG script's version and reported verified:false even when a save landed.
 *
 * We now resolve the target identity from the BUFFER's declared title first,
 * fall back to the header name, then verify by re-fetching that script's source
 * from the facade and comparing it to the buffer. verified=true means the cloud
 * source matches what is in the editor.
 */
export async function save({ _deps } = {}) {
  const evalFn = _deps?.evaluate || evaluate;
  const identityFn = _deps?.getEditorIdentity || getEditorIdentity;
  const lookupFn = _deps?.lookupFacadeScript || lookupFacadeScript;
  const bufferFn = _deps?.getEditorBufferInfo || getEditorBufferInfo;
  const fetchSourceFn = _deps?.fetchScriptSource || fetchScriptSource;
  const pressKeyFn = _deps?.pressKey || pressKey;
  const ensureFn = _deps?.ensurePineEditorOpen || ensurePineEditorOpen;

  const editorReady = await ensureFn();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Ground truth: what is actually in the buffer (a Save persists THIS).
  const buf = await bufferFn().catch(() => null);
  const bufferSource = buf?.source ?? null;
  const declaredTitle = buf?.declared_title ?? null;

  const identity = await identityFn().catch(() => null);
  const headerName = identity?.name || null;

  // Resolve the save target by header name (the registered identity the editor
  // is bound to). The buffer's declared title is then compared against it: when
  // they resolve to DIFFERENT scripts we have the unbound-editor trap and
  // surface bound_mismatch so the caller can re-bind (pine_bind) instead of
  // silently verifying the wrong script.
  let target = null;
  let resolved_by = null;
  if (headerName) {
    target = await lookupFn({ name: headerName }).catch(() => null);
    if (target) resolved_by = 'header_name';
  }
  if (!target && declaredTitle) {
    target = await lookupFn({ name: declaredTitle }).catch(() => null);
    if (target) resolved_by = 'buffer_title';
  }

  const bufferEntry = (declaredTitle && (!headerName || declaredTitle.toLowerCase() !== String(headerName).toLowerCase()))
    ? await lookupFn({ name: declaredTitle }).catch(() => null)
    : null;
  const bound_mismatch = !!(target && bufferEntry
    && (target.scriptIdPart || target.id) !== (bufferEntry.scriptIdPart || bufferEntry.id));

  const before = target;
  const targetName = target?.scriptName || target?.scriptTitle || declaredTitle || headerName || null;

  // Fast path: the buffer already matches the target's persisted cloud source,
  // so there is nothing new to persist (and no extra facade lookups needed).
  // verified=true because the buffer IS the cloud state.
  let alreadyPersisted = false;
  if (bufferSource !== null && target) {
    const preId = target.scriptIdPart || target.id;
    const pre = await fetchSourceFn(preId, target.version).catch(() => null);
    if (pre?.ok && typeof pre.source === 'string' && pineSourcesEqual(pre.source, bufferSource)) {
      alreadyPersisted = true;
    }
  }

  await pressKeyFn('s', 2);
  await sleep(800);

  // Handle "Save Script" name dialog that appears for new/unsaved scripts
  const dialogHandled = await evalFn(`
    (function() {
      var saveBtn = null;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (text === 'Save' && btns[i].offsetParent !== null) {
          var parent = btns[i].closest('[class*="dialog"], [class*="modal"], [class*="popup"], [role="dialog"]');
          if (parent) { saveBtn = btns[i]; break; }
        }
      }
      if (saveBtn) { saveBtn.click(); return true; }
      return false;
    })()
  `);

  if (dialogHandled) await sleep(500);

  // Re-resolve the saved identity and confirm the persisted source matches the
  // buffer. Re-fetching the source is the only reliable persistence signal here
  // because Desktop's save does not traverse page fetch/XHR (verified in #17),
  // and version/modified are not bumped on a no-op save.
  let script_id; let version; let modified; let entry = null;
  let verified = false;
  let persisted_matches_buffer = null;

  if (alreadyPersisted) {
    // Buffer already matched cloud before the save — nothing further to confirm.
    entry = target;
    script_id = target.scriptIdPart || target.id;
    version = target.version ?? null;
    modified = target.modified ?? null;
    verified = true;
    persisted_matches_buffer = true;
  } else {
    const id = target?.scriptIdPart || target?.id || null;
    if (id) entry = await lookupFn({ id }).catch(() => null);
    if (!entry && targetName) entry = await lookupFn({ name: targetName }).catch(() => null);

    script_id = entry?.scriptIdPart || entry?.id || id || null;
    version = entry?.version ?? null;
    modified = entry?.modified ?? null;

    // Sole success criterion: the persisted cloud source matches the buffer
    // exactly. Version-bump / modified-cleared heuristics are NOT accepted —
    // a save that bumps the version while persisting a different (e.g. stub)
    // source is precisely the silent-corruption failure this must not report
    // as success (issue #21).
    if (script_id && bufferSource !== null) {
      const fetched = await fetchSourceFn(script_id, entry?.version ?? null).catch(() => null);
      if (fetched?.ok && typeof fetched.source === 'string') {
        persisted_matches_buffer = pineSourcesEqual(fetched.source, bufferSource);
        verified = persisted_matches_buffer;
      }
    } else if (dialogHandled && !before && entry && bufferSource === null) {
      // Freshly created via the name dialog with no buffer to compare against.
      verified = true;
    }
  }

  // Fail loud: an unverified save is a failed save, not a success-with-caveat.
  const failure = verified ? null : (bound_mismatch
    ? `Editor header ("${headerName}") and buffer ("${declaredTitle}") are bound to different scripts; the save persisted the BUFFER's script and did not verify against the intended target. Run pine_bind to realign, then pine_save again.`
    : entry === null
      ? 'Could not re-resolve a saved cloud identity after save (facade lookup failed) — the save did not verifiably persist.'
      : 'Save did not persist the buffer source to the cloud (persisted source does not match the buffer). This is the silent-corruption case: nothing was reported as success. Run pine_bind to load the intended script, then pine_save again.');

  return {
    success: verified,
    action: dialogHandled ? 'saved_with_dialog' : 'saved',
    name: entry?.scriptName || entry?.scriptTitle || targetName,
    script_id,
    version,
    modified,
    verified,
    persisted_matches_buffer,
    resolved_by,
    buffer_title: declaredTitle || undefined,
    header_name: headerName || undefined,
    ...(failure && { error: failure }),
    ...(failure && !verified && { code: 'TV_PINE_UNBOUND' }),
    ...(failure && !verified && { hint: 'Run pine_bind to load the intended script into the buffer and establish the binding, then pine_save again.' }),
    ...(bound_mismatch && { bound_mismatch: true }),
  };
}

/**
 * Bind the editor to a specific saved script: fetch its registered source from
 * the facade, load it into the editor buffer, and confirm the buffer matches.
 * This establishes the buffer↔identity binding that pine_save verifies against,
 * eliminating the unbound-editor trap. No Open-dialog dependency for the source
 * itself (it comes from the facade); openScript() is used to align the header so
 * subsequent Save/Publish target the right cloud identity.
 */
export async function bindScript({ name, script_id, _deps } = {}) {
  const lookupFn = _deps?.lookupFacadeScript || lookupFacadeScript;
  const fetchSourceFn = _deps?.fetchScriptSource || fetchScriptSource;
  const bufferFn = _deps?.getEditorBufferInfo || getEditorBufferInfo;
  const openFn = _deps?.openScript || openScript;
  const setFn = _deps?.setSource || setSource;
  const identityFn = _deps?.getEditorIdentity || getEditorIdentity;

  if (!name && !script_id) throw new Error('name or script_id is required.');
  const entry = await lookupFn({ name, id: script_id });
  const id = entry.scriptIdPart || entry.id;
  const fetched = await fetchSourceFn(id, entry.version);
  if (!fetched?.ok || typeof fetched.source !== 'string') {
    throw new Error(`Could not fetch source for "${entry.scriptName || name || script_id}" (id ${id}).`);
  }
  const source = fetched.source;
  const scriptName = entry.scriptName || entry.scriptTitle || name;

  // Must switch the Open/Save/Publish target. Never inject into another header
  // (issue #26 — bind of Generic into an Eng buffer would overwrite the library).
  let opened;
  try {
    opened = await openFn({ name: scriptName, script_id: id });
  } catch (err) {
    return {
      success: false,
      bound: false,
      name: scriptName,
      script_id: id,
      error: `Could not switch editor identity to "${scriptName}": ${err.message}`,
      code: err.code || 'TV_PINE_IDENTITY_MISMATCH',
      hint: 'Close leftover dialogs (Open my script / Close menu), then retry pine_open with script_id.',
      ...(err.blocked_dialog && { blocked_dialog: err.blocked_dialog }),
    };
  }

  const identity = await identityFn().catch(() => null);
  const header = identity?.name || opened?.name || null;
  if (!header || header.toLowerCase() !== String(scriptName).toLowerCase()) {
    return {
      success: false,
      bound: false,
      name: scriptName,
      script_id: id,
      header_name: header,
      error: `pine_bind refused: editor header is "${header || 'unknown'}", not "${scriptName}". Will not inject into the wrong identity.`,
      code: 'TV_PINE_IDENTITY_MISMATCH',
      hint: 'Run pine_open with script_id to switch the Save/Publish target, then pine_bind again.',
    };
  }

  const set = await setFn({ source, script_name: scriptName });

  const buf = await bufferFn().catch(() => null);
  const bound = !!(buf && typeof buf.source === 'string' && pineSourcesEqual(buf.source, source));

  return {
    success: bound,
    name: scriptName,
    script_id: id,
    version: entry.version ?? null,
    kind: entry.extra?.kind || entry.scriptType || entry.kind || null,
    bound,
    header_name: header,
    lines_set: set?.lines_set ?? source.split('\n').length,
    ...(!bound && { note: 'Buffer content could not be confirmed to match the fetched source.' }),
  };
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

  await sleep(2500);

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

  const clicked = buttonClicked || 'keyboard_shortcut';
  return {
    success,
    button_clicked: clicked,
    clicked,
    persisted: clicked === 'Pine Save',
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

// Classify a visible dialog (from getVisibleDialogs) into a typed blocking
// reason. TradingView requires a script to be saved before "Add/Update on
// chart" applies it — the confirmation it raises is the failure mode that used
// to return success:true while silently keeping the old code (issue #15).
function classifyBlockingDialog(dlg) {
  const text = (dlg?.text || '').toLowerCase();
  if (/save (this |the )?script|save .*before|before adding|unsaved/i.test(text)) return 'save_before_add';
  if (/already exists|replace\?/i.test(text)) return 'replace_confirm';
  return 'modal_dialog';
}

/**
 * Add / update the currently open Pine script on the active chart (toolbar).
 * Prefers "Add to chart" / "Update on chart" — not "Save and add…".
 *
 * Returns a typed result instead of an ambiguous count-diff (issue #15):
 *   action: 'added' | 'updated' | 'blocked_dialog'
 * `blocked_dialog` means TradingView raised a modal (e.g. "Save this script
 * before adding?") and the click was intercepted — the chart kept the old
 * code. `blocked_dialog.reason` classifies it; `dialog` carries the observed
 * text/buttons so a caller (or the pine-publish skill) can act on it.
 */
export async function addToChart({ _deps } = {}) {
  const evalFn = _deps?.evaluate || evaluate;
  const dialogsFn = _deps?.getVisibleDialogs || getVisibleDialogs;
  const studyCountFn = _deps?.studyCount || studyCount;
  const ensureFn = _deps?.ensurePineEditorOpen || ensurePineEditorOpen;

  const editorReady = await ensureFn();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Pre-check: a modal already open would intercept the click and previously
  // surfaced as a silent success. Surface it before touching the toolbar.
  const preDialogs = await dialogsFn();
  if (preDialogs.length > 0) {
    return {
      success: false,
      action: 'blocked_dialog',
      reason: classifyBlockingDialog(preDialogs[0]),
      dialog: preDialogs[0],
      dialogs: preDialogs,
    };
  }

  const before = await studyCountFn();
  const buttonClicked = await evalFn(`
    (function() {
      var btns = document.querySelectorAll('button');
      var addBtn = null;
      var updateBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (btns[i].offsetParent === null && btns[i].getClientRects().length === 0) continue;
        // Doubled labels: "Add to chartAdd to chart"
        if (!addBtn && /^add to chart/i.test(text)) addBtn = btns[i];
        if (!updateBtn && /^update on chart/i.test(text)) updateBtn = btns[i];
      }
      if (addBtn) { addBtn.click(); return 'Add to chart'; }
      if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
      return null;
    })()
  `);

  if (!buttonClicked) {
    throw new Error('Add to chart / Update on chart button not found in Pine toolbar.');
  }

  await sleep(2000);

  // Post-click: did a blocking dialog appear (e.g. "Save this script before
  // adding?")? If so the apply was intercepted — report it, don't claim success.
  const postDialogs = await dialogsFn();
  if (postDialogs.length > 0) {
    return {
      success: false,
      action: 'blocked_dialog',
      reason: classifyBlockingDialog(postDialogs[0]),
      button_clicked: buttonClicked,
      dialog: postDialogs[0],
      dialogs: postDialogs,
    };
  }

  const after = await studyCountFn();
  const countIncreased = (before !== null && after !== null) ? after > before : null;
  // Update-on-chart re-renders in place (count unchanged); Add-to-chart adds a
  // study (count grows). Trust the button identity first — it is the ground
  // truth of intent — and report the count signal alongside so a mismatch
  // (e.g. an unexpected duplicate add) is visible rather than inferred.
  const action = /^update on chart/i.test(buttonClicked) ? 'updated' : 'added';

  return {
    success: true,
    action,
    button_clicked: buttonClicked,
    study_added: countIncreased,
    ...(action === 'added' && countIncreased === false && {
      warning: 'Add to chart was clicked but the study count did not increase — the study may already be on the chart (duplicate avoided) or the apply did not take.',
    }),
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

  if (!set) throw tvError('TV_PINE_EDITOR_CLOSED', 'Monaco editor not found. Ensure Pine Editor is open.', {
    hint: 'Open the editor with ui_open_panel({ panel: "pine-editor", action: "open" }), then retry.',
  });

  return { success: true, type, action: 'new_script_created', template: typeMap[type] };
}

/**
 * Open a saved script by registered UI identity (Open script dialog).
 * Does NOT inject Monaco into the current buffer — Save/Publish target the opened script.
 * Accepts script_id to disambiguate near-duplicate names (issue #26).
 */
export async function openScript({ name, script_id, _deps } = {}) {
  const lookupFn = _deps?.lookupFacadeScript || lookupFacadeScript;
  const openFn = _deps?.openViaOpenDialog || openViaOpenDialog;
  const dismissFn = _deps?.dismissBlockingDialogs || dismissBlockingDialogs;
  const dialogsFn = _deps?.getVisibleDialogs || getVisibleDialogs;
  const ensureFn = _deps?.ensurePineEditorOpen || ensurePineEditorOpen;

  if ((!name || !String(name).trim()) && !script_id) {
    throw new Error('name or script_id is required.');
  }
  const editorReady = await ensureFn();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  let facadeMeta = null;
  try {
    facadeMeta = await lookupFn({ name, id: script_id });
  } catch {
    // Open dialog may still find UI-registered scripts; continue.
  }

  const wanted = String(facadeMeta?.scriptName || facadeMeta?.scriptTitle || name || '').trim();
  if (!wanted) throw new Error('Could not resolve a script name from script_id. Pass name or a known script_id.');

  const openedRes = await openFn(wanted, { script_id: facadeMeta?.scriptIdPart || script_id, ...(_deps || {}) });
  const selected = openedRes?.name || openedRes?.selected || wanted;
  const scriptIdPart = facadeMeta?.scriptIdPart || openedRes?.scriptIdPart || script_id || null;
  const version = facadeMeta?.version ?? null;

  if (!openedRes?.opened) {
    await dismissFn(_deps).catch(() => {});
    const leftover = (await dialogsFn(_deps).catch(() => [])).find((d) => d.kind === 'pine_open_dialog');
    const err = new Error(
      `Could not open "${wanted}" in the Pine editor (current: "${openedRes?.name || 'unknown'}").`
    );
    if (leftover) {
      err.blocked_dialog = leftover;
      err.code = 'TV_PINE_BLOCKED_DIALOG';
    }
    throw err;
  }

  const facadeName = facadeMeta
    ? (facadeMeta.scriptName || facadeMeta.scriptTitle || wanted)
    : wanted;
  const header = openedRes.name;
  const ok = [wanted, selected, facadeName]
    .filter(Boolean)
    .some((n) => String(n).toLowerCase() === String(header).toLowerCase());
  if (!ok) {
    throw tvError('TV_PINE_IDENTITY_MISMATCH',
      `Pine editor identity is "${header}", not "${wanted}". `
      + 'Refuse Save/Publish until the correct script is open (use pine_open).',
      { hint: 'Retry pine_open with script_id from pine_list_scripts.' },
    );
  }

  await dismissFn(_deps).catch(() => {});
  const leftover = (await dialogsFn(_deps).catch(() => [])).find((d) => d.kind === 'pine_open_dialog');
  if (leftover) {
    const err = new Error('Open my script dialog is still open (blocked_dialog). Click "Close menu" and retry.');
    err.blocked_dialog = leftover;
    err.code = 'TV_PINE_BLOCKED_DIALOG';
    throw err;
  }

  return {
    success: true,
    name: header,
    scriptIdPart,
    script_id: scriptIdPart,
    version,
    source: openedRes.via || 'open_dialog',
    opened: true,
    blocked_dialog: null,
  };
}

/**
 * Make a registered copy of a script via Pine UI (never pine-facade save/new alone).
 */
export async function copyScript({ from_name, from_id, new_name, replace = false, _deps } = {}) {
  if (!new_name || !String(new_name).trim()) throw new Error('new_name is required.');
  if (!from_name && !from_id) throw new Error('from_name or from_id is required.');

  const restoreFn = _deps?.restorePinePanel || restorePinePanel;
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // The name-menu flow needs the script widget's nameButton, which disappears
  // when the bottom panel is stuck collapsed (issue #21). Restore it first.
  await restoreFn().catch(() => null);

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
  if (!menuOpened) {
    throw new Error(
      'Could not open Pine script name menu. The Pine Editor panel may be collapsed/stuck '
      + 'or a dialog is open — expand the Pine Editor (or run pine_open) and retry.',
    );
  }
  await sleep(700);

  const copyClicked = await clickVisibleButton(/make a copy/i);
  if (!copyClicked) throw new Error('"Make a copy…" menu item not found.');
  await sleep(600);

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
  await sleep(800);

  // Trusted Enter as a fallback submit
  try {
    await pressKey('Enter', 0);
  } catch { /* non-fatal */ }
  await sleep(900);

  await confirmReplaceIfNeeded(!!replace);
  await sleep(1000);

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

async function publishedEntryFor({ name, id }, fetchListFn) {
  const published = await fetchListFn('published');
  const scripts = published.scripts || [];
  if (id) {
    const byId = scripts.find((s) => {
      const sid = s.scriptIdPart || s.id || '';
      return sid === id || sid === `PUB;${String(id).replace(/^PUB;/i, '')}`
        || String(sid).replace(/^(USER|PUB);/i, '') === String(id).replace(/^(USER|PUB);/i, '');
    });
    if (byId) return { list: published, entry: byId, version: byId.version ?? byId.published_version ?? null };
  }
  if (name) {
    const want = String(name).toLowerCase();
    const byName = scripts.find((s) => {
      const sn = (s.scriptName || '').toLowerCase();
      const st = (s.scriptTitle || '').toLowerCase();
      return sn === want || st === want;
    });
    if (byName) return { list: published, entry: byName, version: byName.version ?? byName.published_version ?? null };
  }
  return { list: published, entry: null, version: null };
}

/**
 * Publish the open (or named) script via the Publish wizard.
 * privacy: 'private' | 'public' (default private).
 *
 * Already-published scripts MUST take Update-existing (issue #26). Success
 * requires a published_version change when a prior version was visible.
 */
export async function publishScript({ name, id, privacy = 'private', description, _deps } = {}) {
  const evalFn = _deps?.evaluate || evaluate;
  const clickFn = _deps?.clickVisibleButton || clickVisibleButton;
  const openFn = _deps?.openScript || openScript;
  const identityFn = _deps?.getEditorIdentity || getEditorIdentity;
  const assertFn = _deps?.assertEditorIdentity || assertEditorIdentity;
  const listFn = _deps?.fetchFacadeList || fetchFacadeList;
  const dialogsFn = _deps?.getVisibleDialogs || getVisibleDialogs;
  const addFn = _deps?.addToChart || addToChart;
  const fillFn = _deps?.fillDialogInput || fillDialogInput;
  const ensureFn = _deps?.ensurePineEditorOpen || ensurePineEditorOpen;
  const sleepFn = _deps?.sleep || sleep;
  const lookupFn = _deps?.lookupFacadeScript || lookupFacadeScript;

  const editorReady = await ensureFn();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  if (privacy !== 'private' && privacy !== 'public') {
    throw new Error('privacy must be "private" or "public".');
  }

  let scriptName = name;
  if (name || id) {
    const meta = await lookupFn({ name, id });
    scriptName = meta.scriptName || meta.scriptTitle;
    await openFn({ name: scriptName, script_id: meta.scriptIdPart || id });
  } else {
    const identity = await identityFn();
    if (!identity?.name) throw new Error('No script identity in editor. Pass name/id or open a script first.');
    scriptName = identity.name;
  }

  await assertFn(scriptName);

  const before = await publishedEntryFor({ name: scriptName, id }, listFn);
  let mode = before.version != null ? 'update' : 'create';

  let publishClicked = await clickFn(/publish script/i);
  if (!publishClicked) throw new Error('Publish script button not found.');
  await sleepFn(800);

  const notOnChart = await evalFn(`
    (function() {
      var body = document.body ? document.body.innerText : '';
      return /not on the chart|add to chart/i.test(body)
        && !!document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
    })()
  `);
  if (notOnChart) {
    const interstitialAdd = await clickFn(/add to chart/i, { withinDialog: true });
    if (!interstitialAdd) {
      try { await addFn(); } catch { /* continue */ }
    }
    await sleepFn(1000);
    publishClicked = await clickFn(/publish script/i);
    if (!publishClicked) throw new Error('Publish script button not found after Add to chart.');
    await sleepFn(800);
  }

  const wizardDialogs = (await dialogsFn()).map(classifyUiDialog);
  const wizard = wizardDialogs.find((d) => d.kind === 'pine_publish_wizard');
  if (wizard?.mode === 'update' || /update existing/i.test(`${wizard?.text || ''} ${(wizard?.buttons || []).join(' ')}`)) {
    mode = 'update';
  }

  const updateClicked = await clickFn(/update existing (script|library)?/i, { withinDialog: true })
    || await clickFn(/update existing/i);
  if (updateClicked) {
    mode = 'update';
  } else if (mode === 'update') {
    return {
      success: false,
      mode: 'update',
      name: scriptName,
      published_version: before.version,
      published_version_before: before.version,
      pubId: before.entry?.scriptIdPart || null,
      error: 'Already published but Update existing was not available or not clicked. Refusing to report success on an unchanged import snapshot.',
      code: 'TV_PINE_PUBLISH_STALE',
      hint: 'Use the pine-publish skill: observe tv_ui_state, click Update existing script, then Publish new version.',
    };
  } else {
    await clickFn(/publish new script/i, { withinDialog: true });
  }

  if (description) {
    await fillFn(description, { placeholderRegex: /description|about|summary|release notes/i });
    await sleepFn(300);
  }

  await clickFn(/^(continue|next)$/i, { withinDialog: true });
  await sleepFn(500);

  if (privacy === 'private') {
    const priv = await clickFn(/^private$/i, { withinDialog: true });
    if (!priv) {
      await evalFn(`
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
    await clickFn(/^public$/i, { withinDialog: true });
  }
  await sleepFn(400);

  const finalBtn = mode === 'update'
    ? (await clickFn(/publish new version/i, { withinDialog: true })
      || await clickFn(/publish private/i, { withinDialog: true })
      || await clickFn(/publish public|publish$/i, { withinDialog: true }))
    : (privacy === 'private'
      ? await clickFn(/publish private/i, { withinDialog: true })
      : await clickFn(/publish public|publish$/i, { withinDialog: true }));

  if (!finalBtn) {
    const any = await clickFn(/publish/i, { withinDialog: true });
    if (!any) throw new Error('Final Publish button not found in wizard.');
  }

  await sleepFn(2500);

  const after = await publishedEntryFor({ name: scriptName, id }, listFn);
  const published_version = after.version ?? null;
  const pubId = after.entry?.scriptIdPart || before.entry?.scriptIdPart || null;

  if (mode === 'update' && before.version != null && published_version != null
    && String(published_version) === String(before.version)) {
    return {
      success: false,
      mode,
      name: scriptName,
      pubId,
      version: published_version,
      published_version,
      published_version_before: before.version,
      privacy,
      error: 'Update-existing completed but published_version did not change. The import snapshot is unchanged — do not report success.',
      code: 'TV_PINE_PUBLISH_STALE',
      hint: 'Confirm the wizard finished (Publish new version) and that source actually changed, then retry.',
    };
  }

  if (!after.entry && !before.entry) {
    throw new Error(
      `Publish wizard completed but "${scriptName}" not found in pine-facade published list. `
      + (after.list?.error || 'Check the UI for errors. Private pubs may need the pine-publish skill.')
    );
  }

  return {
    success: true,
    mode,
    name: after.entry?.scriptName || after.entry?.scriptTitle || scriptName,
    pubId,
    version: published_version ?? after.entry?.version ?? null,
    published_version,
    published_version_before: before.version,
    privacy,
  };
}

export async function listScripts({ check_ui_visible = true, _deps } = {}) {
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

/**
 * Read a saved script's full source by name or scriptIdPart WITHOUT opening
 * it in the editor, switching Save/Publish identity, or raising any dialog.
 * Resolves identity from the facade saved list, then fetches the source body
 * from the facade on-demand endpoint (the list payload leaves scriptSource
 * empty). Throws a clear error when the name/id is unknown or no facade
 * endpoint yields a source.
 */
export async function readScript({ name, script_id, scope = 'saved', version, _deps } = {}) {
  if (!name && !script_id) throw new Error('name or script_id is required.');
  const lookupFn = _deps?.lookupFacadeScript || lookupFacadeScript;
  const fetchSourceFn = _deps?.fetchScriptSource || fetchScriptSource;
  const filter = scope === 'published' ? 'published' : 'saved';
  const entry = await lookupFn({ name, id: script_id, filter });
  const id = entry.scriptIdPart || entry.id;
  const ver = version ?? entry.version ?? null;
  const fetched = await fetchSourceFn(id, ver);
  if (!fetched.ok || !fetched.source) {
    throw new Error(
      `Could not fetch source for "${entry.scriptName || name || script_id}" `
      + `(id ${id}, scope ${filter}, version ${ver ?? 'latest'}). Tried: ${(fetched.attempted || []).join(', ') || 'none'}.`
    );
  }
  const source = fetched.source;
  return {
    success: true,
    name: entry.scriptName || entry.scriptTitle || name || null,
    title: entry.scriptTitle || null,
    script_id: id,
    version: ver,
    scope: filter,
    kind: entry.extra?.kind || entry.scriptType || entry.kind || entry.extra?.scriptType || null,
    modified: entry.modified ?? null,
    source,
    line_count: source.split('\n').length,
    char_count: source.length,
    via: fetched.via,
    exports: extractExportedNames(source),
  };
}

/**
 * List `export` names for a saved or published library (user/Lib/N probe).
 * Does not compile a consumer and does not open the editor.
 */
export async function listLibraryExports({ name, script_id, scope = 'published', version, _deps } = {}) {
  const read = await readScript({ name, script_id, scope, version, _deps });
  return {
    success: true,
    name: read.name,
    script_id: read.script_id,
    scope: read.scope,
    version: read.version,
    exports: read.exports,
    export_count: read.exports.length,
    via: read.via,
  };
}

export async function readScriptHistory({ name, script_id, max_versions = 10, include_sources = false } = {}) {
  if (!name && !script_id) throw new Error('name or script_id is required.');
  const entry = await lookupFacadeScript({ name, id: script_id });
  const id = entry.scriptIdPart || entry.id;
  const currentVersion = parseFloat(entry.version);
  if (!Number.isFinite(currentVersion)) {
    throw new Error(`Could not determine current version for "${entry.scriptName || name || script_id}" (id ${id}).`);
  }
  const hist = await fetchScriptHistory(id, { current_version: currentVersion, max_versions, include_sources });
  if (!hist.ok) throw new Error(hist.error || `Could not fetch version history for id ${id}.`);
  const versions = (hist.versions || []).map((v) => ({
    ...v,
    source: include_sources ? v.source : undefined,
  }));
  const intact = versions.filter((v) => v.ok && !v.is_stub);
  return {
    success: true,
    name: entry.scriptName || entry.scriptTitle || name || null,
    title: entry.scriptTitle || null,
    script_id: id,
    current_version: hist.current_version,
    version_count: versions.length,
    intact_version_count: intact.length,
    latest_intact_version: intact.length ? intact[0].version : null,
    versions,
  };
}

// Re-export pure helpers for tests
export {
  classifyCompileErrors,
  classifyUiDialog,
  mergeScriptLists,
  isImportResolveError,
  extractDeclaredTitle,
  extractExportedNames,
  normalizePineNewlines,
  pineSourcesEqual,
  fetchScriptSource,
  fetchScriptHistory,
} from './pine_ui.js';
