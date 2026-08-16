/**
 * Unit tests for issue #21 — pine_save fail-loud contract.
 *
 * pine_save must NEVER report success when the persisted cloud source does not
 * match the editor buffer. Version-bump / modified-cleared heuristics are not
 * accepted as success criteria, because a save that bumps the version while
 * persisting a different (e.g. placeholder-stub) source is exactly the silent
 * corruption this guards against. An unverified save returns success:false.
 *
 * The pure stub/panel/dialog helpers in pine_ui.js are tested here too; they
 * are no longer wired into save()/listScripts() but remain exported utilities.
 *
 * Pure unit — all page/facade seams are injected via _deps.
 *
 * Run: node --test tests/pine_facade_corruption.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderStubSource,
  dismissBlockingDialogs,
  restorePinePanel,
} from '../src/core/pine_ui.js';
import { save } from '../src/core/pine.js';

const E2E_STUB = '//@version=6\r\nindicator("E2E Test", overlay=true)\r\nplot(close)\n';
const REAL_LIB = '//@version=6\nlibrary("RSIZones")\nexport mint(float r) =>\n    r * 2\n';
const REAL_IND = '//@version=6\nindicator("RSI Zone Divergence SymLo", shorttitle="RSIZSymLo", overlay=true)\nlength = input.int(14)\nplot(close)\n';

describe('isPlaceholderStubSource', () => {
  it('flags the E2E placeholder stub', () => {
    assert.equal(isPlaceholderStubSource(E2E_STUB), true);
  });

  it('flags a bare template with only declaration + plot', () => {
    assert.equal(isPlaceholderStubSource('//@version=6\nindicator("My script")\nplot(close)'), true);
    assert.equal(isPlaceholderStubSource('indicator("X")\nplot(open)\nplot(high)'), true);
  });

  it('does NOT flag substantive scripts (libraries, indicators with logic)', () => {
    assert.equal(isPlaceholderStubSource(REAL_LIB), false);
    assert.equal(isPlaceholderStubSource(REAL_IND), false);
  });

  it('does NOT flag scripts whose only extra line is a comment-stripped assignment', () => {
    assert.equal(isPlaceholderStubSource('indicator("X")\nx = 1\nplot(close)'), false);
  });

  it('returns false for empty / non-string input', () => {
    assert.equal(isPlaceholderStubSource(''), false);
    assert.equal(isPlaceholderStubSource(null), false);
    assert.equal(isPlaceholderStubSource(undefined), false);
  });
});

describe('dismissBlockingDialogs', () => {
  it('returns dismissed:true with via "none" when no dialog is present', async () => {
    const r = await dismissBlockingDialogs({ evaluate: async () => false, pressKey: async () => {} });
    assert.equal(r.dismissed, true);
    assert.equal(r.via, 'none');
  });

  it('falls back to Escape when no close control is found', async () => {
    let escaped = 0;
    let presentChecks = 0;
    const evaluate = async (expr) => {
      if (/b.click/.test(expr)) return false;
      presentChecks += 1;
      return presentChecks <= 1;
    };
    const pressKey = async (key) => { if (key === 'Escape') escaped += 1; };
    const r = await dismissBlockingDialogs({ evaluate, pressKey });
    assert.ok(escaped >= 1);
    assert.equal(r.dismissed, true);
  });
});

describe('restorePinePanel', () => {
  it('returns was_stuck:false when the name button is already present', async () => {
    const r = await restorePinePanel({ evaluate: async () => true });
    assert.equal(r.restored, true);
    assert.equal(r.was_stuck, false);
  });

  it('reports restored:false when the panel never recovers', async () => {
    const r = await restorePinePanel({ evaluate: async () => false });
    assert.equal(r.was_stuck, true);
    assert.equal(r.restored, false);
  });
});

describe('save() — fail-loud verification (issue #21)', () => {
  function baseDeps(overrides = {}) {
    const target = { scriptIdPart: 'USER;eng', scriptName: 'RSIZoneDivEngine', scriptTitle: 'RSIZoneDivEngine', version: '3.0', modified: 1786523851 };
    return {
      evaluate: async () => false,
      ensurePineEditorOpen: async () => true,
      pressKey: async () => {},
      getEditorIdentity: async () => ({ name: 'RSIZoneDivEngine' }),
      getEditorBufferInfo: async () => ({ source: REAL_IND, declared_title: 'RSI Zone Divergence SymLo', char_count: REAL_IND.length }),
      lookupFacadeScript: async () => target,
      fetchScriptSource: async () => ({ ok: true, source: REAL_IND, via: 'GET /get/id' }),
      ...overrides,
    };
  }

  it('returns success:true when the persisted source matches the buffer', async () => {
    const r = await save({ _deps: baseDeps() });
    assert.equal(r.success, true);
    assert.equal(r.verified, true);
    assert.equal(r.persisted_matches_buffer, true);
    assert.equal(r.error, undefined);
  });

  it('returns success:false when the persisted source does NOT match the buffer (stub overwrite)', async () => {
    // Buffer holds the real indicator, but the cloud persisted a stub: the
    // version-bump is irrelevant — this must fail loud, not report success.
    const target = { scriptIdPart: 'USER;eng', scriptName: 'RSIZoneDivEngine', scriptTitle: 'E2E Test', version: '3.0', modified: 1786523851 };
    let call = 0;
    const r = await save({
      _deps: baseDeps({
        lookupFacadeScript: async () => { call += 1; return call === 1 ? target : { ...target, version: '4.0', modified: null }; },
        fetchScriptSource: async () => ({ ok: true, source: E2E_STUB, via: 'GET /get/id' }),
      }),
    });
    assert.equal(r.success, false);
    assert.equal(r.verified, false);
    assert.equal(r.persisted_matches_buffer, false);
    assert.match(r.error, /did not persist the buffer source/);
    assert.match(r.error, /silent-corruption/);
  });

  it('does NOT accept a version bump as success when the source mismatches', async () => {
    const target = { scriptIdPart: 'USER;eng', scriptName: 'X', scriptTitle: 'X', version: '3.0', modified: 1786523851 };
    let call = 0;
    const r = await save({
      _deps: baseDeps({
        getEditorIdentity: async () => ({ name: 'X' }),
        getEditorBufferInfo: async () => ({ source: 'DIFFERENT BUFFER', declared_title: 'X', char_count: 15 }),
        lookupFacadeScript: async () => { call += 1; return call === 1 ? target : { ...target, version: '4.0', modified: null }; },
        fetchScriptSource: async () => ({ ok: true, source: 'SOMETHING ELSE', via: 'GET /get/id' }),
      }),
    });
    assert.equal(r.success, false);
    assert.equal(r.verified, false);
    assert.ok(r.error);
  });

  it('flags bound_mismatch and fails when header and buffer resolve to different scripts', async () => {
    const header = { scriptIdPart: 'USER;a', scriptName: 'A', scriptTitle: 'A', version: '1.0', modified: null };
    const buffer = { scriptIdPart: 'USER;b', scriptName: 'B', scriptTitle: 'B', version: '1.0', modified: null };
    const r = await save({
      _deps: baseDeps({
        getEditorIdentity: async () => ({ name: 'A' }),
        getEditorBufferInfo: async () => ({ source: REAL_IND, declared_title: 'B', char_count: REAL_IND.length }),
        lookupFacadeScript: async ({ name }) => (name === 'A' ? header : buffer),
        fetchScriptSource: async () => ({ ok: true, source: 'NOT THE BUFFER', via: 'GET /get/id' }),
      }),
    });
    assert.equal(r.success, false);
    assert.equal(r.bound_mismatch, true);
    assert.match(r.error, /pine_bind/);
  });

  it('returns success:false with a clear error when the saved identity cannot be re-resolved', async () => {
    const target = { scriptIdPart: 'USER;eng', scriptName: 'RSIZoneDivEngine', scriptTitle: 'RSIZoneDivEngine', version: '3.0', modified: 1786523851 };
    let call = 0;
    const r = await save({
      _deps: baseDeps({
        lookupFacadeScript: async () => { call += 1; if (call === 1) return target; throw new Error('not found'); },
        fetchScriptSource: async () => ({ ok: true, source: 'DIFFERENT', via: 'GET /get/id' }),
      }),
    });
    assert.equal(r.success, false);
    assert.match(r.error, /did not verifiably persist|did not persist the buffer source/);
  });
});
