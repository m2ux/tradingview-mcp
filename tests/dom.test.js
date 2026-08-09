/**
 * Unit tests for src/core/dom.js — generic CDP/DOM primitives.
 * Pure builders and the keymap are tested without a browser; pressKey is
 * tested with an injected CDP client stub.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  keyEventPayload,
  pressKey,
  IS_VISIBLE_EXPR,
  setNativeValueExpression,
  readFiberPropExpression,
} from '../src/core/dom.js';

describe('keyEventPayload', () => {
  it('maps named keys to code + virtual key', () => {
    assert.deepEqual(keyEventPayload('Enter'), { modifiers: 0, key: 'Enter', code: 'Enter', vk: 13 });
    assert.deepEqual(keyEventPayload('Escape'), { modifiers: 0, key: 'Escape', code: 'Escape', vk: 27 });
    assert.deepEqual(keyEventPayload('Tab', 2), { modifiers: 2, key: 'Tab', code: 'Tab', vk: 9 });
  });

  it('maps single letters to KeyX with correct vk', () => {
    const p = keyEventPayload('o');
    assert.equal(p.code, 'KeyO');
    assert.equal(p.vk, 79);
    assert.equal(p.key, 'o');
  });

  it('maps digits to DigitN', () => {
    const p = keyEventPayload('5');
    assert.equal(p.code, 'Digit5');
    assert.equal(p.vk, '5'.charCodeAt(0));
  });

  it('accepts a numeric modifier bitmask', () => {
    assert.equal(keyEventPayload('s', 2).modifiers, 2);
    assert.equal(keyEventPayload('s', 2 | 8).modifiers, 10);
  });

  it('accepts modifier name arrays (ctrl/shift/alt/meta)', () => {
    assert.equal(keyEventPayload('s', ['ctrl']).modifiers, 2);
    assert.equal(keyEventPayload('s', ['ctrl', 'shift']).modifiers, 10);
    assert.equal(keyEventPayload('s', ['alt', 'meta']).modifiers, 5);
  });

  it('falls back gracefully for code-like names', () => {
    const p = keyEventPayload('KeyO');
    assert.equal(p.code, 'KeyO');
    assert.equal(p.key, 'KeyO');
  });
});

describe('pressKey', () => {
  it('dispatches keyDown then keyUp with mapped payload', async () => {
    const calls = [];
    const fakeClient = {
      Input: {
        dispatchKeyEvent: async (e) => { calls.push(e); },
      },
    };
    await pressKey('s', 2, { getClient: async () => fakeClient });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].type, 'keyDown');
    assert.equal(calls[1].type, 'keyUp');
    assert.equal(calls[0].key, 's');
    assert.equal(calls[0].code, 'KeyS');
    assert.equal(calls[0].windowsVirtualKeyCode, 83);
    assert.equal(calls[0].modifiers, 2);
  });

  it('accepts modifier name arrays', async () => {
    const calls = [];
    const fakeClient = { Input: { dispatchKeyEvent: async (e) => calls.push(e) } };
    await pressKey('Enter', ['ctrl'], { getClient: async () => fakeClient });
    assert.equal(calls[0].modifiers, 2);
    assert.equal(calls[0].code, 'Enter');
  });
});

describe('IS_VISIBLE_EXPR', () => {
  it('references offsetParent and getClientRects for el', () => {
    assert.match(IS_VISIBLE_EXPR, /offsetParent/);
    assert.match(IS_VISIBLE_EXPR, /getClientRects/);
    assert.match(IS_VISIBLE_EXPR, /\bel\b/);
  });
});

describe('setNativeValueExpression', () => {
  it('emits a native setter snippet with the value safely embedded', () => {
    const expr = setNativeValueExpression('MyScript');
    assert.match(expr, /Object\.getOwnPropertyDescriptor/);
    assert.match(expr, /HTMLInputElement\.prototype/);
    assert.match(expr, /HTMLTextAreaElement\.prototype/);
    assert.match(expr, /"MyScript"/);
    assert.match(expr, /new Event\('input'/);
    assert.match(expr, /new Event\('change'/);
  });

  it('escapes quotes/backslashes in the value (injection-safe)', () => {
    const expr = setNativeValueExpression('a"b\\c`d');
    // safeString → JSON.stringify: the value must appear as a valid JS string literal
    assert.match(expr, /"a\\"b\\\\c`d"/);
  });

  it('respects a custom input variable name', () => {
    const expr = setNativeValueExpression('x', 'target');
    assert.match(expr, /var el = target;/);
  });

  it('is evaluable JS that sets the input value (jsdom-free smoke via Function)', () => {
    // Minimal DOM stubs sufficient for the snippet's own logic.
    const listeners = [];
    const el = {
      tagName: 'INPUT',
      focus() {},
      dispatchEvent: (e) => { listeners.push(e.type); return true; },
      value: '',
    };
    const proto = Object.getPrototypeOf(el);
    // Simulate the native setter existence check by defining it
    const holder = {};
    global.HTMLInputElement = function () {};
    global.HTMLTextAreaElement = function () {};
    Object.defineProperty(global.HTMLInputElement.prototype, 'value', {
      set(v) { el.value = v; },
      configurable: true,
    });
    Object.defineProperty(global.HTMLTextAreaElement.prototype, 'value', {
      set(v) { el.value = v; },
      configurable: true,
    });
    global.Event = class { constructor(type, opts) { this.type = type; this.bubbles = !!opts?.bubbles; } };
    // Wrap: provide `inp` in scope
    const run = new Function('inp', `return (${setNativeValueExpression('hello', 'inp')});`);
    run(el);
    assert.equal(el.value, 'hello');
    assert.deepEqual(listeners, ['input', 'change']);
    delete global.HTMLInputElement;
    delete global.HTMLTextAreaElement;
    delete global.Event;
    void proto; void holder;
  });
});

describe('readFiberPropExpression', () => {
  it('emits a fiber-walk snippet targeting the requested prop', () => {
    const expr = readFiberPropExpression('scriptItem');
    assert.match(expr, /__reactFiber\$/);
    assert.match(expr, /memoizedProps/);
    assert.match(expr, /"scriptItem"/);
    assert.match(expr, /cur\.return/);
  });

  it('respects custom element var and depth', () => {
    const expr = readFiberPropExpression('value', 'node', 5);
    assert.match(expr, /var el = node;/);
    assert.match(expr, /d < 5/);
  });

  it('returns the prop from a mocked fiber chain', () => {
    const el = {};
    const scriptItem = { id: 'USER;abc', name: 'X' };
    // Build a fake fiber: el.__reactFiber$xxx → { memoizedProps: {} } → .return → { memoizedProps: { scriptItem } }
    const fk = '__reactFiber$test';
    el[fk] = {
      memoizedProps: {},
      return: { memoizedProps: { scriptItem }, return: null },
    };
    const run = new Function('el', `return (${readFiberPropExpression('scriptItem', 'el')});`);
    assert.deepEqual(run(el), scriptItem);
  });

  it('returns null when no fiber backlink exists', () => {
    const run = new Function('el', `return (${readFiberPropExpression('value', 'el')});`);
    assert.equal(run({}), null);
  });
});
