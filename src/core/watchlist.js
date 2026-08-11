/**
 * Core watchlist logic — headless via TradingView's symbols_list REST API.
 *
 * All four operations run as page-context fetch() calls against
 *   https://www.tradingview.com/api/v1/symbols_list/custom/
 * The browser attaches session cookies automatically (credentials:'include'),
 * the same proven pattern the alerts and watchlist-remove tools already used.
 * No watchlist panel is opened and no DOM rows are scraped: the list payload
 * carries each list's id, name, `active` flag, and full `symbols` array.
 *
 * Trade-off vs the old DOM path: the REST payload gives symbol membership but
 * not live per-row quotes (last/change/change%/volume). get() therefore
 * returns the authoritative symbol list; callers needing quotes should use
 * quote_get per symbol. Removing the DOM read also removes the issue #111
 * Unicode-minus / tick-notation parsing fragility.
 */
import { evaluateAsync as _evaluateAsync } from '../connection.js';

const API_BASE = 'https://www.tradingview.com/api/v1/symbols_list/custom/';

function _resolve(deps) {
  return { evaluateAsync: deps?.evaluateAsync || _evaluateAsync };
}

// Page-context fetch returning { status, ok, body } so the Node side can
// surface HTTP detail instead of a bare fetch exception.
function _fetchJs(url, { method = 'GET', body } = {}) {
  return `
    fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      ${body !== undefined ? `body: JSON.stringify(${JSON.stringify(body)}),` : ''}
    })
      .then(function(r) { return r.text().then(function(t) { return { status: r.status, ok: r.ok, body: t }; }); })
      .catch(function(e) { return { status: 0, ok: false, body: String(e) }; })
  `;
}

async function _fetch(evaluateAsync, url, opts) {
  const resp = await evaluateAsync(_fetchJs(url, opts));
  if (!resp) throw new Error('No response from symbols_list API');
  return resp;
}

// Fetch every custom list. Returns the parsed array (each entry has
// id/name/type/active/symbols). Throws with HTTP detail on failure.
async function listAll(evaluateAsync) {
  const resp = await _fetch(evaluateAsync, API_BASE);
  if (!resp.ok) {
    throw new Error(`symbols_list fetch failed (HTTP ${resp.status}): ${String(resp.body).substring(0, 200)}`);
  }
  let lists;
  try {
    lists = JSON.parse(resp.body);
  } catch {
    throw new Error('symbols_list returned non-JSON payload');
  }
  if (!Array.isArray(lists)) throw new Error('symbols_list returned unexpected shape (not an array)');
  return lists;
}

// The active list is the one flagged `active` in the payload. Fall back to an
// explicit list_id when the caller targets a non-active list.
async function resolveList(evaluateAsync, { list_id } = {}) {
  const lists = await listAll(evaluateAsync);
  let list = null;
  if (list_id !== undefined && list_id !== null) {
    list = lists.find((l) => String(l.id) === String(list_id));
    if (!list) throw new Error(`Watchlist id "${list_id}" not found.`);
  } else {
    list = lists.find((l) => l.active) || null;
    if (!list) throw new Error('No active watchlist found in symbols_list payload.');
  }
  return { list, lists };
}

// Match a requested symbol (bare or EXCHANGE:SYMBOL) against a list's symbols,
// returning the canonical stored form or null.
function matchSymbol(symbols, sym) {
  if (symbols.includes(sym)) return sym;
  const bare = String(sym).split(':').pop().toUpperCase();
  return symbols.find((s) => s.split(':').pop().toUpperCase() === bare) || null;
}

/**
 * Get the active watchlist's symbols. Headless — reads the symbols_list REST
 * payload, not DOM rows. Pass list_id to read a non-active list.
 */
export async function get({ list_id, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  const { list } = await resolveList(evaluateAsync, { list_id });
  const symbols = list.symbols || [];
  return {
    success: true,
    count: symbols.length,
    source: 'rest',
    list_id: list.id,
    list_name: list.name,
    symbols: symbols.map((s) => ({ symbol: s })),
  };
}

/**
 * Add a symbol to the active watchlist via POST {list}/append/. Bare tickers are
 * added as-is (TradingView resolves them server-side the same way the search
 * box does); pass EXCHANGE:SYMBOL for an unqualified symbol. Verifies the
 * symbol is present afterwards. Pass list_id to target a non-active list.
 */
export async function add({ symbol, list_id, _deps } = {}) {
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required.');
  const { evaluateAsync } = _resolve(_deps);
  const sym = String(symbol).trim();

  const { list } = await resolveList(evaluateAsync, { list_id });
  const before = list.symbols || [];

  // Already present? Report idempotently instead of posting a duplicate.
  const existing = matchSymbol(before, sym);
  if (existing) {
    return { success: true, symbol, added_as: existing, action: 'already_present', list_id: list.id, list_name: list.name };
  }

  const resp = await _fetch(evaluateAsync, `${API_BASE}${list.id}/append/`, { method: 'POST', body: [sym] });
  if (!resp.ok) {
    throw new Error(`Watchlist add failed (HTTP ${resp.status}): ${String(resp.body).substring(0, 200)}`);
  }

  // Re-read to confirm the symbol actually landed (and learn its canonical form).
  const { list: after } = await resolveList(evaluateAsync, { list_id: list.id });
  const added = matchSymbol(after.symbols || [], sym);

  return {
    success: !!added,
    symbol,
    added_as: added,
    action: added ? 'added' : 'not_verified',
    list_id: list.id,
    list_name: list.name,
  };
}

export async function addBulk({ symbols, list_id, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  const results = [];
  for (const symbol of symbols) {
    try {
      const r = await add({ symbol, list_id, _deps: { evaluateAsync } });
      results.push({ symbol, success: r.success, added_as: r.added_as, action: r.action });
    } catch (err) {
      results.push({ symbol, success: false, error: err.message });
    }
  }
  const added = results.filter((r) => r.success).length;
  return { success: added > 0, added, failed: results.length - added, results };
}

/**
 * Remove one or more symbols from the active watchlist via POST {list}/remove/.
 * Matches bare or EXCHANGE:SYMBOL requests against the list's stored symbols.
 * Pass list_id to target a non-active list.
 */
export async function remove({ symbols, list_id, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  const { list } = await resolveList(evaluateAsync, { list_id });
  const listSymbols = list.symbols || [];

  const toRemove = [];
  const skipped = [];
  for (const sym of symbols) {
    const match = matchSymbol(listSymbols, sym);
    if (match) toRemove.push(match);
    else skipped.push(sym);
  }
  if (!toRemove.length) {
    return { success: false, removed: [], skipped, error: 'No matching symbols in the watchlist', list_id: list.id, list_name: list.name };
  }

  const resp = await _fetch(evaluateAsync, `${API_BASE}${list.id}/remove/`, { method: 'POST', body: toRemove });
  if (!resp.ok) {
    throw new Error(`Watchlist remove failed (HTTP ${resp.status}): ${String(resp.body).substring(0, 200)}`);
  }

  // Re-read to verify the symbols are actually gone.
  const { list: after } = await resolveList(evaluateAsync, { list_id: list.id });
  const afterSymbols = after.symbols || [];
  const stillPresent = toRemove.filter((s) => afterSymbols.includes(s));

  return {
    success: true,
    removed: toRemove,
    skipped,
    verified: stillPresent.length === 0,
    list_id: list.id,
    list_name: list.name,
    api: 'rest',
  };
}
