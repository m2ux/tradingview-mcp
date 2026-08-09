/**
 * Tests for the general-purpose UI driver verbs. Pure-builder coverage
 * (findElementExpression, clickAt payload), injected-evaluate coverage of
 * waitFor polling, netRequest URL validation (no network), and capability
 * gating of the two power verbs (net_request, ui_fiber_action).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findElementExpression, clickAt } from '../src/core/dom.js';
import { netRequest, waitFor } from '../src/core/ui.js';
import { clickVisibleButton, fetchFacadeList, fillDialogInput } from '../src/core/pine_ui.js';
import { GATED_TOOLS, isAllowed } from '../src/capabilities.js';

describe('findElementExpression() — pure builder', () => {
  it('interpolates strategy and value as escaped data, not code', () => {
    const src = findElementExpression({ by: 'aria-label', value: 'a"] or 1=1; //' });
    assert.match(src, /var el = null/);
    assert.match(src, /CSS\.escape/);
    assert.ok(src.includes(JSON.stringify('a"] or 1=1; //')));
  });

  it('honours a custom target variable', () => {
    const src = findElementExpression({ by: 'text', value: 'Open', targetVar: 'btn' });
    assert.match(src, /var btn = null/);
    assert.ok(!/var el = null/.test(src));
  });

  it('emits a visibility predicate so hidden nodes do not resolve', () => {
    const src = findElementExpression({ by: 'data-name', value: 'alerts' });
    assert.match(src, /offsetParent !== null \|\| .*getClientRects\(\)\.length > 0/);
  });
});

describe('clickAt() — trusted CDP click payload', () => {
  function stubClient(calls) {
    return async () => ({
      Input: { dispatchMouseEvent: async (payload) => { calls.push(payload); } },
    });
  }

  it('dispatches move → press → release for a left click', async () => {
    const calls = [];
    await clickAt(100, 200, {}, { getClient: stubClient(calls) });
    assert.deepEqual(calls.map((c) => c.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
    assert.equal(calls[1].button, 'left');
    assert.equal(calls[1].x, 100);
    assert.equal(calls[1].y, 200);
  });

  it('adds a second press/release for a double click', async () => {
    const calls = [];
    await clickAt(10, 20, { double: true }, { getClient: stubClient(calls) });
    const presses = calls.filter((c) => c.type === 'mousePressed');
    assert.equal(presses.length, 2);
    assert.equal(presses[1].clickCount, 2);
  });

  it('maps right button to button=right, buttons=2', async () => {
    const calls = [];
    await clickAt(1, 2, { button: 'right' }, { getClient: stubClient(calls) });
    assert.equal(calls[1].button, 'right');
    assert.equal(calls[1].buttons, 2);
  });
});

describe('waitFor() — polling semantics (injected evaluate)', () => {
  it('resolves met:true as soon as the predicate turns truthy', async () => {
    let calls = 0;
    const evaluate = async () => (++calls >= 3 ? 'ready' : false);
    const r = await waitFor({ expression: 'x', timeout_ms: 2000, interval_ms: 25 }, { evaluate });
    assert.equal(r.success, true);
    assert.equal(r.met, true);
    assert.equal(r.value, 'ready');
    assert.ok(calls >= 3, 'polled until truthy');
  });

  it('returns met:false after the timeout budget elapses', async () => {
    const evaluate = async () => false;
    const r = await waitFor({ expression: 'x', timeout_ms: 60, interval_ms: 25 }, { evaluate });
    assert.equal(r.success, false);
    assert.equal(r.met, false);
    assert.equal(r.timeout_ms, 60);
  });

  it('evaluates the exact expression it was given', async () => {
    const seen = [];
    const evaluate = async (expr) => { seen.push(expr); return true; };
    await waitFor({ expression: 'document.readyState === "complete"', timeout_ms: 100 }, { evaluate });
    assert.ok(seen[0].includes('document.readyState === "complete"'));
  });
});

describe('netRequest() — validation before any network', () => {
  it('rejects non-https URLs without touching the page', async () => {
    for (const url of ['http://evil.com', 'javascript:alert(1)', 'ftp://x', 'notaurl']) {
      await assert.rejects(() => netRequest({ url }), /https:/, url);
    }
  });

  it('rejects a missing URL', async () => {
    await assert.rejects(() => netRequest({}), /https:/);
  });
});

describe('fetchFacadeList() — page-context facade read (injected evaluateAsync)', () => {
  it('returns parsed scripts from an array response', async () => {
    const scripts = [{ scriptIdPart: 'abc', scriptName: 'My Lib' }];
    const evaluateAsync = async () => ({ scripts });
    const r = await fetchFacadeList('saved', { evaluateAsync });
    assert.deepEqual(r.scripts, scripts);
    assert.equal(r.error, undefined);
  });

  it('returns an error when the page response is not an array', async () => {
    const evaluateAsync = async () => ({ scripts: [], error: 'Unexpected response from pine-facade' });
    const r = await fetchFacadeList('saved', { evaluateAsync });
    assert.deepEqual(r.scripts, []);
    assert.match(r.error, /Unexpected response/);
  });

  it('surfaces a page-side failure as an error without throwing', async () => {
    const evaluateAsync = async () => ({ scripts: [], error: 'NetworkError when attempting to fetch resource.' });
    const r = await fetchFacadeList('saved', { evaluateAsync });
    assert.deepEqual(r.scripts, []);
    assert.match(r.error, /NetworkError/);
  });

  it('embeds the filter in the evaluated fetch URL', async () => {
    let seen;
    const evaluateAsync = async (expr) => { seen = expr; return { scripts: [] }; };
    await fetchFacadeList('saved', { evaluateAsync });
    assert.match(seen, /filter=saved/);
    assert.match(seen, /credentials: 'include'/);
  });
});

describe('dialog-scoped Pine controls', () => {
  it('requires button candidates to belong to a visible dialog-like container', async () => {
    let expression;
    const clicked = await clickVisibleButton(/^continue$/i, { withinDialog: true }, {
      evaluate: async (value) => {
        expression = value;
        return 'Continue';
      },
    });
    assert.equal(clicked, 'Continue');
    assert.match(expression, /closest\(dialogSelector\)/);
    assert.match(expression, /\[class~="js-dialog"\]/);
    assert.doesNotMatch(expression, /\[class\*="dialog"\]/);
    assert.doesNotMatch(expression, /\|\| document/);
    assert.match(expression, /matches\(text\) \|\| matches\(aria\)/);
    assert.match(expression, /re\.lastIndex = 0/);
  });

  it('returns true when an input is set', async () => {
    let expression;
    const evaluate = async (value) => {
      expression = value;
      return true;
    };
    const r = await fillDialogInput('My Script', {}, { evaluate });
    assert.equal(r, true);
    assert.match(expression, /closest\(dialogSelector\)/);
    assert.match(expression, /\[class~="js-dialog"\]/);
    assert.doesNotMatch(expression, /\[class\*="dialog"\]/);
    assert.match(expression, /\[contenteditable="true"\]/);
    assert.match(expression, /candidate\.tagName !== 'TEXTAREA'/);
    assert.match(expression, /isPublishWizard/);
    assert.match(expression, /publish new script/);
    assert.match(expression, /fallbackArea >= 1000/);
  });

  it('returns false when no input is found', async () => {
    const evaluate = async () => false;
    const r = await fillDialogInput('My Script', {}, { evaluate });
    assert.equal(r, false);
  });
});

describe('capability gating of the power verbs', () => {
  it('net_request and ui_fiber_action are gated tools', () => {
    assert.ok(GATED_TOOLS.has('net_request'));
    assert.ok(GATED_TOOLS.has('ui_fiber_action'));
  });

  it('denies both by default and permits them with TV_ALLOW_DANGEROUS=1', () => {
    assert.equal(isAllowed('net_request', {}), false);
    assert.equal(isAllowed('ui_fiber_action', {}), false);
    const env = { TV_ALLOW_DANGEROUS: '1' };
    assert.equal(isAllowed('net_request', env), true);
    assert.equal(isAllowed('ui_fiber_action', env), true);
  });

  it('leaves the ungated verbs always available', () => {
    assert.equal(isAllowed('ui_set_input', {}), true);
    assert.equal(isAllowed('ui_wait_for', {}), true);
    assert.equal(isAllowed('ui_click', {}), true);
  });
});
