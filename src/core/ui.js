/**
 * Core UI automation logic.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';
import { pressKey, clickAt, findElementExpression } from './dom.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function click({ by, value, trusted = false } = {}) {
  const find = findElementExpression({ by, value, targetVar: 'el' });
  const result = await evaluate(`
    (function() {
      ${find}
      if (!el) return { found: false };
      el.click();
      var rect = el.getBoundingClientRect();
      return {
        found: true,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 80),
        aria_label: el.getAttribute('aria-label') || null,
        data_name: el.getAttribute('data-name') || null,
        pressed: el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true',
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    })()
  `);
  if (!result || !result.found) throw new Error('No matching element found for ' + by + '="' + value + '"');

  // trusted=true escalates: if the synthetic click left the control reporting
  // an un-activated aria state, re-issue a trusted CDP click at its centre so
  // React/native handlers that ignore untrusted events honour it.
  let via = 'synthetic';
  if (trusted && result.pressed === false && Number.isFinite(result.x) && Number.isFinite(result.y)) {
    await delay(50);
    await clickAt(result.x, result.y, { button: 'left' });
    via = 'trusted';
  }
  const { x, y, pressed, ...clicked } = result;
  return { success: true, via, clicked };
}

/**
 * Set a React-controlled input/textarea value via the native setter so React
 * registers the change. Resolves the input by placeholder/aria-label/name
 * (regex `match`), optionally scoped to the open dialog. Generic form of the
 * Pine dialog-fill idiom.
 */
export async function setInput({ value, match, within_dialog = true } = {}, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const re = match instanceof RegExp ? match.source : String(match || 'name|script|title|search|description');
  const result = await evalFn(`
    (function() {
      var re = new RegExp(${JSON.stringify(re)}, 'i');
      var scope = (${within_dialog ? 'true' : 'false'})
        ? (document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]') || document)
        : document;
      var inputs = scope.querySelectorAll('input, textarea');
      function vis(e) { return e && (e.offsetParent !== null || e.getClientRects().length > 0); }
      function commit(inp, matched, fallback) {
        inp.focus();
        var proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, ${JSON.stringify(String(value))});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        var r = { set: true, matched: String(matched).substring(0, 80) };
        if (fallback) r.fallback = true;
        return r;
      }
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        if (!vis(inp)) continue;
        var meta = (inp.placeholder || '') + ' ' + (inp.getAttribute('aria-label') || '') + ' ' + (inp.name || '');
        if (re.test(meta)) return commit(inp, meta.trim(), false);
      }
      for (var j = 0; j < inputs.length; j++) {
        var inp2 = inputs[j];
        if (!vis(inp2)) continue;
        if (inp2.type && inp2.type !== 'text' && inp2.type !== 'search' && inp2.tagName !== 'TEXTAREA') continue;
        return commit(inp2, inp2.placeholder || inp2.name || 'input', true);
      }
      return { set: false };
    })()
  `);
  if (!result || !result.set) throw new Error('No visible input matched "' + re + '"');
  return { success: true, ...result };
}

/**
 * Poll a page-context predicate until it returns truthy or the timeout
 * elapses. Replaces the fixed sleep chains scattered across UI flows with an
 * explicit, observable wait. `expression` must evaluate truthy when the
 * desired state is reached. _deps.evaluate is injectable for tests.
 */
export async function waitFor({ expression, timeout_ms = 5000, interval_ms = 150 } = {}, _deps = {}) {
  const evalFn = _deps.evaluate || evaluate;
  const budget = Math.max(0, Number(timeout_ms) || 0);
  const poll = Math.max(25, Number(interval_ms) || 150);
  const deadline = Date.now() + budget;
  let last;
  for (;;) {
    last = await evalFn(`(function(){ return (${expression}); })()`);
    if (last) return { success: true, met: true, value: last };
    if (Date.now() >= deadline) break;
    await delay(poll);
  }
  return { success: false, met: false, timeout_ms: budget, last: last ?? null };
}

/**
 * Invoke a component's own action handler by walking the React fiber chain of
 * a resolved element — the reliable path when raw DOM gestures are swallowed.
 * Reads `prop` from memoizedProps (default 'onClick') and calls it with
 * `args`. Registered gated (ui_fiber_action) behind TV_ALLOW_DANGEROUS.
 */
