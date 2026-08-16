/**
 * Unit tests for issue #26 — Pine publish/bind friction.
 * All page/facade/DOM seams are injected via _deps.
 *
 * Run: node --test tests/issue26_pine_friction.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindScript,
  classifyUiDialog,
  extractExportedNames,
  listLibraryExports,
  normalizePineNewlines,
  openScript,
  pineSourcesEqual,
  publishScript,
  readScript,
} from '../src/core/pine.js';

const LIB_SRC = `//@version=6
library("RSIZoneDivEng")
export type ZoneState
export step() => 1
`;

describe('normalizePineNewlines / pineSourcesEqual', () => {
  it('treats CRLF and LF as equal', () => {
    const lf = 'a\nb\n';
    const crlf = 'a\r\nb\r\n';
    assert.equal(normalizePineNewlines(crlf), lf);
    assert.equal(pineSourcesEqual(lf, crlf), true);
    assert.equal(pineSourcesEqual(lf, 'a\nb\nc\n'), false);
  });
});

describe('extractExportedNames', () => {
  it('parses type / function exports', () => {
    const names = extractExportedNames(LIB_SRC);
    assert.deepEqual(names, [
      { name: 'ZoneState', kind: 'type' },
      { name: 'step', kind: 'fn' },
    ]);
  });
});

describe('classifyUiDialog', () => {
  it('classifies Update-library wizard and Open picker', () => {
    const update = classifyUiDialog({
      text: "Update 'RSIZoneDivEng' library Release notes Continue",
      buttons: ['Continue'],
    });
    assert.equal(update.kind, 'pine_publish_wizard');
    assert.equal(update.mode, 'update');
    assert.match(update.title, /RSIZoneDivEng/);

    const final = classifyUiDialog({
      text: 'Final touches Private Publish new version',
      buttons: ['Private', 'Publish new version'],
    });
    assert.equal(final.kind, 'pine_publish_wizard');
    assert.equal(final.step, 'privacy_final');

    const picker = classifyUiDialog({
      text: 'Open my script Search',
      buttons: ['Close menu'],
    });
    assert.equal(picker.kind, 'pine_open_dialog');
    assert.equal(picker.step, 'open_picker');
  });
});

describe('bindScript — refuse wrong identity (issue #26.3)', () => {
  it('does not inject when open leaves the wrong header', async () => {
    let setCalls = 0;
    const r = await bindScript({
      script_id: 'USER;generic',
      _deps: {
        lookupFacadeScript: async () => ({
          scriptIdPart: 'USER;generic', scriptName: 'RSIZoneDivGeneric', version: '1.0', extra: { kind: 'indicator' },
        }),
        fetchScriptSource: async () => ({ ok: true, source: LIB_SRC }),
        openScript: async () => ({ success: true, name: 'RSIZoneDivEng', opened: true }),
        getEditorIdentity: async () => ({ name: 'RSIZoneDivEng' }),
        setSource: async () => { setCalls += 1; return { lines_set: 4 }; },
        getEditorBufferInfo: async () => ({ source: LIB_SRC }),
      },
    });
    assert.equal(r.success, false);
    assert.equal(r.bound, false);
    assert.equal(r.code, 'TV_PINE_IDENTITY_MISMATCH');
    assert.match(r.error, /will not inject/i);
    assert.equal(setCalls, 0);
  });

  it('injects only after the header matches', async () => {
    const r = await bindScript({
      name: 'RSIZoneDivEng',
      _deps: {
        lookupFacadeScript: async () => ({
          scriptIdPart: 'USER;eng', scriptName: 'RSIZoneDivEng', version: '4.0', extra: { kind: 'library' },
        }),
        fetchScriptSource: async () => ({ ok: true, source: LIB_SRC }),
        openScript: async () => ({ success: true, name: 'RSIZoneDivEng', opened: true }),
        getEditorIdentity: async () => ({ name: 'RSIZoneDivEng' }),
        setSource: async ({ script_name }) => {
          assert.equal(script_name, 'RSIZoneDivEng');
          return { lines_set: 4 };
        },
        getEditorBufferInfo: async () => ({ source: LIB_SRC.replace(/\n/g, '\r\n') }),
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.bound, true);
    assert.equal(r.header_name, 'RSIZoneDivEng');
  });
});

describe('openScript — script_id + leftover picker (issue #26.4)', () => {
  it('resolves name from script_id and reports leftover Open dialog', async () => {
    await assert.rejects(
      () => openScript({
        script_id: 'USER;eng',
        _deps: {
          ensurePineEditorOpen: async () => true,
          lookupFacadeScript: async ({ id }) => {
            assert.equal(id, 'USER;eng');
            return { scriptIdPart: 'USER;eng', scriptName: 'RSIZoneDivEng', version: '4.0' };
          },
          openViaOpenDialog: async (wanted, deps) => {
            assert.equal(wanted, 'RSIZoneDivEng');
            assert.equal(deps.script_id, 'USER;eng');
            return { opened: true, name: 'RSIZoneDivEng', via: 'open_action', scriptIdPart: 'USER;eng' };
          },
          dismissBlockingDialogs: async () => ({ dismissed: false, via: 'failed' }),
          getVisibleDialogs: async () => [{
            kind: 'pine_open_dialog', step: 'open_picker', title: 'Open my script', text: 'Open my script', buttons: ['Close menu'],
          }],
        },
      }),
      (err) => {
        assert.equal(err.code, 'TV_PINE_BLOCKED_DIALOG');
        assert.equal(err.blocked_dialog.kind, 'pine_open_dialog');
        return /blocked_dialog/.test(err.message);
      },
    );
  });

  it('succeeds when the picker is dismissed', async () => {
    const r = await openScript({
      name: 'RSIZoneDivEng',
      script_id: 'USER;eng',
      _deps: {
        ensurePineEditorOpen: async () => true,
        lookupFacadeScript: async () => ({ scriptIdPart: 'USER;eng', scriptName: 'RSIZoneDivEng', version: '4.0' }),
        openViaOpenDialog: async () => ({ opened: true, name: 'RSIZoneDivEng', via: 'open_action', scriptIdPart: 'USER;eng' }),
        dismissBlockingDialogs: async () => ({ dismissed: true, via: 'close_control' }),
        getVisibleDialogs: async () => [],
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.script_id, 'USER;eng');
    assert.equal(r.blocked_dialog, null);
  });
});

describe('publishScript — Update-existing evidence (issue #26.1)', () => {
  function publishDeps({ publishedBefore, publishedAfter, clicks = [] }) {
    const clickLog = [];
    return {
      clickLog,
      _deps: {
        ensurePineEditorOpen: async () => true,
        getEditorIdentity: async () => ({ name: 'RSIZoneDivEng' }),
        assertEditorIdentity: async () => ({ name: 'RSIZoneDivEng' }),
        evaluate: async () => false,
        sleep: async () => {},
        addToChart: async () => ({ success: true }),
        fillDialogInput: async () => true,
        getVisibleDialogs: async () => [{
          text: "Update 'RSIZoneDivEng' library",
          buttons: ['Update existing script', 'Continue'],
        }],
        fetchFacadeList: async (filter) => {
          if (filter !== 'published') return { scripts: [] };
          const version = clickLog.includes('final') ? publishedAfter : publishedBefore;
          return {
            scripts: [{ scriptIdPart: 'PUB;72abc', scriptName: 'RSIZoneDivEng', version }],
          };
        },
        clickVisibleButton: async (pattern) => {
          const src = pattern instanceof RegExp ? pattern.source : String(pattern);
          if (/publish script/i.test(src)) { clickLog.push('publish'); return 'Publish script'; }
          if (/update existing/i.test(src)) {
            if (clicks.includes('no-update')) return null;
            clickLog.push('update');
            return 'Update existing script';
          }
          if (/continue|next/i.test(src)) { clickLog.push('continue'); return 'Continue'; }
          if (/^private$/i.test(src)) { clickLog.push('private'); return 'Private'; }
          if (/publish new version|publish private|publish/i.test(src)) { clickLog.push('final'); return 'Publish new version'; }
          return null;
        },
      },
    };
  }

  it('fails when already published but Update existing is not clicked', async () => {
    const { _deps } = publishDeps({ publishedBefore: '1.0', publishedAfter: '1.0', clicks: ['no-update'] });
    const r = await publishScript({ privacy: 'private', _deps });
    assert.equal(r.success, false);
    assert.equal(r.mode, 'update');
    assert.equal(r.code, 'TV_PINE_PUBLISH_STALE');
    assert.equal(r.published_version, '1.0');
  });

  it('fails when Update-existing runs but published_version is unchanged', async () => {
    const { _deps, clickLog } = publishDeps({ publishedBefore: '1.0', publishedAfter: '1.0' });
    const r = await publishScript({ privacy: 'private', _deps });
    assert.ok(clickLog.includes('update'));
    assert.equal(r.success, false);
    assert.equal(r.mode, 'update');
    assert.equal(r.code, 'TV_PINE_PUBLISH_STALE');
    assert.match(r.error, /did not change/);
  });

  it('succeeds on update when published_version bumps', async () => {
    const { _deps, clickLog } = publishDeps({ publishedBefore: '1.0', publishedAfter: '2.0' });
    const r = await publishScript({ privacy: 'private', description: 'add step()', _deps });
    assert.ok(clickLog.includes('update'));
    assert.ok(clickLog.includes('final'));
    assert.equal(r.success, true);
    assert.equal(r.mode, 'update');
    assert.equal(r.published_version, '2.0');
    assert.equal(r.published_version_before, '1.0');
    assert.equal(r.pubId, 'PUB;72abc');
  });
});

describe('readScript / listLibraryExports published scope (issue #26.6)', () => {
  it('reads published version N and lists exports', async () => {
    const _deps = {
      lookupFacadeScript: async ({ filter, id }) => {
        assert.equal(filter, 'published');
        assert.equal(id, 'PUB;72abc');
        return { scriptIdPart: 'PUB;72abc', scriptName: 'RSIZoneDivEng', version: '2.0', extra: { kind: 'library' } };
      },
      fetchScriptSource: async (id, version) => {
        assert.equal(id, 'PUB;72abc');
        assert.equal(String(version), '2');
        return { ok: true, source: LIB_SRC, via: 'GET /get/id/version' };
      },
    };
    const read = await readScript({ script_id: 'PUB;72abc', scope: 'published', version: 2, _deps });
    assert.equal(read.scope, 'published');
    assert.equal(read.version, 2);
    assert.equal(read.exports.length, 2);

    const exp = await listLibraryExports({ script_id: 'PUB;72abc', scope: 'published', version: 2, _deps });
    assert.equal(exp.export_count, 2);
    assert.ok(exp.exports.some((e) => e.name === 'step'));
  });
});
