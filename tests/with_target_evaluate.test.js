/**
 * Integration test for withTargetEvaluate against an in-process CDP stub.
 * Runs connection.js in a subprocess (so CDP_HOST/CDP_PORT env point at the
 * stub, whose values are read at module import) and exercises the REAL
 * chrome-remote-interface code path — no TradingView Desktop required.
 *
 * Run: node --test tests/with_target_evaluate.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startCdpStub } from './cdp_stub.mjs';

function runInChild(code, stubPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: process.cwd(),
      env: { ...process.env, TV_CDP_HOST: '127.0.0.1', TV_CDP_PORT: String(stubPort) },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (exit) => resolve({ exit, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

describe('withTargetEvaluate() — real CDP path against a stub', () => {
  let stub;
  before(async () => {
    stub = await startCdpStub({
      evaluate: (expr) => ({ marker: expr.includes('__scoped_marker__') }),
    });
  });
  after(async () => { await stub.stop(); });

  it('attaches to a chart by chart_id and evaluates on that tab', async () => {
    const code = `
      import { withTargetEvaluate } from './src/connection.js';
      const out = await withTargetEvaluate('od9I4OCz', async (ev) => ev('__scoped_marker__'));
      console.log(JSON.stringify(out));
    `;
    const { exit, stdout, stderr } = await runInChild(code, stub.port);
    assert.equal(exit, 0, `child failed: ${stderr}`);
    assert.deepEqual(JSON.parse(stdout), { marker: true });
  });

  it('resolves a URL substring to a chart target', async () => {
    const code = `
      import { withTargetEvaluate } from './src/connection.js';
      const out = await withTargetEvaluate('abc12345', async (ev, target) => ({ id: target.id }));
      console.log(JSON.stringify(out));
    `;
    const { exit, stdout, stderr } = await runInChild(code, stub.port);
    assert.equal(exit, 0, `child failed: ${stderr}`);
    assert.deepEqual(JSON.parse(stdout), { id: 'T2' });
  });

  it('rejects with a clear error when no chart matches', async () => {
    const code = `
      import { withTargetEvaluate } from './src/connection.js';
      try {
        await withTargetEvaluate('no-such-tab', async () => ({}));
        console.log(JSON.stringify({ ok: false }));
      } catch (e) {
        console.log(JSON.stringify({ ok: true, msg: e.message }));
      }
    `;
    const { exit, stdout, stderr } = await runInChild(code, stub.port);
    assert.equal(exit, 0, `child failed: ${stderr}`);
    const out = JSON.parse(stdout);
    assert.equal(out.ok, true);
    assert.match(out.msg, /No open chart tab matches target "no-such-tab"/);
  });

  // Regression: the resolver must run the read INSIDE withTargetEvaluate's
  // callback (fresh scoped connection per call), not resolve to a bare
  // evaluate — withTargetEvaluate closes its socket in `finally`, so a bare
  // return would hand back a dead connection. This drives a targeted read
  // through core/chart.getState, which goes through _resolveTarget.
  it('targeted getState runs against the scoped tab (executor, not bare eval)', async () => {
    const code = `
      import { getState } from './src/core/chart.js';
      const st = await getState({ target: 'abc12345' });
      console.log(JSON.stringify({ symbol: st.symbol }));
    `;
    // The stub's evaluate returns a state payload regardless of expression.
    await stub.stop();
    stub = await startCdpStub({
      evaluate: () => ({ symbol: 'BATS:CRSP', resolution: 'D', chartType: 1, studies: [] }),
    });
    const { exit, stdout, stderr } = await runInChild(code, stub.port);
    assert.equal(exit, 0, `child failed: ${stderr}`);
    assert.deepEqual(JSON.parse(stdout), { symbol: 'BATS:CRSP' });
  });

  // When TradingView busy-closes every scoped socket, withTargetEvaluate must
  // exhaust its retries and surface a structured retryable error so the tool
  // layer can tell the agent to wait/retry — not a raw WebSocket message.
  it('surfaces a retryable TV_CDP_BUSY error when the socket always closes', async () => {
    await stub.stop();
    stub = await startCdpStub({ closeOnConnect: true });
    const code = `
      import { withTargetEvaluate } from './src/connection.js';
      try {
        await withTargetEvaluate('od9I4OCz', async (ev) => ev('x'));
        console.log(JSON.stringify({ ok: false }));
      } catch (e) {
        console.log(JSON.stringify({ ok: true, retryable: e.retryable === true, code: e.code, msg: e.message }));
      }
    `;
    const { exit, stdout, stderr } = await runInChild(code, stub.port);
    assert.equal(exit, 0, `child failed: ${stderr}`);
    const out = JSON.parse(stdout);
    assert.equal(out.ok, true);
    assert.equal(out.retryable, true);
    assert.equal(out.code, 'TV_CDP_BUSY');
    assert.match(out.msg, /busy/i);
  });
});