export async function fiberAction({ by, value, prop = 'onClick', args = [] } = {}) {
  const find = findElementExpression({ by, value, targetVar: 'el' });
  const result = await evaluate(`
    (function() {
      ${find}
      if (!el) return { found: false };
      var fiberKey = Object.getOwnPropertyNames(el).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
      if (!fiberKey) return { found: true, invoked: false, reason: 'no fiber on node' };
      var cur = el[fiberKey];
      var fn = null;
      for (var d = 0; d < 20 && cur && !fn; d++) {
        var mp = cur.memoizedProps;
        if (mp && typeof mp[${JSON.stringify(prop)}] === 'function') fn = mp[${JSON.stringify(prop)}];
        cur = cur.return;
      }
      if (!fn) return { found: true, invoked: false, reason: 'prop not a function up the fiber chain' };
      try { fn.apply(null, ${JSON.stringify(args)}); return { found: true, invoked: true, prop: ${JSON.stringify(prop)} }; }
      catch (e) { return { found: true, invoked: false, reason: 'handler threw: ' + (e.message || '').slice(0, 80) }; }
    })()
  `);
  if (!result || !result.found) throw new Error('No matching element found for ' + by + '="' + value + '"');
  if (!result.invoked) throw new Error('fiber action not invoked: ' + (result.reason || 'unknown'));
  return { success: true, ...result };
}

/**
 * Page-context authenticated fetch — the network-first escape hatch that
 * bypasses DOM driving where a backend endpoint exists (e.g. the pine-facade
 * REST API). Runs fetch() inside the page so session cookies are included.
 * Registered gated (net_request) behind TV_ALLOW_DANGEROUS. https: only.
 */
export async function netRequest({ url, method = 'GET', body, headers = {}, timeout_ms = 8000 } = {}) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error('net_request only permits absolute https: URLs');
  }
  const result = await evaluateAsync(`
    (function() {
      var ctrl = new AbortController();
      var t = setTimeout(function() { ctrl.abort(); }, ${Number(timeout_ms) || 8000});
      return fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: ${JSON.stringify(headers)},
        body: ${body === undefined ? 'undefined' : JSON.stringify(body)},
        signal: ctrl.signal,
      }).then(function(r) {
        clearTimeout(t);
        return r.text().then(function(text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) {}
          return { ok: r.ok, status: r.status, json: json, text: json ? null : text.slice(0, 4000) };
        });
      }).catch(function(e) {
        clearTimeout(t);
        return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch failed') };
      });
    })()
  `);
  if (!result) throw new Error('net_request: no response');
  if (result.error) throw new Error(`net_request failed (${result.error})`);
  return { success: result.ok !== false, ...result };
}

