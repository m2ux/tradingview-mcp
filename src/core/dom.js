/**
 * Generic CDP / DOM automation primitives shared across core modules.
 *
 * Two families live here:
 *  - Node-side helpers that dispatch trusted Chrome DevTools Protocol input
 *    (pressKey) — these need a live CDP client.
 *  - Page-context snippet BUILDERS (setNativeValueExpression, isVisibleExpression,
 *    readFiberPropExpression) that return a JavaScript string to run inside an
 *    evaluate() call. They are pure functions of their arguments so they can be
 *    unit-tested without a browser.
 *
 * Consolidates idioms that were previously copy-pasted across pine.js,
 * pine_ui.js, indicators.js, ui.js and watchlist.js.
 */
import { getClient, safeString } from '../connection.js';
import { dispatchMouse, dispatchKey } from './protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch a trusted mouse click (move → press → release) at page
 * coordinates via CDP. This is the trusted counterpart to a synthetic
 * el.click(): it produces isTrusted events that React and native
 * handlers honour. button: 'left' | 'right' | 'middle'.
 */
export async function clickAt(x, y, { button = 'left', double = false } = {}, _deps = {}) {
  const clientFn = _deps.getClient || getClient;
  const c = await clientFn();
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  const btnNum = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
  await dispatchMouse(c,
    { type: 'mouseMoved', x, y },
    { type: 'mousePressed', x, y, button: btn, buttons: btnNum, clickCount: 1 },
    { type: 'mouseReleased', x, y, button: btn },
  );
  if (double) {
    await sleep(50);
    await dispatchMouse(c,
      { type: 'mousePressed', x, y, button: btn, buttons: btnNum, clickCount: 2 },
      { type: 'mouseReleased', x, y, button: btn },
    );
  }
  return { success: true, x, y, button: btn, double_click: !!double };
}

// ── Keyboard ────────────────────────────────────────────────────────────────

/**
 * Resolve a key name + modifier bitmask to a CDP dispatch payload.
 * Pure — exported for unit tests.
 *
 * modifiers bitmask (CDP): Alt=1, Ctrl=2, Meta=4, Shift=8.
 * Accepts either a numeric bitmask or an array of names (['ctrl','shift']).
 */
export function keyEventPayload(key, modifiers = 0) {
  let mod = modifiers;
  if (Array.isArray(modifiers)) {
    mod = 0;
    if (modifiers.includes('alt')) mod |= 1;
    if (modifiers.includes('ctrl')) mod |= 2;
    if (modifiers.includes('meta')) mod |= 4;
    if (modifiers.includes('shift')) mod |= 8;
  }
  const keyMap = {
    Enter: { code: 'Enter', vk: 13 },
    Escape: { code: 'Escape', vk: 27 },
    Tab: { code: 'Tab', vk: 9 },
    Backspace: { code: 'Backspace', vk: 8 },
    Delete: { code: 'Delete', vk: 46 },
    ArrowUp: { code: 'ArrowUp', vk: 38 },
    ArrowDown: { code: 'ArrowDown', vk: 40 },
    ArrowLeft: { code: 'ArrowLeft', vk: 37 },
    ArrowRight: { code: 'ArrowRight', vk: 39 },
    Space: { code: 'Space', vk: 32 },
    Home: { code: 'Home', vk: 36 },
    End: { code: 'End', vk: 35 },
    PageUp: { code: 'PageUp', vk: 33 },
    PageDown: { code: 'PageDown', vk: 34 },
    F1: { code: 'F1', vk: 112 },
    F2: { code: 'F2', vk: 113 },
    F5: { code: 'F5', vk: 116 },
  };
  if (keyMap[key]) return { modifiers: mod, key, code: keyMap[key].code, vk: keyMap[key].vk };
  // Single printable character → KeyX / DigitN style codes.
  if (typeof key === 'string' && key.length === 1) {
    const upper = key.toUpperCase();
    const isLetter = upper >= 'A' && upper <= 'Z';
    const isDigit = upper >= '0' && upper <= '9';
    const code = isLetter ? `Key${upper}` : isDigit ? `Digit${upper}` : key;
    const vk = upper.charCodeAt(0);
    return { modifiers: mod, key, code, vk };
  }
  // Already a code-like name (e.g. 'KeyO', 'Enter'); best effort.
  return { modifiers: mod, key, code: key, vk: 0 };
}

