/**
 * Core launch logic — launch TradingView Desktop with CDP enabled.
 *
 * Extracted from health.js (R5 health cohesion split). Re-exported via
 * health.js for import-path compatibility.
 */
import { CDP_HOST, CDP_PORT } from '../connection.js';
import { existsSync, cpSync, rmSync, readdirSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { dirname, basename, join } from 'path';

const WINDOWS_APPS_RE = /\\WindowsApps\\/i;

function _resolveLaunchDeps(deps) {
  return {
    spawn: deps?.spawn || spawn,
    execSync: deps?.execSync || execSync,
    existsSync: deps?.existsSync || existsSync,
    cpSync: deps?.cpSync || cpSync,
    rmSync: deps?.rmSync || rmSync,
    readdirSync: deps?.readdirSync || readdirSync,
    delay: deps?.delay || ((ms) => new Promise((r) => setTimeout(r, ms))),
    probeCdp: deps?.probeCdp || _probeCdp,
    platform: deps?.platform || process.platform,
  };
}

async function _probeCdp(cdpPort) {
  const http = await import('http');
  return new Promise((resolve) => {
    const req = http.get(`http://${CDP_HOST}:${cdpPort}/json/version`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
  });
}

function _spawnDetached(spawnFn, exe, args) {
  // Cursor / VS Code / Claude Desktop set ELECTRON_RUN_AS_NODE=1 on helper
  // processes. If that leaks into this spawn, TradingView boots as Node and
  // rejects --remote-debugging-port ("bad option") so CDP never binds.
  const { ELECTRON_RUN_AS_NODE: _stripped, ...env } = process.env;
  const child = spawnFn(exe, args, { detached: true, stdio: 'ignore', env });
  child.unref();
  return child;
}

// Resolves once with an error string if the process fails/exits within graceMs,
// or with null if it survives that long.
function _spawnFailedEarly(child, graceMs = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(null); }, graceMs);
    const onError = (e) => { cleanup(); resolve(e.code || e.message || 'spawn error'); };
    const onExit = (code) => { cleanup(); resolve(`exited immediately (code ${code})`); };
    const cleanup = () => { clearTimeout(timer); child.off?.('error', onError); child.off?.('exit', onExit); };
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

async function _waitForCdp({ cdpPort, attempts, delay, probeCdp }) {
  for (let i = 0; i < attempts; i++) {
    await delay(1000);
    try {
      const ready = await probeCdp(cdpPort);
      if (ready) return JSON.parse(ready);
    } catch { /* retry */ }
  }
  return null;
}

/**
 * Some Windows builds block CDP for MSIX-packaged apps: direct spawn from
 * WindowsApps gets EACCES, and even COM activation passes the flag but the
 * debug port never binds (issues #42, #75, #128). Running the same files from
 * a plain directory outside WindowsApps works and keeps the user's session,
 * so copy the package into LOCALAPPDATA once per version and launch that.
 */
function _copyMsixPackageLocal(tvPath, { cpSync, rmSync, readdirSync, existsSync }) {
  const srcDir = dirname(tvPath);
  const pkgName = basename(srcDir);
  const cacheRoot = join(process.env.LOCALAPPDATA || '', 'tradingview-mcp');
  const dstDir = join(cacheRoot, pkgName);
  const dstExe = join(dstDir, 'TradingView.exe');
  if (!existsSync(dstExe)) {
    try {
      for (const entry of readdirSync(cacheRoot)) {
        if (entry !== pkgName && /^TradingView\./i.test(entry)) {
          rmSync(join(cacheRoot, entry), { recursive: true, force: true });
        }
      }
    } catch { /* cache root may not exist yet */ }
    cpSync(srcDir, dstDir, { recursive: true });
  }
  return dstExe;
}

export async function launch({ port, kill_existing, _deps } = {}) {
  const deps = _resolveLaunchDeps(_deps);
  const cdpPort = port || CDP_PORT;
  const killFirst = kill_existing === true;
  const platform = deps.platform;

  const pathMap = {
    darwin: [
      '/Applications/TradingView.app/Contents/MacOS/TradingView',
      `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
    ],
    win32: [
      `${process.env.LOCALAPPDATA}\\TradingView\\TradingView.exe`,
      `${process.env.PROGRAMFILES}\\TradingView\\TradingView.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\TradingView\\TradingView.exe`,
    ],
    linux: [
      '/opt/TradingView/tradingview',
      '/opt/TradingView/TradingView',
      `${process.env.HOME}/.local/share/TradingView/TradingView`,
      '/usr/bin/tradingview',
      '/snap/tradingview/current/tradingview',
    ],
  };

  let tvPath = null;
  const candidates = pathMap[platform] || pathMap.linux;
  for (const p of candidates) {
    if (p && deps.existsSync(p)) { tvPath = p; break; }
  }

  if (!tvPath && platform === 'win32') {
    // MSIX/Windows Store install — InstallLocation is in WindowsApps, which is ACL-restricted
    // for normal `dir` enumeration but readable via Get-AppxPackage without elevation.
    try {
      const ps = 'powershell -NoProfile -Command "(Get-AppxPackage -Name \'TradingView.Desktop\' -ErrorAction SilentlyContinue).InstallLocation"';
      const installDir = deps.execSync(ps, { timeout: 5000 }).toString().trim();
      if (installDir) {
        const candidate = `${installDir}\\TradingView.exe`;
        if (deps.existsSync(candidate)) tvPath = candidate;
      }
    } catch { /* ignore */ }
  }

  if (!tvPath) {
    try {
      const cmd = platform === 'win32' ? 'where TradingView.exe' : 'which tradingview';
      tvPath = deps.execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0];
      if (tvPath && !deps.existsSync(tvPath)) tvPath = null;
    } catch { /* ignore */ }
  }

  if (!tvPath && platform === 'darwin') {
    try {
      const found = deps.execSync('mdfind "kMDItemFSName == TradingView.app" | head -1', { timeout: 5000 }).toString().trim();
      if (found) {
        const candidate = `${found}/Contents/MacOS/TradingView`;
        if (deps.existsSync(candidate)) tvPath = candidate;
      }
    } catch { /* ignore */ }
  }

  if (!tvPath) {
    throw new Error(`TradingView not found on ${platform}. Searched: ${candidates.join(', ')}. Launch manually with: /path/to/TradingView --remote-debugging-port=${cdpPort}`);
  }

  const killExisting = async () => {
    // Exact-path, by-PID termination: enumerate processes and match the
    // resolved executable — a broad `pkill -f` substring can kill unrelated
    // processes whose cmdline merely mentions TradingView.
    const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
    const target = norm(tvPath);
    try {
      if (platform === 'win32') {
        const out = deps.execSync('wmic process get ProcessId,ExecutablePath /FORMAT:CSV', { timeout: 10000 }).toString();
        for (const line of out.split('\n')) {
          const parts = line.trim().split(',');
          if (parts.length < 3) continue;
          const [ , exePath, pid ] = parts;
          if (exePath && norm(exePath.trim()) === target) {
            deps.execSync(`taskkill /F /PID ${pid.trim()}`, { timeout: 5000 });
          }
        }
      } else {
        const out = deps.execSync('ps -eo pid:=,args=', { timeout: 5000 }).toString();
        const targetBin = basename(tvPath).toLowerCase();
        for (const line of out.split('\n')) {
          const m = line.trim().match(/^(\d+)\s+(.+)$/);
          if (!m) continue;
          const [ , pid, args ] = m;
          // argv[0] exact match only — a substring match on the full command
          // line would kill unrelated processes merely mentioning the name
          const argv0 = args.trim().split(/\s+/)[0];
          if (basename(argv0).toLowerCase() === targetBin) {
            deps.execSync(`kill ${pid}`, { timeout: 5000 });
          }
        }
      }
      await deps.delay(1500);
    } catch { /* may not be running */ }
  };

  if (killFirst) await killExisting();

  const cdpArgs = [`--remote-debugging-port=${cdpPort}`];
  let child = _spawnDetached(deps.spawn, tvPath, cdpArgs);
  let info = null;
  let usedLocalCopy = false;

  if (platform === 'win32' && WINDOWS_APPS_RE.test(tvPath)) {
    const earlyFailure = await _spawnFailedEarly(child);
    if (!earlyFailure) {
      info = await _waitForCdp({ cdpPort, attempts: 15, delay: deps.delay, probeCdp: deps.probeCdp });
    }
    if (!info) {
      // Direct WindowsApps launch was blocked or CDP never bound — fall back to
      // a local copy of the package (see _copyMsixPackageLocal). The fallback
      // honors the caller's kill_existing choice like the primary path.
      const localExe = _copyMsixPackageLocal(tvPath, deps);
      if (killFirst) await killExisting();
      child = _spawnDetached(deps.spawn, localExe, cdpArgs);
      tvPath = localExe;
      usedLocalCopy = true;
    }
  }

  if (!info) {
    info = await _waitForCdp({ cdpPort, attempts: 15, delay: deps.delay, probeCdp: deps.probeCdp });
  }

  if (info) {
    return {
      success: true, platform, binary: tvPath, pid: child.pid,
      cdp_port: cdpPort, cdp_url: `http://${CDP_HOST}:${cdpPort}`,
      browser: info.Browser, user_agent: info['User-Agent'],
      ...(usedLocalCopy && { msix_local_copy: true }),
    };
  }

  return {
    success: true, platform, binary: tvPath, pid: child.pid, cdp_port: cdpPort, cdp_ready: false,
    ...(usedLocalCopy && { msix_local_copy: true }),
    warning: 'TradingView launched but CDP not responding yet. It may still be loading. Try tv_health_check in a few seconds.',
  };
}
