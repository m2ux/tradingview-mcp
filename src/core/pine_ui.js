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
      function visible(el) {
        if (!el) return false;
        if (el.offsetParent === null && el.getClientRects().length === 0) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      function cleanName(raw) {
        if (!raw) return null;
        var t = String(raw).replace(/\\s+/g, ' ').trim();
        // Doubled labels: "TVSmokeLibTVSmokeLib" / "SavedSaved"
        t = t.replace(/^(.*?)\\1$/i, '$1').trim();
        t = t.split('\\n')[0].trim();
        if (!t || t.length > 80) return null;
        if (/^(add to chart|update on chart|save|saved|publish|publish script|open|new)/i.test(t)) return null;
        return t;
      }
      function usableMonaco() {
        var preferred = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
        for (var i = 0; i < preferred.length; i++) {
          if (visible(preferred[i]) && preferred[i].getBoundingClientRect().width >= 40) return preferred[i];
        }
        var any = document.querySelectorAll('.monaco-editor');
        for (var j = 0; j < any.length; j++) {
          if (visible(any[j]) && any[j].getBoundingClientRect().width >= 40) return any[j];
        }
        return null;
      }

      // 1) Visible overlay title (h2 next to Publish script) — most reliable in dialog mode.
      var h2s = document.querySelectorAll('h2');
      for (var h = 0; h < h2s.length; h++) {
        if (!visible(h2s[h])) continue;
        var hn = cleanName(h2s[h].textContent);
        if (hn) return { name: hn, source: 'h2' };
      }

      // 2) Pine editor header name button (class nameButton-*).
      var widgets = document.querySelectorAll('.tv-script-widget');
      for (var w = 0; w < widgets.length; w++) {
        if (!visible(widgets[w]) && widgets[w].getClientRects().length === 0) continue;
        var nameBtn = widgets[w].querySelector('[class*="nameButton"]');
        var n0 = cleanName(nameBtn && nameBtn.textContent);
        if (n0) return { name: n0, source: 'nameButton' };
      }

      // 3) Scope around a usable-sized Monaco (never the zero-size docked ghost).
      var mon = usableMonaco();
      var scope = null;
      if (mon) {
        var p = mon;
        for (var up = 0; up < 10 && p; up++) {
          if (p.querySelector) {
            var nb = p.querySelector('[class*="nameButton"], h2, [data-name="pine-script-title"]');
            if (nb && visible(nb)) { scope = p; break; }
          }
          p = p.parentElement;
        }
        if (!scope) scope = mon.parentElement;
      }
      if (!scope) {
        scope = document.querySelector('.pine-editor-container')
          || document.querySelector('[class*="pine-editor"]')
          || document.querySelector('[class*="layout__area--bottom"]');
      }
      if (!scope) return null;

      var titleBtn = scope.querySelector('[data-name="pine-script-title"]')
        || scope.querySelector('[class*="nameButton"]')
        || scope.querySelector('h2')
        || scope.querySelector('[class*="title"] button')
        || scope.querySelector('button[class*="scriptTitle"]')
        || scope.querySelector('[class*="scriptName"]');
      var n1 = cleanName(titleBtn && titleBtn.textContent);
      if (n1) return { name: n1, source: 'title' };

      var candidates = scope.querySelectorAll('button, [role="button"], h2, h3');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!visible(el)) continue;
        if (el.closest('.monaco-editor')) continue;
        var txt = cleanName(el.textContent);
        if (!txt) continue;
        var rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 48) {
          return { name: txt, source: 'candidate' };
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
      var dialogSelector = '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]';
      var btns = document.querySelectorAll('button, [role="button"], [role="menuitem"], a[class*="button"], [class*="menuItem"], [class*="item"] [class*="label"]');
      function matches(value) {
        if (!value) return false;
        re.lastIndex = 0;
        return re.test(value);
      }
      for (var i = btns.length - 1; i >= 0; i--) {
        var b = btns[i];
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        if (${withinDialog ? 'true' : 'false'}) {
          var container = b.closest(dialogSelector);
          if (!container || (container.offsetParent === null && container.getClientRects().length === 0)) continue;
        }
        var text = (b.textContent || '').replace(/\\s+/g, ' ').trim();
        var aria = (b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
        var title = (b.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
        if (matches(text) || matches(aria) || matches(title)) {
          b.click();
          return aria || title || text;
        }
      }
      return null;
    })()
  `);
}

export async function getVisibleDialogs(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const dialogs = await evalFn(`
    (function() {
      function isDialogSurface(node) {
        if (node.matches('[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"]')) {
          return true;
        }
        if (!node.matches('[class~="js-dialog"]')) return false;
        var text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        var controls = node.querySelectorAll('button, [role="button"], [role="radio"], label');
        for (var c = 0; c < controls.length; c++) {
          var label = ((controls[c].getAttribute('aria-label') || '') + ' ' + (controls[c].textContent || ''))
            .replace(/\\s+/g, ' ')
            .trim();
          if (/publish new script|publish existing script|publish private|publish public/i.test(label)) return true;
        }
        return /publish (?:new|existing) script/i.test(text)
          && /(?:continue|next|privacy|private|public|description)/i.test(text);
      }
      var nodes = document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]'
      );
      var out = [];
      var seen = [];
      for (var i = 0; i < nodes.length; i++) {
        var dlg = nodes[i];
        if (dlg.offsetParent === null && dlg.getClientRects().length === 0) continue;
        if (!isDialogSurface(dlg)) continue;
        if (seen.indexOf(dlg) !== -1) continue;
        var nested = dlg.querySelectorAll(
          '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]'
        );
        var hasVisibleNestedDialog = false;
        for (var n = 0; n < nested.length; n++) {
          if (
            (nested[n].offsetParent !== null || nested[n].getClientRects().length > 0)
            && isDialogSurface(nested[n])
          ) {
            hasVisibleNestedDialog = true;
            break;
          }
        }
        if (hasVisibleNestedDialog) continue;
        seen.push(dlg);
        var text = (dlg.innerText || dlg.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        var buttons = [];
        var btns = dlg.querySelectorAll('button, [role="button"]');
        for (var b = 0; b < btns.length; b++) {
          var btn = btns[b];
          if (btn.offsetParent === null && btn.getClientRects().length === 0) continue;
          var label = (btn.textContent || btn.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
          if (label && buttons.indexOf(label) === -1) buttons.push(label.substring(0, 80));
        }
        out.push({
          text: text.substring(0, 500),
          buttons: buttons,
          input_count: dlg.querySelectorAll('input, textarea').length,
        });
      }
      return out;
    })()
  `);
  return Array.isArray(dialogs) ? dialogs : [];
}

export async function fillDialogInput(value, { placeholderRegex } = {}, _deps = {}) {
  const ph = placeholderRegex instanceof RegExp
    ? placeholderRegex.source
    : (placeholderRegex || 'name|script|title|description');
  const evalFn = _deps.evaluate || evaluate;
  const result = await evalFn(`
    (function() {
      var re = new RegExp(${JSON.stringify(ph)}, 'i');
      var dialogSelector = '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]';
      var inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
      function visible(e) { return e && (e.offsetParent !== null || e.getClientRects().length > 0); }
      function setValue(inp) {
        inp.focus();
        if (inp.isContentEditable) {
          inp.textContent = ${JSON.stringify(String(value))};
        } else {
          var proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, ${JSON.stringify(String(value))});
        }
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      for (var i = inputs.length - 1; i >= 0; i--) {
        var inp = inputs[i];
        var container = inp.closest(dialogSelector);
        if (!visible(inp) || !visible(container)) continue;
        var meta = (inp.placeholder || '') + ' ' + (inp.getAttribute('aria-label') || '') + ' ' + (inp.getAttribute('name') || '');
        if (re.test(meta)) return setValue(inp);
      }
      var fallback = null;
      var fallbackArea = 0;
      for (var f = inputs.length - 1; f >= 0; f--) {
        var candidate = inputs[f];
        var candidateDialog = candidate.closest(dialogSelector);
        if (!visible(candidate) || !visible(candidateDialog)) continue;
        var dialogText = (candidateDialog.innerText || candidateDialog.textContent || '').replace(/\\s+/g, ' ').trim();
        var isPublishWizard = /publish script/i.test(dialogText)
          && /publish new script/i.test(dialogText)
          && /continue|next/i.test(dialogText);
        if ((!re.test(dialogText) && !isPublishWizard) || candidate.tagName !== 'TEXTAREA') continue;
        var rect = candidate.getBoundingClientRect();
        var area = rect.width * rect.height;
        if (area > fallbackArea) {
          fallback = candidate;
          fallbackArea = area;
        }
      }
      if (fallback && fallbackArea >= 1000) return setValue(fallback);
      return false;
    })()
  `);
  return result === true;
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
  }  if (!name) throw new Error('name or id is required.');
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

/**
 * Page-context probe: fetch a saved script's source body from the pine-facade
 * on-demand endpoint. The facade list payload leaves scriptSource empty, so the
 * body is fetched per-script. TradingView's own Open-script flow loads
 *   GET <facade>/get/<scriptIdPart>/<version>
 * which returns the body under the `source` key. We try that first (with the
 * entry's version), then a version-less and query-string variant as fallbacks.
 * Returns { ok, source, via, attempted }.
 */
export async function fetchScriptSource(scriptIdPart, version = null, _deps = {}) {
  const evalAsync = _deps.evaluateAsync || evaluateAsync;
  const id = String(scriptIdPart || '');
  if (!id) throw new Error('scriptIdPart is required.');
  const result = await evalAsync(`
    (async function() {
      var BASE = ${JSON.stringify(PINE_FACADE)};
      var id = ${safeString(id)};
      var version = ${version === null || version === undefined ? 'null' : safeString(String(version))};
      var enc = encodeURIComponent(id);
      var attempts = [];
      if (version !== null && version !== undefined && version !== '') {
        attempts.push({ via: 'GET /get/id/version', url: BASE + '/get/' + enc + '/' + encodeURIComponent(String(version)) });
      }
      attempts.push({ via: 'GET /get/id', url: BASE + '/get/' + enc });
      attempts.push({ via: 'GET /get/?script_id_part', url: BASE + '/get/?script_id_part=' + enc });
      var attempted = [];
      for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        attempted.push(a.via);
        try {
          var r = await fetch(a.url, { credentials: 'include' });
          if (!r.ok) continue;
          var j = await r.json();
          var src = (j && (j.source || j.scriptSource)) || null;
          if (typeof src === 'string' && src.length > 0) {
            return { ok: true, source: src, via: a.via, attempted: attempted };
          }
        } catch (e) { /* try next */ }
      }
      return { ok: false, source: null, via: null, attempted: attempted };
    })()
  `);
  return result || { ok: false, source: null, via: null, attempted: [] };
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

/**
 * Read the live Monaco buffer's source AND the title declared inside it
 * (indicator()/strategy()/library() first arg). This is the ground truth of
 * what a Save would actually persist — as opposed to the editor header name,
 * which can be stale when the buffer is bound to a different script than the
 * header shows (the unbound-editor trap behind pine_save verified:false).
 * Returns { source, declared_title, char_count } or null when no editor.
 */
export async function getEditorBufferInfo(_deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const result = await evalFn(`
    (function() {
      function usable(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return (el.offsetParent !== null || el.getClientRects().length > 0) && r.width >= 40 && r.height >= 40;
      }
      var c = null;
      var pref = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
      for (var i = 0; i < pref.length; i++) { if (usable(pref[i])) { c = pref[i]; break; } }
      if (!c) {
        var any = document.querySelectorAll('.monaco-editor');
        for (var j = 0; j < any.length; j++) { if (usable(any[j])) { c = any[j]; break; } }
      }
      if (!c) return null;
      var el = c, fk = null;
      for (var k = 0; k < 20; k++) { if (!el) break; fk = Object.keys(el).find(function(x) { return x.startsWith('__reactFiber$'); }); if (fk) break; el = el.parentElement; }
      if (!fk) return null;
      var cur = el[fk], ed = null;
      for (var d = 0; d < 15; d++) {
        if (!cur) break;
        if (cur.memoizedProps && cur.memoizedProps.value && cur.memoizedProps.value.monacoEnv) {
          var env = cur.memoizedProps.value.monacoEnv;
          if (env.editor && typeof env.editor.getEditors === 'function') {
            var eds = env.editor.getEditors();
            if (eds.length) { ed = eds[0]; break; }
          }
        }
        cur = cur.return;
      }
      if (!ed) return null;
      var src = ed.getValue();
      if (typeof src !== 'string') return null;
      var m = src.match(/(?:^|\\n)\\s*(?:indicator|strategy|library|study)\\s*\\(\\s*(?:title\\s*=\\s*)?(['"])((?:\\\\.|(?!\\1).)*)\\1/);
      var title = m ? m[2] : null;
      return { source: src, declared_title: title, char_count: src.length };
    })()
  `);
  return result || null;
}

export { delay };
