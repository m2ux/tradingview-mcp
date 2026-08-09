/**
 * Pine Editor DOM helpers — identity, Open dialog, toolbar/dialog clicks.
 * Shared by pine_open / copy / publish / list enrichment.
 */
import { evaluate, evaluateAsync, safeString } from '../connection.js';
import {
  pressKey,
  setNativeValueExpression,
  readFiberPropExpression,
} from './dom.js';
import { setInput as uiSetInput } from './ui.js';

export const PINE_FACADE = 'https://pine-facade.tradingview.com/pine-facade';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Pine Open-script picker helpers (local, consolidated) ───────────────────

/** Page-context: find the visible "Open my script" dialog (falls back to last dialog with an input). */
const FIND_OPEN_DIALOG_EXPR = `
  var dlg = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="modal"]'))
    .find(function(d) { return /open my script/i.test(d.textContent || ''); })
    || Array.prototype.slice.call(document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="modal"]'))
      .filter(function(d) { return d.querySelector('input'); }).pop()
    || null;
`;

/** Page-context: selector set for visible picker rows. */
const OPEN_DIALOG_ROW_SELECTOR = '[class*="itemRow"], [class*="itemInfo"], [class*="listItem"], [class*="ListItem"], [class*="item"], [class*="row"], [role="option"], li, tr';

/** Page-context: derive a row's script title (leading text before "Version:"). */
const ROW_TITLE_EXPR = `(r.textContent || '').trim().split(/version:/i)[0].split('\\n')[0].trim()`;

/** True when a message is an unpublished / import-resolve failure. */
export function isImportResolveError(message) {
  if (!message || typeof message !== 'string') return false;
  return /does not have a published library/i.test(message)
    || /could not find library/i.test(message)
    || /unable to (?:resolve|find) import/i.test(message)
    || /import .+ (?:failed|not found|cannot be resolved)/i.test(message)
    || /unpublished library/i.test(message);
}

/** Split marker/console errors into import_errors vs other errors. */
export function classifyCompileErrors(errors = []) {
  const import_errors = [];
  const other = [];
  for (const e of errors) {
    const msg = e?.message || e?.text || String(e);
    if (isImportResolveError(msg)) import_errors.push(e);
    else other.push(e);
  }
  return { import_errors, errors: other };
}

/**
 * Merge saved + published facade lists; attach published_version / kind.
 * Pure helper for unit tests.
 */
export function mergeScriptLists(saved = [], published = [], uiVisibleNames = null) {
  const pubById = new Map();
  const pubByName = new Map();
  for (const p of published) {
    const id = p.scriptIdPart || p.id || null;
    const name = p.scriptName || p.scriptTitle || p.name || null;
    const ver = p.version ?? p.published_version ?? null;
    if (id) pubById.set(id, ver);
    if (name) pubByName.set(String(name).toLowerCase(), ver);
  }

  const visibleSet = uiVisibleNames
    ? new Set(uiVisibleNames.map((n) => String(n).toLowerCase()))
    : null;

  return saved.map((s) => {
    const id = s.scriptIdPart || s.id || null;
    const name = s.scriptName || s.scriptTitle || s.name || 'Untitled';
    const title = s.scriptTitle || s.title || null;
    const kind = s.extra?.kind || s.scriptType || s.kind || s.extra?.scriptType || null;
    const published_version = (id && pubById.has(id) ? pubById.get(id) : null)
      ?? pubByName.get(String(name).toLowerCase())
      ?? null;
    let ui_visible = null;
    if (visibleSet) {
      ui_visible = visibleSet.has(String(name).toLowerCase())
        || (title && visibleSet.has(String(title).toLowerCase()));
    }
    return {
      id,
      name,
      title,
      version: s.version ?? null,
      modified: s.modified ?? null,
      kind,
      published_version,
      ui_visible,
      in_open_dialog: ui_visible,
    };
  });
}

