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

  server.tool('pine_read_script', 'Read a Pine Script\'s full source by name, script_id, or user/Lib/N import spec WITHOUT opening it. Default scope=all queries saved and published; a name that hits both prefers the published library. scope=saved or scope=published queries one list. Also returns parsed export names. Prefer this over pine_open + pine_get_source for read-only access.', {
    name: z.string().optional().describe('Script name, or import spec user/Lib/N (exact match preferred; unambiguous substring allowed)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts (takes precedence over name)'),
    scope: z.enum(['saved', 'published', 'all']).optional().describe('all (default: saved+published, prefer published library), saved, or published import snapshot'),
    version: z.union([z.string(), z.number()]).optional().describe('Published/saved version to fetch (e.g. 2 or "2.0")'),
  }, async ({ name, script_id, scope, version } = {}) => {
    try { return jsonResult(await core.readScript({ name, script_id, scope, version })); }
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

  server.tool('pine_save', 'Save the current Pine Script to the cloud and verify it persisted AGAINST THE BUFFER\'S script (not just the header name). FAILS LOUDLY (success:false) unless the persisted cloud source matches the editor buffer (CRLF/LF normalized). A save that bumps the version while persisting a different source is an error, not success (issue #21). Detects the unbound-editor trap (bound_mismatch). Returns {success, name, script_id, version, modified, verified, persisted_matches_buffer, resolved_by, buffer_title, header_name, error?}.', {}, async () => {
    try { return jsonResult(await core.save()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_bind', 'Bind the editor to a saved script: switch the Open/Save/Publish identity (same as pine_open), fetch facade source, load it into the buffer, and confirm the match. REFUSES (success:false) when the header identity differs — never injects into the wrong script. Use to escape bound_mismatch / verified:false before editing.', {
    name: z.string().optional().describe('Saved script name to bind (exact match preferred)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts (takes precedence over name)'),
  }, async ({ name, script_id } = {}) => {
    try { return jsonResult(await core.bindScript({ name, script_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message, code: err.code, blocked_dialog: err.blocked_dialog }, true); }
  });

  server.tool('pine_get_console', 'Read Pine Script console/log output (compile messages, log.info(), errors)', {}, async () => {
    try { return jsonResult(await core.getConsole()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_smart_compile', 'Intelligent compile: detects button, compiles, checks errors, reports study changes. Surfaces import-resolve / unpublished-library failures in import_errors. When the path clicks the Pine Save toolbar button, returns clicked:"Pine Save" and persisted:true (that click is a cloud persist, not compile-only).', {
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

  server.tool('pine_open', 'Open a saved Pine Script by registered identity (Open script dialog). Accepts script_id to disambiguate near-duplicate names. Switches Save/Publish target, dismisses the Open picker on success, and returns blocked_dialog when the picker remains. Does not Monaco-inject into another script.', {
    name: z.string().optional().describe('Name of the saved script to open (exact match preferred)'),
    script_id: z.string().optional().describe('scriptIdPart from pine_list_scripts (disambiguates Eng vs Engine vs EngineLib)'),
  }, async ({ name, script_id } = {}) => {
    try { return jsonResult(await core.openScript({ name, script_id })); }
    catch (err) { return jsonResult({ success: false, source: 'open_dialog', error: err.message, code: err.code, blocked_dialog: err.blocked_dialog }, true); }
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

  server.tool('pine_publish', 'Publish the open (or named) Pine script via the Publish wizard. Already-published scripts take Update existing and FAIL if published_version does not change. Returns {mode: update|create, pubId, published_version, published_version_before}. Cloud side effect.', {
    name: z.string().optional().describe('Script name to open and publish (default: currently open identity)'),
    id: z.string().optional().describe('scriptIdPart to resolve and publish'),
    privacy: z.enum(['private', 'public']).optional().describe('Publish privacy (default private)'),
    description: z.string().optional().describe('Plain-language library/script description or update release notes'),
  }, async (args) => {
    try { return jsonResult(await core.publishScript(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message, code: err.code }, true); }
  });

  server.tool('pine_library_exports', 'List published (or saved) export names for a Pine library without compiling a consumer. scope=published + version N probes the import user/Lib/N snapshot (issue #12/#26). Returns {exports:[{name,kind}], export_count, version, script_id}.', {
    name: z.string().optional().describe('Library name (exact match preferred)'),
    script_id: z.string().optional().describe('scriptIdPart or PUB;id'),
    scope: z.enum(['saved', 'published']).optional().describe('published (default) or saved facade'),
    version: z.union([z.string(), z.number()]).optional().describe('Published version N for import user/Lib/N'),
  }, async ({ name, script_id, scope, version } = {}) => {
    try { return jsonResult(await core.listLibraryExports({ name, script_id, scope, version })); }
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
