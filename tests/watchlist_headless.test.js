/**
 * Unit tests for the headless watchlist core: get/add/addBulk/remove now run
 * as page-context fetch() calls against the symbols_list REST API instead of
 * scraping the watchlist panel DOM. A mocked evaluateAsync simulates the REST
 * service (an in-memory set of lists keyed by id) and records the request
 * expressions dispatched.
 *
 * Run: node --test tests/watchlist_headless.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, add, addBulk, remove } from '../src/core/watchlist.js';

const API = 'https://www.tradingview.com/api/v1/symbols_list/custom/';

// In-memory symbols_list service. `lists` is an array of
// { id, name, active, symbols:[...] }. Returns { evaluateAsync, calls, lists }.
function mockService({ lists } = {}) {
  const state = lists.map((l) => ({ symbols: [], ...l, symbols: [...(l.symbols || [])] }));
  const calls = [];

  const evaluateAsync = async (expr) => {
    calls.push(expr);

    // Extract URL + optional body from the generated fetch(...) expression.
    const urlMatch = expr.match(/fetch\("([^"]+)"/);
    const url = urlMatch && urlMatch[1];
    const bodyMatch = expr.match(/body: JSON\.stringify\((\[.*?\])\)/s);
    const body = bodyMatch ? JSON.parse(bodyMatch[1]) : undefined;
    const isWrite = /method: "POST"/.test(expr);

    const ok = (obj) => ({ status: 200, ok: true, body: JSON.stringify(obj) });

    if (url === API && !isWrite) {
      return ok(state);
    }
    const addMatch = url.match(/\/(\d+)\/append\/$/);
    const removeMatch = url.match(/\/(\d+)\/remove\/$/);
    if (addMatch && isWrite) {
      const list = state.find((l) => String(l.id) === addMatch[1]);
      if (!list) return { status: 404, ok: false, body: 'not found' };
      for (const s of body) if (!list.symbols.includes(s)) list.symbols.push(s);
      return ok({});
    }
    if (removeMatch && isWrite) {
      const list = state.find((l) => String(l.id) === removeMatch[1]);
      if (!list) return { status: 404, ok: false, body: 'not found' };
      list.symbols = list.symbols.filter((s) => !body.includes(s));
      return ok({});
    }
    return { status: 400, ok: false, body: 'unhandled mock url: ' + url };
  };

  return { _deps: { evaluateAsync }, calls, state };
}

describe('watchlist get() — headless REST', () => {
  it('returns the active list symbols without opening a panel', async () => {
    const { _deps, calls } = mockService({
      lists: [
        { id: 1, name: 'Other', active: false, symbols: ['NASDAQ:TSLA'] },
        { id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL', 'BINANCE:BTCUSD'] },
      ],
    });
    const r = await get({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.source, 'rest');
    assert.equal(r.list_id, 2);
    assert.equal(r.list_name, 'Main');
    assert.equal(r.count, 2);
    assert.deepEqual(r.symbols.map((s) => s.symbol), ['NASDAQ:AAPL', 'BINANCE:BTCUSD']);
    // No DOM selectors dispatched — only the REST GET.
    assert.ok(calls.every((c) => !/querySelector|data-symbol-full/.test(c)), 'no DOM scraping');
  });

  it('targets a specific list when list_id is given', async () => {
    const { _deps } = mockService({
      lists: [
        { id: 1, name: 'Other', active: false, symbols: ['NASDAQ:TSLA'] },
        { id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL'] },
      ],
    });
    const r = await get({ list_id: 1, _deps });
    assert.equal(r.list_id, 1);
    assert.deepEqual(r.symbols.map((s) => s.symbol), ['NASDAQ:TSLA']);
  });

  it('throws when there is no active list', async () => {
    const { _deps } = mockService({ lists: [{ id: 1, name: 'X', active: false, symbols: [] }] });
    await assert.rejects(() => get({ _deps }), /No active watchlist/);
  });
});

describe('watchlist add() — headless REST', () => {
  it('adds a symbol to the active list and verifies membership', async () => {
    const { _deps, state } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: [] }] });
    const r = await add({ symbol: 'NASDAQ:AAPL', _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'added');
    assert.equal(r.added_as, 'NASDAQ:AAPL');
    assert.ok(state[0].symbols.includes('NASDAQ:AAPL'));
  });

  it('posts to the {id}/append/ endpoint with the symbol array', async () => {
    const { _deps, calls } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: [] }] });
    await add({ symbol: 'BINANCE:BTCUSD', _deps });
    const post = calls.find((c) => /\/2\/append\//.test(c) && /method: "POST"/.test(c));
    assert.ok(post, 'a POST to {id}/append/ was dispatched');
    assert.ok(post.includes('BINANCE:BTCUSD'), 'symbol in request body');
  });

  it('is idempotent when the symbol is already present (bare match)', async () => {
    const { _deps, calls } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL'] }] });
    const r = await add({ symbol: 'AAPL', _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'already_present');
    assert.equal(r.added_as, 'NASDAQ:AAPL');
    assert.ok(!calls.some((c) => /\/append\//.test(c)), 'no append POST dispatched');
  });

  it('requires a symbol', async () => {
    await assert.rejects(() => add({ _deps: mockService({ lists: [] })._deps }), /symbol is required/);
  });
});

describe('watchlist addBulk() — headless REST', () => {
  it('adds each symbol and reports per-symbol results', async () => {
    const { _deps, state } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL'] }] });
    const r = await addBulk({ symbols: ['NASDAQ:AAPL', 'BINANCE:BTCUSD', 'NYSE:MSFT'], _deps });
    assert.equal(r.success, true);
    assert.equal(r.added, 3);
    assert.equal(r.failed, 0);
    assert.ok(state[0].symbols.includes('BINANCE:BTCUSD'));
    assert.ok(state[0].symbols.includes('NYSE:MSFT'));
    const aapl = r.results.find((x) => x.symbol === 'NASDAQ:AAPL');
    assert.equal(aapl.action, 'already_present');
  });
});

describe('watchlist remove() — headless REST', () => {
  it('removes matching symbols and verifies they are gone', async () => {
    const { _deps, state } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL', 'BINANCE:BTCUSD'] }] });
    const r = await remove({ symbols: ['AAPL'], _deps });
    assert.equal(r.success, true);
    assert.deepEqual(r.removed, ['NASDAQ:AAPL']);
    assert.equal(r.verified, true);
    assert.ok(!state[0].symbols.includes('NASDAQ:AAPL'));
    assert.ok(state[0].symbols.includes('BINANCE:BTCUSD'));
  });

  it('posts to the {id}/remove/ endpoint', async () => {
    const { _deps, calls } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL'] }] });
    await remove({ symbols: ['NASDAQ:AAPL'], _deps });
    const post = calls.find((c) => /\/2\/remove\//.test(c) && /method: "POST"/.test(c));
    assert.ok(post, 'a POST to {id}/remove/ was dispatched');
  });

  it('skips symbols not on the list', async () => {
    const { _deps } = mockService({ lists: [{ id: 2, name: 'Main', active: true, symbols: ['NASDAQ:AAPL'] }] });
    const r = await remove({ symbols: ['TSLA'], _deps });
    assert.equal(r.success, false);
    assert.deepEqual(r.skipped, ['TSLA']);
  });
});