export async function getEditorIdentity(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const result = await evalFn(`
    (function() {
      // Pine editor header identity — the script name button (class nameButton-*)
      // lives in .tv-script-widget (the Pine editor dialog). Prefer this first.
      var widget = document.querySelector('.tv-script-widget');
      var scope = widget;
      if (!scope) {
        // Editor may be collapsed/undocked: the .tv-script-widget handle is gone
        // but the Monaco container persists. Scope to the visible Monaco's panel
        // so we can still read the identity from a nearby name button.
        var mon = document.querySelector('.monaco-editor.pine-editor-monaco');
        if (mon) {
          var p = mon;
          for (var up = 0; up < 8 && p; up++) {
            if (p.querySelector && p.querySelector('[class*="nameButton"]')) { scope = p; break; }
            p = p.parentElement;
          }
          if (!scope) scope = mon.parentElement;
        }
      }
      if (scope) {
        var nameBtn = scope.querySelector('[class*="nameButton"]');
        if (nameBtn) {
          var t0 = (nameBtn.textContent || '').trim();
          if (t0 && t0.length < 80) return { name: t0.split('\\n')[0].trim() };
        }
      }
      var root = document.querySelector('.pine-editor-container')
        || document.querySelector('[class*="pine-editor"]')
        || document.querySelector('[class*="layout__area--bottom"]');
      if (!root) return null;
      var h2 = root.querySelector('h2');
      if (h2) {
        var t = (h2.textContent || '').trim();
        if (t) return { name: t };
      }
      var titleBtn = root.querySelector('[data-name="pine-script-title"]')
        || root.querySelector('[class*="nameButton"]')
        || root.querySelector('[class*="title"] button')
        || root.querySelector('button[class*="scriptTitle"]')
        || root.querySelector('[class*="scriptName"]');
      if (titleBtn) {
        var t2 = (titleBtn.textContent || '').trim();
        if (t2) return { name: t2 };
      }
      var candidates = root.querySelectorAll('button, [role="button"], h2, h3');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var txt = (el.textContent || '').trim();
        if (!txt || txt.length > 80) continue;
        if (/^(add to chart|update on chart|save|publish|open|new|saved)/i.test(txt)) continue;
        if (el.closest('.monaco-editor')) continue;
        // Prefer elements near the top of the pine panel
        var rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 48 && txt.length > 0) {
          return { name: txt.split('\\n')[0].trim() };
        }
      }
      return null;
    })()
  `);
  return result || null;
}

export async function assertEditorIdentity(expected, _deps = {}) {
  if (!expected) throw new Error('assertEditorIdentity requires an expected name.');
  const identity = await getEditorIdentity(_deps);
  const actual = identity?.name || null;
  if (!actual) {
    throw new Error(`Could not read Pine editor script identity (expected "${expected}").`);
  }
  if (actual.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(
      `Pine editor identity is "${actual}", not "${expected}". `
      + 'Refuse Save/Publish until the correct script is open (use pine_open).'
    );
  }
  return { name: actual };
}

export async function clickVisibleButton(pattern, { withinDialog = false } = {}, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  const flags = pattern instanceof RegExp ? pattern.flags : 'i';
  return evalFn(`
    (function() {
      var re = new RegExp(${JSON.stringify(source)}, ${JSON.stringify(flags)});
      var scope = document;
      if (${withinDialog ? 'true' : 'false'}) {
        scope = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]') || document;
      }
      var btns = scope.querySelectorAll('button, [role="button"], [role="menuitem"], a[class*="button"], [class*="menuItem"], [class*="item"] [class*="label"]');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        var text = (b.textContent || b.getAttribute('aria-label') || '').trim();
        if (re.test(text)) { b.click(); return text; }
      }
      return null;
    })()
  `);
}

export async function fillDialogInput(value, { placeholderRegex } = {}, _deps = {}) {
  const ph = placeholderRegex instanceof RegExp
    ? placeholderRegex.source
    : (placeholderRegex || 'name|script|title|description');
  try {
    const r = await uiSetInput(
      { value: String(value), match: ph, within_dialog: true },
      { evaluate: _deps.evaluate || evaluate },
    );
    return r.set === true;
  } catch {
    return false; // no matching input → setInput threw
  }
}

export async function confirmReplaceIfNeeded(replace, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const prompt = await evalFn(`
    (function() {
      var body = document.body ? document.body.innerText : '';
      if (/already exists|replace\\?/i.test(body)) return true;
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"]');
      if (dlg && /already exists|replace/i.test(dlg.textContent || '')) return true;
      return false;
    })()
  `);
  if (!prompt) return { prompted: false, replaced: false };
  if (!replace) {
    await clickVisibleButton(/^(no|cancel)$/i, { withinDialog: true }, _deps);
    throw new Error('A script with that name already exists. Pass replace: true to overwrite.');
  }
  const yes = await clickVisibleButton(/^(yes|replace|ok)$/i, { withinDialog: true }, _deps);
  if (!yes) throw new Error('Replace confirmation dialog found but Yes/Replace button missing.');
  await delay(500);
  return { prompted: true, replaced: true };
}

