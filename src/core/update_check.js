/**
 * Core update-check logic — best-effort git-pull update check.
 *
 * Extracted from health.js (R5 health cohesion split). Re-exported via
 * health.js for import-path compatibility.
 */

import { execSync } from 'child_process';

let _updateCache = null;

// Compare local HEAD to origin's default branch on GitHub. Never throws —
// returns null on any failure (offline, detached HEAD, not a git checkout)
// so it can't break the health check.
export async function checkForUpdate() {
  if (_updateCache && (Date.now() - _updateCache.at) < 3600_000) return _updateCache.value;
  let value = null;
  try {
    const localSha = execSync('git rev-parse HEAD', { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const remoteUrl = execSync('git config --get remote.origin.url', { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (localSha && m) {
      const repo = m[1];
      const http = await import('https');
      const remoteSha = await new Promise((resolve) => {
        const req = http.get({
          host: 'api.github.com', path: `/repos/${repo}/commits/HEAD`,
          headers: { 'User-Agent': 'tradingview-mcp', Accept: 'application/vnd.github.sha' },
        }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve(res.statusCode === 200 ? d.trim() : null)); });
        req.on('error', () => resolve(null));
        req.setTimeout(3000, () => { req.destroy(); resolve(null); });
      });
      if (remoteSha) {
        value = {
          update_available: remoteSha !== localSha,
          local_commit: localSha.slice(0, 8),
          latest_commit: remoteSha.slice(0, 8),
          ...(remoteSha !== localSha && { hint: 'Run the tv_update tool (or `tv update` CLI) to update, then restart the MCP server.' }),
        };
      }
    }
  } catch { /* best-effort */ }
  _updateCache = { at: Date.now(), value };
  return value;
}
