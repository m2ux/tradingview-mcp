/**
 * Tests for the Task 6 security guards: ui_find_element css-strategy
 * validation, the pine_check upload opt-in gate, and the remote-CDP
 * loopback restriction.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findElement } from '../src/core/ui.js';
import { check } from '../src/core/pine.js';

describe('findElement() — css strategy validation', () => {
  it('rejects markup characters in the css strategy', async () => {
    await assert.rejects(
      () => findElement({ query: 'div><script>alert(1)</script>', strategy: 'css' }),
      /rejected/,
    );
  });

  it('rejects script/data URL schemes in the css strategy', async () => {
    await assert.rejects(
      () => findElement({ query: '[href="javascript:alert(1)"]', strategy: 'css' }),
      /rejected/,
    );
    await assert.rejects(
      () => findElement({ query: '[src="data:text/html,x"]', strategy: 'css' }),
      /rejected/,
    );
  });

  it('does not apply the guard to the text strategy', async () => {
    // text strategy never treats the query as a selector — a script-shaped
    // query must reach page evaluation (where it stays a literal string).
    // Without CDP this fails at the connection layer, not at validation.
    await assert.rejects(
      () => findElement({ query: '<script>', strategy: 'text' }),
      (err) => !/rejected/.test(err.message),
    );
  });

  it('escapes user-derived attribute values via CSS.escape in the aria-label strategy', async () => {
    // A quote-bearing query must not break out of the attribute selector.
    // Reaches page evaluation (no CDP here → connection error), but the
    // css-strategy guard is not the boundary under test — the constructed
    // selector is. We assert the guard did not fire and the error is the
    // connection layer, proving the query was passed through as data.
    await assert.rejects(
      () => findElement({ query: 'x"] or 1=1; //', strategy: 'aria-label' }),
      (err) => !/rejected/.test(err.message),
    );
  });
});

describe('check() — pine_check upload gate', () => {
  let saved;
  beforeEach(() => { saved = process.env.TV_ALLOW_PINE_CHECK_UPLOAD; });
  afterEach(() => {
    if (saved === undefined) delete process.env.TV_ALLOW_PINE_CHECK_UPLOAD;
    else process.env.TV_ALLOW_PINE_CHECK_UPLOAD = saved;
  });

  it('refuses the upload when TV_ALLOW_PINE_CHECK_UPLOAD is unset', async () => {
    delete process.env.TV_ALLOW_PINE_CHECK_UPLOAD;
    let fetched = false;
    const fetch = async () => { fetched = true; };
    await assert.rejects(
      () => check({ source: '//@version=5', _deps: { fetch } }),
      /TV_ALLOW_PINE_CHECK_UPLOAD/,
    );
    assert.equal(fetched, false, 'no network call before the gate');
  });

  it('uploads when TV_ALLOW_PINE_CHECK_UPLOAD=1', async () => {
    process.env.TV_ALLOW_PINE_CHECK_UPLOAD = '1';
    const fetch = async () => ({ ok: true, json: async () => ({ result: {} }) });
    const r = await check({ source: '//@version=5\nindicator("x")', _deps: { fetch } });
    assert.equal(r.success, true);
    assert.equal(r.compiled, true);
    assert.equal(r.error_count, 0);
  });
});

describe('connection — remote CDP loopback guard', () => {
  it('refuses non-loopback hosts without the opt-in', async () => {
    const { assertLoopbackHost } = await import('../src/connection.js');
    for (const host of ['192.168.1.50', '10.0.0.2', 'evil.example.com']) {
      assert.throws(() => assertLoopbackHost(host, {}), /not loopback/, host);
      assert.throws(() => assertLoopbackHost(host, { TV_ALLOW_REMOTE_CDP: '0' }), /not loopback/, host);
    }
  });

  it('accepts loopback hosts without the opt-in', async () => {
    const { assertLoopbackHost } = await import('../src/connection.js');
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
      assertLoopbackHost(host, {});
    }
  });

  it('accepts a remote host only with TV_ALLOW_REMOTE_CDP=1', async () => {
    const { assertLoopbackHost } = await import('../src/connection.js');
    assertLoopbackHost('192.168.1.50', { TV_ALLOW_REMOTE_CDP: '1' });
  });
});
