/**
 * Structured tool errors. A `code` + `hint` (+ optional `resolution` record) on
 * the thrown Error, surfaced through errorResult() so a controlling agent can
 * programmatically pick the corrective tool instead of blind-retrying.
 *
 * Codes are a stable enum (TV_ERROR_CODES) — document any new one here so
 * agents can switch on `code` reliably. Hints are actionable English naming the
 * exact tool + arguments that unblock the failure.
 */

export const TV_ERROR_CODES = Object.freeze({
  // Connection / Chart presence
  TV_NOT_CONNECTED: 'TradingView process is not reachable on the CDP endpoint.',
  TV_NO_CHART_TAB: 'TradingView is up but no chart tab is open.',
  TV_CDP_BUSY: 'TradingView CDP endpoint is temporarily busy (transient).',
  // Chart/tab targeting
  TV_TARGET_NOT_FOUND: 'target did not match any open chart tab.',
  TV_TAB_NOT_OPEN: 'Named layout is saved but not open in any tab.',
  TV_LAYOUT_NOT_FOUND: 'Saved layout name did not match any saved layout.',
  // Reads
  TV_STUDY_NOT_FOUND: 'Study/entity id is not on the chart (often a stale per-session id).',
  TV_NO_STRATEGY: 'No strategy study is present on the chart.',
  TV_DOM_NOT_OPEN: 'DOM / Depth-of-Market panel is not open.',
  // Pine
  TV_SCRIPT_NOT_FOUND: 'Named/id\'d Pine script is not in the saved scripts list.',
  TV_SCRIPT_AMBIGUOUS: 'Pine script name matched multiple scripts.',
  TV_PINE_EDITOR_CLOSED: 'The Pine Editor (Monaco) is not open.',
  TV_PINE_UNBOUND: 'pine_save ran without a verified buffer↔script binding.',
  // UI automation
  TV_ELEMENT_NOT_FOUND: 'UI element did not match any on-page control.',
  TV_PANEL_NOT_OPEN: 'A required panel is collapsed/closed.',
  // Watchlist
  TV_LIST_NOT_FOUND: 'Watchlist (or its active list) could not be resolved.',
});

export class ToolError extends Error {
  constructor(code, message, { hint, resolution } = {}) {
    super(message);
    this.name = 'ToolError';
    if (code) this.code = code;
    if (hint) this.hint = hint;
    if (resolution) this.resolution = resolution;
  }
}

/** tvError('TV_TARGET_NOT_FOUND', 'msg', { hint, resolution }) -> ToolError */
export function tvError(code, message, opts = {}) {
  return new ToolError(code, message, opts);
}
