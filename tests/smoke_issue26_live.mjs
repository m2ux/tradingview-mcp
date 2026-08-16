/**
 * Live CDP smoke for issue #26. Run from the worktree so we exercise the
 * new code (Cursor MCP is still the old 88-tool server).
 *
 *   node tests/smoke_issue26_live.mjs
 */
import { uiState } from '../src/core/health.js';
import {
  bindScript,
  listLibraryExports,
  openScript,
  publishScript,
} from '../src/core/pine.js';
import {
  clickVisibleButton,
  dismissBlockingDialogs,
  getEditorIdentity,
  getVisibleDialogs,
} from '../src/core/pine_ui.js';
import { sleep } from '../src/wait.js';

const ENG_ID = 'USER;5b5dedfb24ae434b93faa73bc3e6ac19';
const GENERIC_ID = 'USER;55dab092b81d4ea8a41c4527b6bc7432';

function summarizeDialog(d) {
  if (!d) return null;
  return {
    kind: d.kind, step: d.step, mode: d.mode, title: d.title,
    buttons: d.buttons, text: String(d.text || '').slice(0, 180),
  };
}

const results = {};

// 6. published-export probe (read-only)
try {
  const exp = await listLibraryExports({
    script_id: ENG_ID,
    scope: 'published',
    version: 4,
  });
  results.library_exports = {
    ok: !!(exp.success && exp.exports?.some((e) => e.name === 'step' || e.name === 'ZoneState')),
    name: exp.name,
    version: exp.version,
    scope: exp.scope,
    export_count: exp.export_count,
    exports: (exp.exports || []).slice(0, 12),
    error: exp.error,
  };
} catch (err) {
  results.library_exports = { ok: false, error: err.message };
}

// 4. pine_open by script_id
try {
  const opened = await openScript({ script_id: ENG_ID });
  const identity = await getEditorIdentity().catch(() => null);
  results.pine_open = {
    ok: !!(opened.success && opened.script_id && identity?.name === 'RSIZoneDivEng' && !opened.blocked_dialog),
    success: opened.success,
    name: opened.name,
    script_id: opened.script_id,
    header: identity?.name,
    blocked_dialog: summarizeDialog(opened.blocked_dialog),
    error: opened.error,
  };
} catch (err) {
  results.pine_open = {
    ok: false,
    error: err.message,
    code: err.code,
    blocked_dialog: summarizeDialog(err.blocked_dialog),
  };
}

// 3. pine_bind Generic while Eng is open — must refuse, no inject
try {
  const bound = await bindScript({ script_id: GENERIC_ID });
  const identity = await getEditorIdentity().catch(() => null);
  results.pine_bind_refuse = {
    ok: bound.success === false && bound.bound === false && identity?.name === 'RSIZoneDivEng',
    success: bound.success,
    bound: bound.bound,
    code: bound.code,
    header_name: bound.header_name || identity?.name,
    error: bound.error,
  };
} catch (err) {
  const identity = await getEditorIdentity().catch(() => null);
  results.pine_bind_refuse = {
    ok: identity?.name === 'RSIZoneDivEng',
    error: err.message,
    header: identity?.name,
  };
}

// 2. leftover Update wizard visible in tv_ui_state
try {
  await clickVisibleButton(/publish script/i);
  await sleep(900);
  const ui = await uiState();
  const dialogs = (ui.dialogs || []).map(summarizeDialog);
  const wizard = (ui.dialogs || []).find((d) => d.kind === 'pine_publish_wizard')
    || (ui.blocking_dialog?.kind === 'pine_publish_wizard' ? ui.blocking_dialog : null);
  results.tv_ui_state_wizard = {
    ok: !!(wizard || dialogs.some((d) => /update|publish new version|final touches|release notes|publish new script/i.test(`${d?.text || ''} ${d?.title || ''}`))),
    dialogs,
    blocking_dialog: summarizeDialog(ui.blocking_dialog),
    key_buttons: ui.key_buttons,
  };
} catch (err) {
  results.tv_ui_state_wizard = { ok: false, error: err.message };
}

// 1. pine_publish on already-published Eng — Update-existing, fail if version unchanged
try {
  const pub = await publishScript({
    id: ENG_ID,
    privacy: 'private',
    description: 'issue26 live smoke — expect stale if no source delta',
  });
  const staleOk = pub.success === false && pub.mode === 'update' && pub.code === 'TV_PINE_PUBLISH_STALE';
  const bumpOk = pub.success === true && pub.mode === 'update' && String(pub.published_version) !== String(pub.published_version_before);
  results.pine_publish = {
    ok: staleOk || bumpOk,
    success: pub.success,
    mode: pub.mode,
    published_version: pub.published_version,
    published_version_before: pub.published_version_before,
    pubId: pub.pubId,
    code: pub.code,
    error: pub.error,
  };
} catch (err) {
  results.pine_publish = { ok: false, error: err.message, code: err.code };
}

// cleanup leftover dialogs
try { await dismissBlockingDialogs(); } catch { /* ignore */ }
try {
  const leftover = await getVisibleDialogs();
  results.cleanup_dialogs = leftover.map(summarizeDialog);
} catch {
  results.cleanup_dialogs = [];
}

const allOk = ['library_exports', 'pine_open', 'pine_bind_refuse', 'tv_ui_state_wizard', 'pine_publish']
  .every((k) => results[k]?.ok);
results.summary = { allOk, passed: Object.entries(results).filter(([k, v]) => k !== 'summary' && k !== 'cleanup_dialogs' && v?.ok).map(([k]) => k) };
console.log(JSON.stringify(results, null, 2));
process.exit(allOk ? 0 : 1);
