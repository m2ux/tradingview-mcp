/**
 * Tests for update() in src/core/update.js.
 * Covers the token gate, origin allowlist, provenance verification
 * (signed tag / pinned SHA), merge guards, and fail-closed npm ci.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { update } from '../src/core/update.js';

const OLD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ALLOWED_URL = 'git@github.com:m2ux/tradingview-mcp.git';
const TOKEN_ENV = { TV_UPDATE_TOKEN: 'test-token' };

/** Build DI deps simulating a git repo. */
function gitDeps({
  branch = 'main', dirty = '', remoteSha = OLD, ahead = 0, behind = 0,
  lockChanged = false, npmFails = false, env = TOKEN_ENV,
  originUrl = ALLOWED_URL, tag = 'v2.0.1', tagSigned = true, pinnedSha = null,
} = {}) {
  const state = { merged: false, npmCi: 0, cmds: [] };
  const effectiveEnv = pinnedSha ? { ...env, TV_UPDATE_PINNED_SHA: pinnedSha } : env;
  const deps = {
    existsSync: () => true,
    repoRoot: 'C:/fake/repo',
    env: effectiveEnv,
    execSync: (cmd) => {
      state.cmds.push(cmd);
      if (cmd.includes('rev-parse --abbrev-ref')) return branch;
      if (cmd.includes('status --porcelain')) return dirty;
      if (cmd.includes('rev-parse HEAD')) return state.merged ? remoteSha : OLD;
      if (cmd.includes('fetch --tags origin')) return '';
      if (cmd.includes('rev-parse origin/main')) return remoteSha;
      if (cmd.includes('remote get-url origin')) return originUrl;
      if (cmd.includes('rev-parse FETCH_HEAD')) return remoteSha;
      if (cmd.includes('tag --points-at FETCH_HEAD')) return tag || '';
      if (cmd.startsWith('git tag -v') || cmd.includes('tag -v')) {
        if (!tagSigned) throw new Error('no valid signature');
        return '';
      }
      if (cmd.includes('rev-list --count origin/main..HEAD')) return String(ahead);
      if (cmd.includes('rev-list --count HEAD..origin/main')) return String(behind);
      if (cmd.includes('diff --name-only')) return lockChanged ? 'package-lock.json' : '';
      if (cmd.includes('merge --ff-only')) { state.merged = true; return ''; }
      if (cmd.startsWith('npm ci')) {
        state.npmCi++;
        if (npmFails) throw new Error('EACCES');
        return '';
      }
      throw new Error(`unexpected cmd: ${cmd}`);
    },
  };
  return { deps, state };
}

describe('update() — token gate', () => {
  it('refuses when TV_UPDATE_TOKEN is unset', async () => {
    const { deps, state } = gitDeps({ env: {} });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /TV_UPDATE_TOKEN/);
    assert.equal(state.cmds.length, 0, 'no git ran before the gate');
  });
});

describe('update() — origin allowlist', () => {
  it('refuses an origin URL outside the allowlist before fetching', async () => {
    const { deps, state } = gitDeps({ remoteSha: NEW, originUrl: 'https://evil.example.com/repo.git' });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /not on the update allowlist/);
    assert.ok(!state.cmds.some(c => c.includes('fetch')), 'no fetch attempted');
  });
});

describe('update() — provenance verification', () => {
  it('fast-forwards to a signed tag and reports verified_via', async () => {
    const { deps } = gitDeps({ remoteSha: NEW, behind: 2 });
    const r = await update({ _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.verified_via, 'signed tag v2.0.1');
  });

  it('refuses when the target tag is unsigned', async () => {
    const { deps, state } = gitDeps({ remoteSha: NEW, behind: 2, tagSigned: false });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /provenance verification/);
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });

  it('refuses when FETCH_HEAD carries no tag and no pin is set', async () => {
    const { deps } = gitDeps({ remoteSha: NEW, behind: 2, tag: '' });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /not a tag/);
  });

  it('accepts a pinned SHA match without a tag', async () => {
    const { deps } = gitDeps({ remoteSha: NEW, behind: 1, tag: '', pinnedSha: NEW });
    const r = await update({ _deps: deps });
    assert.equal(r.success, true);
    assert.match(r.verified_via, /pinned SHA/);
  });

  it('refuses a pinned SHA mismatch', async () => {
    const { deps, state } = gitDeps({ remoteSha: NEW, behind: 1, tag: '', pinnedSha: 'cccccccc' });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /does not match TV_UPDATE_PINNED_SHA/);
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });
});

describe('update() — guards', () => {
  it('refuses non-git installs with a clone hint', async () => {
    const { deps } = gitDeps();
    deps.existsSync = () => false;
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /git clone/);
  });

  it('refuses on a non-main branch', async () => {
    const { deps, state } = gitDeps({ branch: 'fix/my-feature' });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.equal(r.branch, 'fix/my-feature');
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });

  it('refuses on a dirty working tree and lists changed files', async () => {
    const { deps, state } = gitDeps({ dirty: 'M src/core/data.js\n?? notes.txt' });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.deepEqual(r.changed_files, ['M src/core/data.js', '?? notes.txt']);
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });

  it('refuses when local main has commits not on origin', async () => {
    const { deps, state } = gitDeps({ remoteSha: NEW, ahead: 2, behind: 5 });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /fast-forward is not possible/);
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });

  it('reports fetch failures without merging', async () => {
    const { deps, state } = gitDeps();
    const orig = deps.execSync;
    deps.execSync = (cmd) => { if (cmd.includes('fetch')) throw new Error('could not resolve host'); return orig(cmd); };
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /fetch failed/);
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });
});

describe('update() — update paths', () => {
  it('reports up_to_date without merging when HEAD matches origin', async () => {
    const { deps, state } = gitDeps({ remoteSha: OLD });
    const r = await update({ _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.updated, false);
    assert.equal(r.status, 'up_to_date');
    assert.ok(!state.cmds.some(c => c.includes('merge')), 'no merge attempted');
  });

  it('fast-forwards and skips npm ci when the lockfile is unchanged', async () => {
    const { deps, state } = gitDeps({ remoteSha: NEW, behind: 3 });
    const r = await update({ _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.updated, true);
    assert.equal(r.commits_pulled, 3);
    assert.equal(r.from_commit, OLD.slice(0, 8));
    assert.equal(r.to_commit, NEW.slice(0, 8));
    assert.equal(r.deps_installed, false);
    assert.equal(state.npmCi, 0);
    assert.equal(r.restart_required, true);
  });

  it('runs npm ci when the lockfile changed', async () => {
    const { deps, state } = gitDeps({ remoteSha: NEW, behind: 1, lockChanged: true });
    const r = await update({ _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.deps_installed, true);
    assert.equal(state.npmCi, 1);
  });

  it('fails closed when npm ci fails — no code/deps skew', async () => {
    const { deps } = gitDeps({ remoteSha: NEW, behind: 1, lockChanged: true, npmFails: true });
    const r = await update({ _deps: deps });
    assert.equal(r.success, false);
    assert.equal(r.updated, true);
    assert.match(r.error, /npm ci failed/);
    assert.equal(r.warning, undefined, 'hard error replaces the old warning path');
  });
});
