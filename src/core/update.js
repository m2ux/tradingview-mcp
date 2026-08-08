/**
 * Core self-update logic: authenticated fetch + verified fast-forward of
 * origin/main, then npm ci when the lockfile changed.
 * Every guard returns before the merge.
 */
import { execSync as _execSync } from 'child_process';
import { existsSync as _existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// src/core/update.js -> repo root, independent of process.cwd()
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Origin URLs permitted as update sources (exact remote path of record or
 * its SSH form). Host allowlist blocks fetch-time redirection to an
 * attacker-controlled remote even when the local clone is intact.
 */
const ALLOWED_ORIGINS = [
  'https://github.com/m2ux/tradingview-mcp.git',
  'https://github.com/m2ux/tradingview-mcp',
  'git@github.com:m2ux/tradingview-mcp.git',
  'git@github.com:m2ux/tradingview-mcp',
];

function _resolve(deps) {
  return {
    execSync: deps?.execSync || _execSync,
    existsSync: deps?.existsSync || _existsSync,
    repoRoot: deps?.repoRoot || REPO_ROOT,
    env: deps?.env || process.env,
  };
}

/** True when the fetched ref is a GPG-signed tag or the operator-pinned SHA. */
function verifyTarget(git, env) {
  const pinned = env.TV_UPDATE_PINNED_SHA;
  if (pinned) {
    const target = git('rev-parse FETCH_HEAD');
    return target.startsWith(pinned)
      ? { ok: true, via: `pinned SHA ${pinned}` }
      : { ok: false, error: `FETCH_HEAD ${target.slice(0, 12)} does not match TV_UPDATE_PINNED_SHA ${pinned}` };
  }
  const tag = git('tag --points-at FETCH_HEAD').split('\n').filter(Boolean)[0];
  if (!tag) return { ok: false, error: 'FETCH_HEAD is not a tag; set TV_UPDATE_PINNED_SHA to allow a bare commit' };
  try {
    git(`tag -v ${JSON.stringify(tag)}`);
    return { ok: true, via: `signed tag ${tag}` };
  } catch (err) {
    return { ok: false, error: `tag ${tag} failed GPG verification (unsigned or untrusted key): ${err.message}` };
  }
}

export async function update({ _deps } = {}) {
  const { execSync, existsSync, repoRoot, env } = _resolve(_deps);
  const git = (args, timeout = 15000) =>
    execSync(`git ${args}`, { cwd: repoRoot, timeout, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

  if (!env.TV_UPDATE_TOKEN) {
    return {
      success: false,
      error: 'tv_update is disabled: TV_UPDATE_TOKEN is not set on the server process. Set it deliberately to arm self-update.',
    };
  }

  if (!existsSync(join(repoRoot, '.git'))) {
    return {
      success: false,
      error: `Not a git checkout (${repoRoot}). tv_update needs a git clone — re-install with: git clone https://github.com/tradesdontlie/tradingview-mcp`,
    };
  }

  let branch;
  try {
    branch = git('rev-parse --abbrev-ref HEAD');
  } catch (err) {
    return { success: false, error: `git unavailable or repo unreadable: ${err.message}` };
  }
  if (branch !== 'main') {
    return {
      success: false, branch,
      error: `On branch "${branch}", not "main" — update skipped so your work isn't disturbed. Run: git checkout main, then retry.`,
    };
  }

  const dirty = git('status --porcelain');
  if (dirty) {
    return {
      success: false,
      error: 'Working tree has local changes — commit or stash them, then retry.',
      changed_files: dirty.split('\n').slice(0, 10),
    };
  }

  const originUrl = git('remote get-url origin');
  if (!ALLOWED_ORIGINS.includes(originUrl)) {
    return {
      success: false,
      error: `origin "${originUrl}" is not on the update allowlist — refusing to fetch. Expected one of: ${ALLOWED_ORIGINS.join(', ')}`,
      origin_url: originUrl,
    };
  }

  const before = git('rev-parse HEAD');
  try {
    git('fetch --tags origin main', 30000);
  } catch (err) {
    return { success: false, error: `git fetch failed (offline? no origin?): ${err.message}` };
  }
  const remote = git('rev-parse origin/main');
  if (before === remote) {
    return { success: true, updated: false, status: 'up_to_date', commit: before.slice(0, 8) };
  }

  const provenance = verifyTarget(git, env);
  if (!provenance.ok) {
    return {
      success: false,
      error: `Update target failed provenance verification — ${provenance.error}`,
      target: remote.slice(0, 12),
    };
  }

  const ahead = Number(git('rev-list --count origin/main..HEAD'));
  if (ahead > 0) {
    return {
      success: false,
      error: `Local main has ${ahead} commit(s) not on origin — fast-forward is not possible. Inspect with: git log origin/main..HEAD`,
    };
  }

  const behind = Number(git('rev-list --count HEAD..origin/main'));
  const lockChanged = git('diff --name-only HEAD origin/main -- package-lock.json') !== '';

  git('merge --ff-only origin/main', 30000);
  const after = git('rev-parse HEAD');

  if (lockChanged) {
    try {
      execSync('npm ci --no-audit --no-fund', { cwd: repoRoot, timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return {
        success: false,
        updated: true,
        from_commit: before.slice(0, 8),
        to_commit: after.slice(0, 8),
        error: `npm ci failed after the merge — code and dependencies are out of sync. Recover in ${repoRoot}: fix the install, then restart. Cause: ${err.message}`,
      };
    }
  }

  return {
    success: true,
    updated: true,
    from_commit: before.slice(0, 8),
    to_commit: after.slice(0, 8),
    commits_pulled: behind,
    verified_via: provenance.via,
    deps_installed: lockChanged,
    restart_required: true,
    note: 'Update applied. Restart the MCP server (reconnect it in your client) to load the new code — the running process still has the old version.',
  };
}