/**
 * Open the Open-script picker. The Pine editor is a floating dialog whose
 * Monaco swallows raw Ctrl+O, so we open the script name menu and click the
 * "Open script…" item, falling back to the key event.
 */
export async function openOpenScriptDialog(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const viaMenu = await evalFn(`
    (function() {
      var widget = document.querySelector('.tv-script-widget');
      if (!widget) return { err: 'no widget' };
      var nameBtn = widget.querySelector('[class*="nameButton"]');
      if (!nameBtn) return { err: 'no nameButton' };
      nameBtn.click();
      return { opened: true };
    })()
  `);
  if (!viaMenu?.opened) {
    await pressKey('o', 2, _deps);
    await delay(500);
    return { via: 'key' };
  }
  await delay(500);
  const clicked = await evalFn(`
    (function() {
      var candidates = document.querySelectorAll('[role="menuitem"], [role="menu"] button, [class*="menu"] button, [class*="popup"] button, button');
      for (var i = 0; i < candidates.length; i++) {
        var b = candidates[i];
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        var t = (b.textContent || '').trim();
        if (/^open script/i.test(t)) { b.click(); return t; }
      }
      return null;
    })()
  `);
  if (!clicked) {
    // close menu then fall back to key
    await pressKey('Escape', 0, _deps);
    await pressKey('o', 2, _deps);
    await delay(500);
    return { via: 'key' };
  }
  await delay(500);
  return { via: 'menu' };
}

export async function dismissOpenDialog(_deps = {}) {
  await pressKey('Escape', 0, _deps);
  await delay(200);
}

/**
 * Open the Open-script dialog, search for name, select a row.
 * Returns { selected, candidates } or throws.
 */
export async function openScriptDialogAndSelect(name, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const target = String(name).trim();
  if (!target) throw new Error('Script name is required.');

  await openOpenScriptDialog(_deps);
  await delay(400);

  // Focus search within the "Open my script" picker and type name
  const typed = await evalFn(`
    (function() {
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return { error: 'Open script dialog not found' };
      var inp = dlg.querySelector('input[type="search"], input[type="text"], input:not([type])');
      if (!inp) return { error: 'Search input not found in Open script dialog' };
      (${setNativeValueExpression(target, 'inp')});
      return { ok: true };
    })()
  `);
  if (typed?.error) {
    await dismissOpenDialog(_deps);
    throw new Error(typed.error);
  }
  await delay(900);

  const pick = await evalFn(`
    (function() {
      var target = ${safeString(target.toLowerCase())};
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return { error: 'Open script dialog closed unexpectedly' };
      var rows = dlg.querySelectorAll(${JSON.stringify(OPEN_DIALOG_ROW_SELECTOR)});
      var candidates = [];
      var exact = null;
      var contains = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!(r.offsetParent !== null || r.getClientRects().length > 0)) continue;
        var t = ${ROW_TITLE_EXPR};
        if (!t || t.length > 120) continue;
        if (/^(open|cancel|close|my scripts|built-in)/i.test(t)) continue;
        var tl = t.toLowerCase();
        if (tl === target) { if (!exact) exact = { el: r, title: t }; candidates.push(t); continue; }
        if (tl.indexOf(target) !== -1) { contains.push({ el: r, title: t }); candidates.push(t); }
      }
      var seen = {};
      candidates = candidates.filter(function(c) {
        var k = c.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
      var pick = exact;
      if (!pick && contains.length === 1) pick = contains[0];
      if (!pick && contains.length > 1) {
        return { error: 'Ambiguous script name "' + ${safeString(target)} + '". Candidates: ' + candidates.slice(0, 8).join(', '), candidates: candidates };
      }
      if (!pick) return { error: 'Script "' + ${safeString(target)} + '" not found in Open script dialog.', candidates: candidates };
      pick.el.click();
      // Pull scriptItem metadata (id, openAction availability) off the row fiber
      var meta = null;
      var si = (${readFiberPropExpression('scriptItem', 'pick.el')});
      if (si) {
        meta = {
          id: si.id || null,
          scriptIdPart: si.id ? String(si.id).replace(/^USER;/, '') : null,
          name: si.name || null,
          scriptTitle: si.scriptTitle || null,
          lastVersion: si.lastVersion || null,
          hasOpenAction: typeof si.openAction === 'function',
        };
      }
      return { selected: pick.title, candidates: candidates, meta: meta };
    })()
  `);

  if (pick?.error) {
    await dismissOpenDialog(_deps);
    const err = new Error(pick.error);
    err.candidates = pick.candidates;
    throw err;
  }

  // Attempt to open the selected script via the dialog's native gesture
  // (double-click on the row). This is best-effort; openScript() verifies the
  // header and falls back to the facade scriptIdPart URL when it doesn't take.
  await delay(300);
  const confirmed = await evalFn(`
    (function() {
      var target = ${safeString((pick.selected || target).toLowerCase())};
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return { confirmed: false, reason: 'dialog gone' };
      var rows = dlg.querySelectorAll(${JSON.stringify(OPEN_DIALOG_ROW_SELECTOR)});
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var t = (${ROW_TITLE_EXPR}).toLowerCase();
        if (t !== target) continue;
        var opts = { bubbles: true, cancelable: true, view: window };
        r.dispatchEvent(new MouseEvent('mousedown', opts));
        r.dispatchEvent(new MouseEvent('mouseup', opts));
        r.dispatchEvent(new MouseEvent('click', opts));
        r.dispatchEvent(new MouseEvent('dblclick', opts));
        return { confirmed: true };
      }
      return { confirmed: false };
    })()
  `);
  await delay(800);

  return {
    selected: pick.selected,
    candidates: pick.candidates || [],
    meta: pick.meta || null,
    confirmed: confirmed?.confirmed === true,
  };
}