/**
 * Dispatch a trusted keyDown+keyUp pair via CDP.
 * modifiers: numeric bitmask (Alt=1 Ctrl=2 Meta=4 Shift=8) or array of names.
 * _deps.getClient is injectable for tests.
 */
export async function pressKey(key, modifiers = 0, _deps = {}) {
  const clientFn = _deps.getClient || getClient;
  const c = await clientFn();
  const p = keyEventPayload(key, modifiers);
  await dispatchKey(c, {
    type: 'keyDown',
    modifiers: p.modifiers,
    key: p.key,
    code: p.code,
    windowsVirtualKeyCode: p.vk,
    nativeVirtualKeyCode: p.vk,
  });
  await dispatchKey(c, {
    type: 'keyUp',
    key: p.key,
    code: p.code,
    windowsVirtualKeyCode: p.vk,
    nativeVirtualKeyCode: p.vk,
  });
  return { success: true, key, modifiers: p.modifiers };
}

// ── Page-context snippet builders (pure, unit-testable) ─────────────────────

/**
 * Page-context fragment: the canonical "is this element visible?" predicate.
 * TradingView uses offsetParent + getClientRects; hidden nodes fail both.
 * Expects a variable named `el` in scope.
 */
export const IS_VISIBLE_EXPR = '(el.offsetParent !== null || el.getClientRects().length > 0)';

/**
 * Build a page-context expression that sets a React-controlled input/textarea
 * value via the native setter (bypassing React's value tracker) then dispatches
 * input+change so React picks it up. Expects a variable named `inp` in scope.
 *
 * Pure builder — returns a JS source string.
 */
export function setNativeValueExpression(value, inputVar = 'inp') {
  return `
    (function() {
      var el = ${inputVar};
      el.focus();
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${safeString(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `;
}

/**
 * Build a page-context expression that resolves a single element by a
 * selector strategy, assigning it to `targetVar`. Returns the source string.
 * Strategies mirror ui_click/ui_find_element: aria-label, data-name, text,
 * class-contains. The element must be visible to resolve. Pure builder.
 */
export function findElementExpression({ by, value, targetVar = 'el' }) {
  const v = safeString(value);
  return `
    var ${targetVar} = null;
    (function() {
      var by = ${safeString(by)};
      var value = ${v};
      function vis(e) { return e && (e.offsetParent !== null || e.getClientRects().length > 0); }
      if (by === 'aria-label') {
        ${targetVar} = document.querySelector('[aria-label="' + CSS.escape(value) + '"]');
        if (!${targetVar}) ${targetVar} = document.querySelector('[aria-label*="' + CSS.escape(value) + '"]');
      } else if (by === 'data-name') {
        ${targetVar} = document.querySelector('[data-name="' + CSS.escape(value) + '"]');
      } else if (by === 'class-contains') {
        ${targetVar} = document.querySelector('[class*="' + CSS.escape(value) + '"]');
      } else {
        var cands = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], input, select, label, span, div');
        for (var i = 0; i < cands.length; i++) {
          var t = (cands[i].textContent || '').trim();
          if ((t === value || t.toLowerCase() === value.toLowerCase()) && vis(cands[i])) { ${targetVar} = cands[i]; break; }
        }
      }
      if (${targetVar} && !vis(${targetVar})) ${targetVar} = null;
    })();
  `;
}

/**
 * Build a page-context expression that walks the React fiber chain of an
 * element looking for a memoizedProps key, returning the first match.
 * Best-effort: newer React (createRoot) may not attach __reactFiber$ to DOM
 * nodes, in which case it returns null.
 *
 * propName: the memoizedProps key to find (e.g. 'scriptItem', 'value').
 * Pure builder — returns a JS source string.
 */
export function readFiberPropExpression(propName, elementVar = 'el', maxDepth = 20) {
  const decl = elementVar === 'el' ? '' : `var el = ${elementVar};`;
  return `
    (function() {
      ${decl}
      if (!el) return null;
      var fiberKey = Object.getOwnPropertyNames(el).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
      if (!fiberKey) return null;
      var cur = el[fiberKey];
      for (var d = 0; d < ${Number(maxDepth) || 20} && cur; d++) {
        var mp = cur.memoizedProps;
        if (mp && Object.prototype.hasOwnProperty.call(mp, ${safeString(propName)})) {
          return mp[${safeString(propName)}];
        }
        cur = cur.return;
      }
      return null;
    })()
  `;
}
