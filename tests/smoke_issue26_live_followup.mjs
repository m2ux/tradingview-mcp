/**
 * Follow-up live checks: published exports + Update-wizard visibility.
 */
import { uiState } from '../src/core/health.js';
import { addToChart, listLibraryExports, openScript } from '../src/core/pine.js';
import { clickVisibleButton, dismissBlockingDialogs, getEditorIdentity } from '../src/core/pine_ui.js';
import { sleep } from '../src/wait.js';

const ENG_ID = 'USER;5b5dedfb24ae434b93faa73bc3e6ac19';
const PUB_ID = 'PUB;72abc288ee55459991046fecfbc23326';

function summarizeDialog(d) {
  if (!d) return null;
  return {
    kind: d.kind, step: d.step, mode: d.mode, title: d.title,
    buttons: d.buttons, text: String(d.text || '').slice(0, 220),
  };
}

const results = {};

for (const [label, args] of [
  ['by_user_id', { script_id: ENG_ID, scope: 'published', version: 4 }],
  ['by_pub_id', { script_id: PUB_ID, scope: 'published', version: 4 }],
  ['by_name', { name: 'RSIZoneDivEng', scope: 'published', version: 4 }],
]) {
  try {
    const exp = await listLibraryExports(args);
    results[`exports_${label}`] = {
      ok: !!(exp.success && (exp.exports || []).some((e) => e.name === 'step' || e.name === 'ZoneState')),
      name: exp.name,
      script_id: exp.script_id,
      version: exp.version,
      export_count: exp.export_count,
      exports: exp.exports,
    };
  } catch (err) {
    results[`exports_${label}`] = { ok: false, error: err.message };
  }
}

try {
  const opened = await openScript({ script_id: ENG_ID });
  const identity = await getEditorIdentity();
  results.reopen_eng = { ok: opened.success && identity?.name === 'RSIZoneDivEng', header: identity?.name };
  const added = await addToChart();
  results.add_to_chart = { ok: added.success !== false, action: added.action, error: added.error, dialog: summarizeDialog(added.dialog) };
  await clickVisibleButton(/publish script/i);
  await sleep(1000);
  const ui = await uiState();
  const dialogs = (ui.dialogs || []).map(summarizeDialog);
  const wizard = (ui.dialogs || []).find((d) => d.kind === 'pine_publish_wizard')
    || dialogs.find((d) => /update existing|update '.+' (library|script)|publish new version|final touches|release notes|publish new script/i.test(`${d?.text || ''} ${d?.title || ''} ${(d?.buttons || []).join(' ')}`));
  results.tv_ui_state_wizard = {
    ok: !!wizard,
    dialogs,
    blocking_dialog: summarizeDialog(ui.blocking_dialog),
    key_buttons: ui.key_buttons,
  };
} catch (err) {
  results.tv_ui_state_wizard = { ok: false, error: err.message };
}

try { await dismissBlockingDialogs(); } catch { /* ignore */ }
try { await clickVisibleButton(/^(close|cancel|close menu)$/i); } catch { /* ignore */ }

results.summary = {
  allOk: Object.entries(results).filter(([k]) => k.startsWith('exports_') || k === 'tv_ui_state_wizard').every(([, v]) => v.ok),
};
console.log(JSON.stringify(results, null, 2));
process.exit(results.summary.allOk ? 0 : 1);
