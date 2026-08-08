/**
 * Tests for the capability allowlist gate (src/capabilities.js).
 * Covers deny-by-default gating, gate-open registration, removal of
 * ui_evaluate, and the stderr audit trail for skipped registrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REMOVED_TOOLS, GATED_TOOLS, isGateOpen, isAllowed, wrapRegistrar } from '../src/capabilities.js';

function stubServer() {
  const registered = [];
  return {
    registered,
    tool(name, ...rest) { registered.push(name); return { name }; },
  };
}

function stubLog() {
  const lines = [];
  return { lines, write(s) { lines.push(s); } };
}

describe('isGateOpen', () => {
  it('is closed by default and on non-"1" values', () => {
    assert.equal(isGateOpen({}), false);
    assert.equal(isGateOpen({ TV_ALLOW_DANGEROUS: '0' }), false);
    assert.equal(isGateOpen({ TV_ALLOW_DANGEROUS: 'true' }), false);
  });

  it('opens only on TV_ALLOW_DANGEROUS=1', () => {
    assert.equal(isGateOpen({ TV_ALLOW_DANGEROUS: '1' }), true);
  });
});

describe('isAllowed', () => {
  it('denies every gated tool when the gate is closed', () => {
    for (const name of GATED_TOOLS) {
      assert.equal(isAllowed(name, {}), false, `${name} denied by default`);
    }
  });

  it('permits every gated tool when the gate is open', () => {
    const env = { TV_ALLOW_DANGEROUS: '1' };
    for (const name of GATED_TOOLS) {
      assert.equal(isAllowed(name, env), true, `${name} registered on opt-in`);
    }
  });

  it('never permits removed tools, even with the gate open', () => {
    for (const name of REMOVED_TOOLS) {
      assert.equal(isAllowed(name, {}), false);
      assert.equal(isAllowed(name, { TV_ALLOW_DANGEROUS: '1' }), false);
    }
  });

  it('permits ordinary read tools regardless of gate state', () => {
    assert.equal(isAllowed('quote_get', {}), true);
    assert.equal(isAllowed('data_get_ohlcv', { TV_ALLOW_DANGEROUS: '1' }), true);
  });
});

describe('wrapRegistrar', () => {
  it('skips gated tools by default and registers read tools', () => {
    const server = wrapRegistrar(stubServer(), { env: {}, log: stubLog() });
    server.tool('quote_get', 'desc', {}, async () => {});
    server.tool('tv_update', 'desc', {}, async () => {});
    assert.deepEqual(server.registered, ['quote_get']);
  });

  it('registers gated tools when the gate is open', () => {
    const server = wrapRegistrar(stubServer(), { env: { TV_ALLOW_DANGEROUS: '1' }, log: stubLog() });
    server.tool('tv_update', 'desc', {}, async () => {});
    server.tool('batch_run', 'desc', {}, async () => {});
    assert.deepEqual(server.registered, ['tv_update', 'batch_run']);
  });

  it('never registers ui_evaluate regardless of gate state', () => {
    for (const env of [{}, { TV_ALLOW_DANGEROUS: '1' }]) {
      const server = wrapRegistrar(stubServer(), { env, log: stubLog() });
      server.tool('ui_evaluate', 'desc', {}, async () => {});
      assert.deepEqual(server.registered, []);
    }
  });

  it('logs every skipped registration to stderr for audit', () => {
    const log = stubLog();
    const server = wrapRegistrar(stubServer(), { env: {}, log });
    server.tool('tv_launch', 'desc', {}, async () => {});
    server.tool('ui_evaluate', 'desc', {}, async () => {});
    assert.equal(log.lines.length, 2);
    assert.match(log.lines[0], /tv_launch.*gated/);
    assert.match(log.lines[1], /ui_evaluate.*removed/);
  });

  it('passes registration through to the underlying server untouched', () => {
    const server = wrapRegistrar(stubServer(), { env: {}, log: stubLog() });
    const result = server.tool('quote_get', 'desc', {}, async () => {});
    assert.deepEqual(result, { name: 'quote_get' });
  });
});
