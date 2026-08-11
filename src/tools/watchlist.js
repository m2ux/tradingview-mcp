import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/watchlist.js';

const LIST_ID = z.coerce.string().optional()
  .describe('Target a specific watchlist by id (default: the active watchlist). Ids come from watchlist_get.');

export function registerWatchlistTools(server) {
  server.tool('watchlist_get', 'Get all symbols from a TradingView watchlist (headless, via the symbols_list REST API — no panel opened). Returns the active watchlist unless list_id is given.', {
    list_id: LIST_ID,
  }, async ({ list_id }) => {
    try { return jsonResult(await core.get({ list_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('watchlist_add', 'Add a symbol to a TradingView watchlist (headless REST — no search-box UI). Bare tickers resolve server-side; pass EXCHANGE:SYMBOL for an unqualified symbol.', {
    symbol: z.string().describe('Symbol to add (e.g., AAPL, BTCUSD, ES1!, NYMEX:CL1!)'),
    list_id: LIST_ID,
  }, async ({ symbol, list_id }) => {
    try { return jsonResult(await core.add({ symbol, list_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('watchlist_add_bulk', 'Add multiple symbols to a TradingView watchlist (headless REST).', {
    symbols: z.array(z.string()).describe('Symbols to add (e.g., ["AAPL", "ES1!", "NYMEX:CL1!"])'),
    list_id: LIST_ID,
  }, async ({ symbols, list_id }) => {
    try { return jsonResult(await core.addBulk({ symbols, list_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('watchlist_remove', 'Remove one or more symbols from a TradingView watchlist (headless REST). Matches bare (AAPL) or full (NASDAQ:AAPL) forms against the list.', {
    symbols: z.array(z.string()).describe('Symbols to remove — bare (AAPL) or full (NASDAQ:AAPL)'),
    list_id: LIST_ID,
  }, async ({ symbols, list_id }) => {
    try { return jsonResult(await core.remove({ symbols, list_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