export async function openPanel({ panel, action }) {
  const isBottomPanel = panel === 'pine-editor' || panel === 'strategy-tester';
  if (isBottomPanel) {
    const widgetName = panel === 'pine-editor' ? 'pine-editor' : 'backtesting';
    const result = await evaluate(`
      (function() {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        if (!bwb) return { error: 'bottomWidgetBar not available' };
        var panel = ${JSON.stringify(panel)};
        var widgetName = ${JSON.stringify(widgetName)};
        var action = ${JSON.stringify(action)};
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]');
        var isOpen = !!(bottomArea && bottomArea.offsetHeight > 50);
        if (panel === 'pine-editor') { var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco'); isOpen = isOpen && !!monacoEl; }
        if (panel === 'strategy-tester') { var stratPanel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]'); isOpen = isOpen && !!(stratPanel && stratPanel.offsetParent); }
        var performed = 'none';
        if (action === 'open' || (action === 'toggle' && !isOpen)) {
          if (panel === 'pine-editor') { if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab(); else if (typeof bwb.showWidget === 'function') bwb.showWidget(widgetName); }
          else { if (typeof bwb.showWidget === 'function') bwb.showWidget(widgetName); }
          performed = 'opened';
        } else if (action === 'close' || (action === 'toggle' && isOpen)) {
          // hideWidget(name) was removed in newer TradingView builds; fall back to
          // close() (minimizes the bottom panel) and then hide() (hides the bar).
          if (typeof bwb.hideWidget === 'function') bwb.hideWidget(widgetName);
          else if (typeof bwb.close === 'function') bwb.close();
          else if (typeof bwb.hide === 'function') bwb.hide();
          performed = 'closed';
        }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  } else {
    // Newer TV builds renamed the right-rail buttons (watchlist is now
    // data-name="base", aria "Watchlist, details, and news"; alerts is
    // data-name="alerts") — keep legacy selectors as fallbacks.
    const selectorMap = {
      'watchlist': { dataNames: ['base-watchlist-widget-button', 'base'], ariaLabels: ['Watchlist', 'Watchlist, details, and news'] },
      'alerts': { dataNames: ['alerts-button', 'alerts'], ariaLabels: ['Alerts'] },
      'trading': { dataNames: ['trading-button'], ariaLabels: ['Trading Panel'] },
    };
    const sel = selectorMap[panel];
    const result = await evaluate(`
      (function() {
        var dataNames = ${JSON.stringify(sel.dataNames)};
        var ariaLabels = ${JSON.stringify(sel.ariaLabels)};
        var action = ${JSON.stringify(action)};
        var btn = null;
        for (var d = 0; d < dataNames.length && !btn; d++) btn = document.querySelector('[data-name="' + dataNames[d] + '"]');
        for (var a = 0; a < ariaLabels.length && !btn; a++) btn = document.querySelector('[aria-label="' + ariaLabels[a] + '"]');
        if (!btn) return { error: 'Button not found for panel: ' + ${JSON.stringify(panel)} };
        var isActive = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('isActive') || btn.classList.toString().indexOf('active') !== -1 || btn.classList.toString().indexOf('Active') !== -1;
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        var sidebarOpen = !!(rightArea && rightArea.offsetWidth > 50);
        var isOpen = isActive && sidebarOpen;
        var performed = 'none';
        if (action === 'open' && !isOpen) { btn.click(); performed = 'opened'; }
        else if (action === 'close' && isOpen) { btn.click(); performed = 'closed'; }
        else if (action === 'toggle') { btn.click(); performed = isOpen ? 'closed' : 'opened'; }
        else { performed = isOpen ? 'already_open' : 'already_closed'; }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  }
}

export async function fullscreen() {
  const result = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="header-toolbar-fullscreen"]');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    })()
  `);
  if (!result || !result.found) throw new Error('Fullscreen button not found');
  return { success: true, action: 'fullscreen_toggled' };
}

export async function layoutList() {
  const layouts = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts returned no data'}); return; }
          var result = charts.map(function(c) { return { id: c.id || c.chartId || null, name: c.name || c.title || 'Untitled', symbol: c.symbol || null, resolution: c.resolution || null, modified: c.timestamp || c.modified || null }; });
          resolve({layouts: result, source: 'internal_api'});
        });
        setTimeout(function() { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts timed out'}); }, 5000);
      } catch(e) { resolve({layouts: [], source: 'internal_api', error: e.message}); }
    })
  `);
  return { success: true, layout_count: layouts?.layouts?.length || 0, source: layouts?.source, layouts: layouts?.layouts || [], error: layouts?.error };
}

export async function layoutSwitch({ name }) {
  const escaped = JSON.stringify(name);
  const result = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        var target = ${escaped};
        if (/^\\d+$/.test(target)) { window.TradingViewApi.loadChartFromServer(target); resolve({success: true, method: 'loadChartFromServer', id: target, source: 'internal_api'}); return; }
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({success: false, error: 'getSavedCharts returned no data', source: 'internal_api'}); return; }
          var match = null;
          for (var i = 0; i < charts.length; i++) { var cname = charts[i].name || charts[i].title || ''; if (cname === target || cname.toLowerCase() === target.toLowerCase()) { match = charts[i]; break; } }
          if (!match) { for (var j = 0; j < charts.length; j++) { var cn = (charts[j].name || charts[j].title || '').toLowerCase(); if (cn.indexOf(target.toLowerCase()) !== -1) { match = charts[j]; break; } } }
          if (!match) { resolve({success: false, error: 'Layout "' + target + '" not found.', source: 'internal_api'}); return; }
          var chartId = match.id || match.chartId;
          window.TradingViewApi.loadChartFromServer(chartId);
          resolve({success: true, method: 'loadChartFromServer', id: chartId, name: match.name || match.title, source: 'internal_api'});
        });
        setTimeout(function() { resolve({success: false, error: 'getSavedCharts timed out', source: 'internal_api'}); }, 5000);
      } catch(e) { resolve({success: false, error: e.message, source: 'internal_api'}); }
    })
  `);
  if (!result?.success) throw new Error(result?.error || 'Unknown error switching layout');

  // Handle "unsaved changes" confirmation dialog
  await new Promise(r => setTimeout(r, 500));
  const dismissed = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/open anyway|don't save|discard/i.test(text)) {
          btns[i].click();
          return true;
        }
      }
      return false;
    })()
  `);

  if (dismissed) await new Promise(r => setTimeout(r, 1000));
  return { success: true, layout: result.name || name, layout_id: result.id, source: result.source, action: 'switched', unsaved_dialog_dismissed: dismissed };
}