/**
 * Authoritatively open a script from the Open-script picker by invoking the
 * row's scriptItem.openAction() — TradingView's own open command (it blurs
 * the search input then loads scriptIdPart+version into the editor). This is
 * the reliable path; raw DOM double-click/Enter are swallowed by the picker.
 *
 * Falls back to the pine-facade scriptIdPart URL when openAction is absent.
 * Returns { opened, name, via, scriptIdPart } or { opened:false }.
 */
export async function openViaOpenDialog(name, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const target = String(name).trim();
  if (!target) throw new Error('Script name is required.');

  const sel = await openScriptDialogAndSelect(target, _deps);
  const matches = (header) => {
    if (!header) return false;
    const h = String(header).toLowerCase();
    return [target, sel?.selected, sel?.meta?.name, sel?.meta?.scriptTitle]
      .filter(Boolean)
      .some((n) => String(n).toLowerCase() === h);
  };

  // See if the dialog gesture already opened it
  let identity = await getEditorIdentity(_deps).catch(() => null);
  if (matches(identity?.name)) {
    await dismissOpenDialog(_deps).catch(() => {});
    return { opened: true, name: identity.name, via: 'dialog_gesture', scriptIdPart: sel?.meta?.scriptIdPart || null };
  }

  // Primary: invoke scriptItem.openAction() for the selected row
  const invoked = await evalFn(`
    (function() {
      var target = ${safeString(target.toLowerCase())};
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return { err: 'no dialog' };
      var rows = dlg.querySelectorAll(${JSON.stringify(OPEN_DIALOG_ROW_SELECTOR)});
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var t = (${ROW_TITLE_EXPR}).toLowerCase();
        if (t !== target) continue;
        var si = (${readFiberPropExpression('scriptItem', 'r')});
        if (si && typeof si.openAction === 'function') {
          try { si.openAction(); return { invoked: true, id: si.id || null }; }
          catch (e) { return { err: 'openAction failed: ' + (e.message || '').slice(0, 60) }; }
        }
        return { err: 'no openAction on row' };
      }
      return { err: 'row not found' };
    })()
  `);

  if (invoked?.invoked) {
    for (let i = 0; i < 16; i++) {
      await delay(400);
      identity = await getEditorIdentity(_deps).catch(() => null);
      if (matches(identity?.name)) {
        await dismissOpenDialog(_deps).catch(() => {});
        return {
          opened: true,
          name: identity.name,
          via: 'open_action',
          scriptIdPart: (invoked.id ? String(invoked.id).replace(/^USER;/, '') : null) || sel?.meta?.scriptIdPart || null,
        };
      }
    }
  }

  // Fallback: navigate to the facade scriptIdPart URL
  const scriptIdPart = sel?.meta?.scriptIdPart
    || (invoked?.id ? String(invoked.id).replace(/^USER;/, '') : null);
  if (scriptIdPart) {
    await dismissOpenDialog(_deps).catch(() => {});
    await evalFn(`
      (function() {
        var id = ${JSON.stringify(scriptIdPart)};
        var url = 'https://www.tradingview.com/pine/?script_id_part=' + encodeURIComponent(id);
        try { window.location.assign(url); } catch (e) { window.location.href = url; }
        return url;
      })()
    `);
    for (let i = 0; i < 40; i++) {
      await delay(500);
      identity = await getEditorIdentity(_deps).catch(() => null);
      if (matches(identity?.name)) {
        return { opened: true, name: identity.name, via: 'script_id_url', scriptIdPart };
      }
    }
  }

  return { opened: false, name: identity?.name || null, via: 'failed', scriptIdPart };
}


