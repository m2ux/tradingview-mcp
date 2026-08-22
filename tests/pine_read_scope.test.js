/**
 * pine_read_script lookup scope: all / saved / published, library preference,
 * and user/Lib/N import specs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readScript, parseImportSpec } from '../src/core/pine.js';

const LIB_SRC = '//@version=6\nlibrary("RSIZones")\nexport type Mint\nexport step() => 1\n';
const STUDY_SRC = '//@version=6\nindicator("RSIZones")\nplot(close)\n';

function lookupByFilter(rows) {
  return async ({ filter, id, name } = {}) => {
    const list = rows[filter] || [];
    if (id) {
      const hit = list.find((s) => s.scriptIdPart === id || s.id === id);
      if (!hit) {
        const err = new Error(`Script id "${id}" not found in ${filter} list.`);
        err.code = 'TV_SCRIPT_NOT_FOUND';
        throw err;
      }
      return hit;
    }
    const target = String(name || '').toLowerCase();
    const hit = list.find((s) => (s.scriptName || '').toLowerCase() === target);
    if (!hit) {
      const err = new Error(`Script "${name}" not found.`);
      err.code = 'TV_SCRIPT_NOT_FOUND';
      throw err;
    }
    return hit;
  };
}

const RSIZONES = {
  saved: [{
    scriptIdPart: 'USER;5b48c567',
    scriptName: 'RSIZones',
    scriptTitle: 'E2E Test',
    version: '1.0',
    extra: { kind: 'study' },
  }],
  published: [{
    scriptIdPart: 'PUB;75ceaefbe37b4aebb688a4859aebf0fb',
    scriptName: 'RSIZones',
    version: '1.0',
    extra: { kind: 'library' },
  }],
};

describe('parseImportSpec', () => {
  it('parses user/Lib/N and optional import prefix', () => {
    assert.deepEqual(parseImportSpec('theansweris42/RSIZones/1'), {
      user: 'theansweris42', name: 'RSIZones', version: '1',
    });
    assert.deepEqual(parseImportSpec('import theansweris42/RSIZones/1'), {
      user: 'theansweris42', name: 'RSIZones', version: '1',
    });
    assert.equal(parseImportSpec('RSIZones'), null);
  });
});

describe('readScript scope', () => {
  it('default all prefers the published library over a same-named saved study', async () => {
    const _deps = {
      lookupFacadeScript: lookupByFilter(RSIZONES),
      fetchScriptSource: async (id) => {
        assert.equal(id, 'PUB;75ceaefbe37b4aebb688a4859aebf0fb');
        return { ok: true, source: LIB_SRC, via: 'GET /get/id/version' };
      },
    };
    const read = await readScript({ name: 'RSIZones', _deps });
    assert.equal(read.scope, 'published');
    assert.equal(read.kind, 'library');
    assert.equal(read.script_id, 'PUB;75ceaefbe37b4aebb688a4859aebf0fb');
    assert.ok(read.exports.some((e) => e.name === 'step'));
  });

  it('scope=saved returns the saved study', async () => {
    const _deps = {
      lookupFacadeScript: lookupByFilter(RSIZONES),
      fetchScriptSource: async (id) => {
        assert.equal(id, 'USER;5b48c567');
        return { ok: true, source: STUDY_SRC, via: 'GET /get/id' };
      },
    };
    const read = await readScript({ name: 'RSIZones', scope: 'saved', _deps });
    assert.equal(read.scope, 'saved');
    assert.equal(read.kind, 'study');
    assert.equal(read.script_id, 'USER;5b48c567');
  });

  it('scope=published queries only the published list', async () => {
    const _deps = {
      lookupFacadeScript: lookupByFilter(RSIZONES),
      fetchScriptSource: async (id) => ({
        ok: true, source: LIB_SRC, via: 'GET /get/id/version',
      }),
    };
    const read = await readScript({ name: 'RSIZones', scope: 'published', _deps });
    assert.equal(read.scope, 'published');
    assert.equal(read.kind, 'library');
  });

  it('import spec sets published name + version', async () => {
    const _deps = {
      lookupFacadeScript: async ({ filter, name }) => {
        assert.equal(filter, 'published');
        assert.equal(name, 'RSIZones');
        return RSIZONES.published[0];
      },
      fetchScriptSource: async (id, version) => {
        assert.equal(id, 'PUB;75ceaefbe37b4aebb688a4859aebf0fb');
        assert.equal(String(version), '1');
        return { ok: true, source: LIB_SRC, via: 'GET /get/id/version' };
      },
    };
    const read = await readScript({ name: 'theansweris42/RSIZones/1', _deps });
    assert.equal(read.scope, 'published');
    assert.equal(String(read.version), '1');
  });

  it('default all prefers the published library when the saved twin is also a library', async () => {
    const rows = {
      saved: [{
        scriptIdPart: 'USER;5b48c567',
        scriptName: 'RSIZones',
        version: '9.0',
        extra: { kind: 'library' },
      }],
      published: [{
        scriptIdPart: 'PUB;75ceaefbe37b4aebb688a4859aebf0fb',
        scriptName: 'RSIZones',
        version: '2.0',
        extra: { kind: 'library' },
      }],
    };
    const _deps = {
      lookupFacadeScript: lookupByFilter(rows),
      fetchScriptSource: async (id) => {
        assert.equal(id, 'PUB;75ceaefbe37b4aebb688a4859aebf0fb');
        return { ok: true, source: LIB_SRC, via: 'GET /get/id/version' };
      },
    };
    const read = await readScript({ name: 'RSIZones', _deps });
    assert.equal(read.scope, 'published');
    assert.equal(read.kind, 'library');
    assert.equal(read.script_id, 'PUB;75ceaefbe37b4aebb688a4859aebf0fb');
  });

  it('two non-library hits on both lists are ambiguous', async () => {
    const rows = {
      saved: [{ scriptIdPart: 'USER;a', scriptName: 'Twin', extra: { kind: 'study' } }],
      published: [{ scriptIdPart: 'PUB;b', scriptName: 'Twin', extra: { kind: 'study' } }],
    };
    const _deps = {
      lookupFacadeScript: lookupByFilter(rows),
      fetchScriptSource: async () => ({ ok: true, source: STUDY_SRC, via: 'GET /get/id' }),
    };
    await assert.rejects(
      () => readScript({ name: 'Twin', _deps }),
      (err) => err.code === 'TV_SCRIPT_AMBIGUOUS',
    );
  });
});