export async function keyboard({ key, modifiers }) {
  await pressKey(key, modifiers || 0);
  return { success: true, key, modifiers: modifiers || [] };
}

export async function typeText({ text }) {
  const c = await getClient();
  await c.Input.insertText({ text });
  return { success: true, typed: text.substring(0, 100), length: text.length };
}

export async function hover({ by, value }) {
  const coords = await evaluate(`
    (function() {
      var by = ${JSON.stringify(by)};
      var value = ${JSON.stringify(value)};
      var el = null;
      if (by === 'aria-label') {
        el = document.querySelector('[aria-label="' + CSS.escape(value) + '"]');
        if (!el) el = document.querySelector('[aria-label*="' + CSS.escape(value) + '"]');
      }
      else if (by === 'data-name') el = document.querySelector('[data-name="' + CSS.escape(value) + '"]');
      else if (by === 'text') {
        var candidates = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], span, div');
        for (var i = 0; i < candidates.length; i++) { var text = candidates[i].textContent.trim(); if (text === value || text.toLowerCase() === value.toLowerCase()) { el = candidates[i]; break; } }
      } else if (by === 'class-contains') el = document.querySelector('[class*="' + CSS.escape(value) + '"]');
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName.toLowerCase() };
    })()
  `);
  if (!coords) throw new Error('Element not found for ' + by + '="' + value + '"');
  const c = await getClient();
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: coords.x, y: coords.y });
  return { success: true, hovered: { by, value, tag: coords.tag, x: coords.x, y: coords.y } };
}

export async function scroll({ direction, amount }) {
  const c = await getClient();
  const px = amount || 300;
  const center = await evaluate(`
    (function() {
      var el = document.querySelector('[data-name="pane-canvas"]') || document.querySelector('[class*="chart-container"]') || document.querySelector('canvas');
      if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()
  `);
  let deltaX = 0, deltaY = 0;
  if (direction === 'up') deltaY = -px; else if (direction === 'down') deltaY = px;
  else if (direction === 'left') deltaX = -px; else if (direction === 'right') deltaX = px;
  await c.Input.dispatchMouseEvent({ type: 'mouseWheel', x: center.x, y: center.y, deltaX, deltaY });
  return { success: true, direction, amount: px };
}

export async function mouseClick({ x, y, button, double_click }) {
  const c = await getClient();
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  const btnNum = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
  await c.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: btn, buttons: btnNum, clickCount: 1 });
  await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: btn });
  if (double_click) {
    await new Promise(r => setTimeout(r, 50));
    await c.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: btn, buttons: btnNum, clickCount: 2 });
    await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: btn });
  }
  return { success: true, x, y, button: btn, double_click: !!double_click };
}

export async function findElement({ query, strategy }) {
  const strat = strategy || 'text';
  if (strat === 'css' && /[<>]|\b(?:javascript|data|vbscript)\s*:/i.test(query)) {
    throw new Error('ui_find_element css strategy rejected the query: markup characters and script/data URL schemes are not allowed');
  }
  const results = await evaluate(`
    (function() {
      var query = ${JSON.stringify(query)};
      var strategy = ${JSON.stringify(strat)};
      var results = [];
      if (strategy === 'css') {
        var els = document.querySelectorAll(query);
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else if (strategy === 'aria-label') {
        var els = document.querySelectorAll('[aria-label*="' + CSS.escape(query) + '"]');
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else {
        var all = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], input, select, label, span, div, h1, h2, h3, h4');
        for (var i = 0; i < all.length; i++) {
          var text = all[i].textContent.trim();
          if (text.toLowerCase().indexOf(query.toLowerCase()) !== -1 && text.length < 200) {
            var rect = all[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({ tag: all[i].tagName.toLowerCase(), text: text.substring(0, 80), aria_label: all[i].getAttribute('aria-label') || null, data_name: all[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: all[i].offsetParent !== null });
              if (results.length >= 20) break;
            }
          }
        }
      }
      return results;
    })()
  `);
  return { success: true, query, strategy: strat, count: results?.length || 0, elements: results || [] };
}

export async function uiEvaluate({ expression }) {
  const result = await evaluate(expression);
  return { success: true, result };
}