/**
 * Scrape script names currently listed in the Open dialog (opens and closes it).
 */
export async function scrapeOpenDialogNames(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  await openOpenScriptDialog(_deps);
  await delay(600);

  // Focus the search input and type to force the (virtualized) list to render,
  // then harvest the visible itemRow titles.
  await evalFn(`
    (function() {
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return;
      var inp = dlg.querySelector('input');
      if (inp) (${setNativeValueExpression(' ', 'inp')});
    })()
  `);
  await delay(900);

  const names = await evalFn(`
    (function() {
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return [];
      var rows = dlg.querySelectorAll(${JSON.stringify(OPEN_DIALOG_ROW_SELECTOR)});
      var out = [];
      var seen = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!(r.offsetParent !== null || r.getClientRects().length > 0)) continue;
        var t = ${ROW_TITLE_EXPR};
        if (!t || t.length > 100) continue;
        if (/^(open|cancel|close|my scripts|built-in|search)/i.test(t)) continue;
        var k = t.toLowerCase();
        if (seen[k]) continue;
        seen[k] = true;
        out.push(t);
      }
      return out;
    })()
  `);

  await dismissOpenDialog(_deps);
  return Array.isArray(names) ? names : [];
}

/**
 * Check whether a script name appears when searching the Open dialog.
 */
export async function isNameInOpenDialog(name, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  await openOpenScriptDialog(_deps);
  await delay(500);
  await evalFn(`
    (function() {
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return false;
      var inp = dlg.querySelector('input[type="search"], input[type="text"], input:not([type])');
      if (!inp) return false;
      (${setNativeValueExpression(String(name), 'inp')});
      return true;
    })()
  `);
  await delay(600);
  const found = await evalFn(`
    (function() {
      var target = ${safeString(String(name).toLowerCase())};
      ${FIND_OPEN_DIALOG_EXPR}
      if (!dlg) return false;
      var text = (dlg.textContent || '').toLowerCase();
      return text.indexOf(target) !== -1;
    })()
  `);
  await dismissOpenDialog(_deps);
  return !!found;
}

// Reads the pine-facade REST API from the page context (credentials:'include')
// so the browser session cookie authenticates the request. A Node-side fetch
// was tried and reverted: it drops the session cookie and always returns an
// empty list. evalAsync is injectable for tests.
export async function fetchFacadeList(filter = 'saved', _deps = {}) {
  const evalAsync = _deps.evaluateAsync || evaluateAsync;
  const result = await evalAsync(`
    fetch(${JSON.stringify(PINE_FACADE + '/list/?filter=' + filter)}, { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return { scripts: [], error: 'Unexpected response from pine-facade' };
        return { scripts: data };
      })
      .catch(function(e) { return { scripts: [], error: e.message }; })
  `);
  return result || { scripts: [], error: 'No response' };
}

export async function lookupFacadeScript({ name, id } = {}, _deps = {}) {
  const { scripts, error } = await fetchFacadeList('saved', _deps);
  if (error && (!scripts || !scripts.length)) throw new Error(error);
  if (id) {
    const byId = scripts.find((s) => s.scriptIdPart === id || s.id === id);
    if (!byId) throw new Error(`Script id "${id}" not found in saved list.`);
    return byId;
  }
  if (!name) throw new Error('name or id is required.');
  const target = String(name).toLowerCase();
  let match = scripts.find((s) => {
    const sn = (s.scriptName || '').toLowerCase();
    const st = (s.scriptTitle || '').toLowerCase();
    return sn === target || st === target;
  });
  if (!match) {
    const partial = scripts.filter((s) => {
      const sn = (s.scriptName || '').toLowerCase();
      const st = (s.scriptTitle || '').toLowerCase();
      return sn.includes(target) || st.includes(target);
    });
    if (partial.length === 1) match = partial[0];
    else if (partial.length > 1) {
      throw new Error(
        `Ambiguous script name "${name}". Candidates: `
        + partial.slice(0, 8).map((s) => s.scriptName || s.scriptTitle).join(', ')
      );
    }
  }
  if (!match) throw new Error(`Script "${name}" not found. Use pine_list_scripts to see available scripts.`);
  return match;
}

export async function studyCount(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  return evalFn(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);
}

export { delay };
