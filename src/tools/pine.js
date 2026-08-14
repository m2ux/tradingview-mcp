import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/pine.js';

const copySchema = {
  from_name: z.string().optional().describe('Source script name (Open-dialog / saved name)'),
  from_id: z.string().optional().describe('Source scriptIdPart from pine_list_scripts'),
  new_name: z.string().describe('Name for the new registered copy'),
  replace: z.coerce.boolean().optional().describe('If true, replace an existing script with the same new_name'),
};

export function registerPineTools(server) {
  server.tool('pine_get_source', 'Get Pine Script source code. With no args, reads the script currently open in the editor. Pass name or script_id to read a saved script by identity WITHOUT opening it (delegates to pine_read_script).', {
    name: z.string().optional().describe('Saved script name to read without opening (exact match preferred)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts to read without opening'),
  }, async ({ name, script_id } = {}) => {
    try {
      if (name || script_id) return jsonResult(await core.readScript({ name, script_id }));
      return jsonResult(await core.getSource());
    }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_read_script', 'Read a saved Pine Script\'s full source by name or script_id WITHOUT opening it in the editor, switching the Save/Publish target, or raising any dialog. Returns {name, script_id, version, kind, source, line_count, char_count}. Works for indicators, strategies, and libraries (including published libraries referenced via import user/Lib/N). Prefer this over pine_open + pine_get_source for read-only access to another script.', {
    name: z.string().optional().describe('Saved script name (exact match preferred; unambiguous substring allowed)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts (takes precedence over name)'),
  }, async ({ name, script_id } = {}) => {
    try { return jsonResult(await core.readScript({ name, script_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_script_history', 'Read a saved Pine Script\'s version history (read-only) by walking the facade per-version endpoint. Returns per-version {version, ok, line_count, char_count, is_stub, declared_title} plus latest_intact_version — the newest version whose source is NOT a placeholder stub. Use to recover the pre-corruption source of a script whose current version was overwritten (e.g. by an E2E stub). Pass include_sources:true to also return each version\'s full source (large).', {
    name: z.string().optional().describe('Saved script name (exact match preferred; unambiguous substring allowed)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts (takes precedence over name)'),
    max_versions: z.coerce.number().optional().describe('How many versions back to walk from current (default 10)'),
    include_sources: z.coerce.boolean().optional().describe('Include each version\'s full source in the response (default false — bodies are summarised)'),
  }, async ({ name, script_id, max_versions, include_sources } = {}) => {
    try { return jsonResult(await core.readScriptHistory({ name, script_id, max_versions, include_sources })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_set_source', 'Set Pine Script source code in the editor. Pass script_name to refuse when the editor header identity does not match (prevents overwriting the wrong script).', {
    source: z.string().describe('Pine Script source code to inject'),
    script_name: z.string().optional().describe('Expected editor header name; refuse setValue if identity differs'),
  }, async ({ source, script_name }) => {
    try { return jsonResult(await core.setSource({ source, script_name })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_compile', 'Compile / add the current Pine Script to the chart', {}, async () => {
    try { return jsonResult(await core.compile()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_get_errors', 'Get Pine Script compilation errors from Monaco markers', {}, async () => {
    try { return jsonResult(await core.getErrors()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_save', 'Save the current Pine Script to the cloud and verify it persisted AGAINST THE BUFFER\'S script (not just the header name). FAILS LOUDLY (success:false) unless the persisted cloud source exactly matches the editor buffer — a save that bumps the version while persisting a different source is reported as an error, not success (issue #21). Detects the unbound-editor trap (bound_mismatch). verified=true means the cloud source now matches the editor buffer. Returns {success, name, script_id, version, modified, verified, persisted_matches_buffer, resolved_by, buffer_title, header_name, error?}.', {}, async () => {
    try { return jsonResult(await core.save()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_bind', 'Bind the editor to a saved script: fetch its registered source from the facade, load it into the buffer, and confirm the buffer matches. Establishes the buffer↔identity binding that pine_save verifies against — use this to escape the unbound-editor trap (verified:false / bound_mismatch) before editing and saving. No Open-dialog dependency for the source itself.', {
    name: z.string().optional().describe('Saved script name to bind (exact match preferred)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts (takes precedence over name)'),
  }, async ({ name, script_id } = {}) => {
    try { return jsonResult(await core.bindScript({ name, script_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_get_console', 'Read Pine Script console/log output (compile messages, log.info(), errors)', {}, async () => {
    try { return jsonResult(await core.getConsole()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_smart_compile', 'Intelligent compile: detects button, compiles, checks errors, reports study changes. Surfaces import-resolve / unpublished-library failures in import_errors.', {
    require_published_imports: z.coerce.boolean().optional().describe('If true, success=false when import-resolve errors are present'),
  }, async ({ require_published_imports } = {}) => {
    try { return jsonResult(await core.smartCompile({ require_published_imports })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_new', 'Create a new blank Pine Script template in the editor (does not register a cloud identity — use pine_copy or Save as for a publishable script)', {
    type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
  }, async ({ type }) => {
    try { return jsonResult(await core.newScript({ type })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_open', 'Open a saved Pine Script by registered identity (Open script dialog). Switches Save/Publish target to that script and refuses if the editor header does not match. Does not Monaco-inject into another script.', {
    name: z.string().describe('Name of the saved script to open (exact match preferred)'),
  }, async ({ name }) => {
    try { return jsonResult(await core.openScript({ name })); }
    catch (err) { return jsonResult({ success: false, source: 'open_dialog', error: err.message }, true); }
  });

  server.tool('pine_copy', 'Make a registered copy of a Pine script via the UI Make a copy… flow (appears in Open script / My scripts). Never uses orphan pine-facade save/new alone.', copySchema, async (args) => {
    try { return jsonResult(await core.copyScript(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_save_as', 'Alias for pine_copy: create a registered Save-as / Make-a-copy of an existing script under new_name.', copySchema, async (args) => {
    try { return jsonResult(await core.saveAsScript(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_add_to_chart', 'Add or update the currently open Pine script on the active chart (toolbar Add to chart / Update on chart). Returns a typed result: action is "added" | "updated" | "blocked_dialog". blocked_dialog means a modal (e.g. "Save this script before adding?") intercepted the apply — success=false and the chart kept the old code; run pine_save then retry. Prefer this over indicator_add for freshly saved My scripts.', {}, async () => {
    try { return jsonResult(await core.addToChart()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_publish', 'Publish the open (or named) Pine script via the Publish wizard. Handles Add-to-chart gate. Returns pubId + version for import user/Lib/N. Cloud side effect.', {
    name: z.string().optional().describe('Script name to open and publish (default: currently open identity)'),
    id: z.string().optional().describe('scriptIdPart to resolve and publish'),
    privacy: z.enum(['private', 'public']).optional().describe('Publish privacy (default private)'),
    description: z.string().optional().describe('Plain-language library/script description for the publish form'),
  }, async (args) => {
    try { return jsonResult(await core.publishScript(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_list_scripts', 'List saved Pine Scripts with kind, published_version, and ui_visible / in_open_dialog (orphan detection when missing from Open dialog).', {
    check_ui_visible: z.coerce.boolean().optional().describe('Scrape Open dialog for ui_visible flags (default true)'),
  }, async ({ check_ui_visible } = {}) => {
    try { return jsonResult(await core.listScripts({ check_ui_visible: check_ui_visible !== false })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_analyze', 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.', {
    source: z.string().describe('Pine Script source code to analyze'),
  }, async ({ source }) => {
    try { return jsonResult(core.analyze({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_check', 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.', {
    source: z.string().describe('Pine Script source code to compile/validate'),
  }, async ({ source }) => {
    try { return jsonResult(await core.check({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
