/**
 * Pine Editor DOM helpers — identity, Open dialog, toolbar/dialog clicks.
 * Shared by pine_open / copy / publish / list enrichment.
 */
import { evaluate, evaluateAsync, getClient, safeString } from '../connection.js';

export const PINE_FACADE = 'https://pine-facade.tradingview.com/pine-facade';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const kind = s.scriptType || s.kind || s.extra?.scriptType || null;
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
      var btns = scope.querySelectorAll('button, [role="button"], a[class*="button"]');
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
  const evalFn = _deps.evaluate || evaluate;
  const ph = placeholderRegex instanceof RegExp
    ? placeholderRegex.source
    : (placeholderRegex || 'name|script|title|description');
  return evalFn(`
    (function() {
      var re = new RegExp(${JSON.stringify(ph)}, 'i');
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]') || document;
      var inputs = dlg.querySelectorAll('input, textarea');
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        if (inp.offsetParent === null && inp.getClientRects().length === 0) continue;
        var ph = (inp.placeholder || '') + ' ' + (inp.getAttribute('aria-label') || '') + ' ' + (inp.name || '');
        if (!re.test(ph) && inputs.length > 1) continue;
        inp.focus();
        var setter = Object.getOwnPropertyDescriptor(
          inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
        ).set;
        setter.call(inp, ${safeString(value)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      // Fallback: first visible text input in dialog
      for (var j = 0; j < inputs.length; j++) {
        var inp2 = inputs[j];
        if (inp2.type && inp2.type !== 'text' && inp2.type !== 'search' && inp2.tagName !== 'TEXTAREA') continue;
        if (inp2.offsetParent === null && inp2.getClientRects().length === 0) continue;
        inp2.focus();
        var setter2 = Object.getOwnPropertyDescriptor(
          inp2.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
        ).set;
        setter2.call(inp2, ${safeString(value)});
        inp2.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);
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

async function pressKey(key, modifiers = 0, _deps = {}) {
  const clientFn = _deps.getClient || getClient;
  const c = await clientFn();
  const codeMap = {
    o: { key: 'o', code: 'KeyO', vk: 79 },
    Escape: { key: 'Escape', code: 'Escape', vk: 27 },
    Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  };
  const info = codeMap[key] || { key, code: key, vk: 0 };
  await c.Input.dispatchKeyEvent({
    type: 'keyDown', modifiers, key: info.key, code: info.code, windowsVirtualKeyCode: info.vk,
  });
  await c.Input.dispatchKeyEvent({
    type: 'keyUp', key: info.key, code: info.code, windowsVirtualKeyCode: info.vk,
  });
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

  // Open dialog via Ctrl+O
  await pressKey('o', 2, _deps);
  await delay(600);

  // Focus search and type name
  const typed = await evalFn(`
    (function() {
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
      if (!dlg) return { error: 'Open script dialog not found after Ctrl+O' };
      var inp = dlg.querySelector('input[type="search"], input[type="text"], input:not([type])');
      if (!inp) return { error: 'Search input not found in Open script dialog' };
      inp.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${safeString(target)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    })()
  `);
  if (typed?.error) {
    await dismissOpenDialog(_deps);
    throw new Error(typed.error);
  }
  await delay(700);

  const pick = await evalFn(`
    (function() {
      var target = ${safeString(target.toLowerCase())};
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
      if (!dlg) return { error: 'Open script dialog closed unexpectedly' };
      var rows = dlg.querySelectorAll('[class*="item"], [class*="row"], [role="option"], [class*="result"], li, tr');
      var candidates = [];
      var exact = null;
      var contains = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.offsetParent === null && r.getClientRects().length === 0) continue;
        var t = (r.textContent || '').trim().split('\\n')[0].trim();
        if (!t || t.length > 120) continue;
        // Skip chrome
        if (/^(open|cancel|close|my scripts|built-in)/i.test(t)) continue;
        var tl = t.toLowerCase();
        // Prefer shorter title-like rows that match
        if (tl === target) { exact = { el: r, title: t }; candidates.push(t); continue; }
        if (tl.indexOf(target) !== -1) { contains.push({ el: r, title: t }); candidates.push(t); }
      }
      // Dedupe candidates
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
      // Double-click / Enter may be needed; click Open if present
      return { selected: pick.title, candidates: candidates };
    })()
  `);

  if (pick?.error) {
    await dismissOpenDialog(_deps);
    const err = new Error(pick.error);
    err.candidates = pick.candidates;
    throw err;
  }

  // Click Open / confirm if a button remains
  await delay(300);
  await clickVisibleButton(/^(open|ok|select)$/i, { withinDialog: true }, _deps);
  await pressKey('Enter', 0, _deps);
  await delay(800);

  return { selected: pick.selected, candidates: pick.candidates || [] };
}

/**
 * Scrape script names currently listed in the Open dialog (opens and closes it).
 */
export async function scrapeOpenDialogNames(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  await pressKey('o', 2, _deps);
  await delay(600);

  const names = await evalFn(`
    (function() {
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
      if (!dlg) return [];
      var rows = dlg.querySelectorAll('[class*="item"], [class*="row"], [role="option"], [class*="result"], li');
      var out = [];
      var seen = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.offsetParent === null && r.getClientRects().length === 0) continue;
        var t = (r.textContent || '').trim().split('\\n')[0].trim();
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
  await pressKey('o', 2, _deps);
  await delay(500);
  await evalFn(`
    (function() {
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
      if (!dlg) return false;
      var inp = dlg.querySelector('input[type="search"], input[type="text"], input:not([type])');
      if (!inp) return false;
      inp.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${safeString(name)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `);
  await delay(600);
  const found = await evalFn(`
    (function() {
      var target = ${safeString(String(name).toLowerCase())};
      var dlg = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
      if (!dlg) return false;
      var text = (dlg.textContent || '').toLowerCase();
      return text.indexOf(target) !== -1;
    })()
  `);
  await dismissOpenDialog(_deps);
  return !!found;
}

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
