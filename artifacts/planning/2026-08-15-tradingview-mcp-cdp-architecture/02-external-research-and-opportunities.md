# 02 — External Research: TradingView-via-CDP & Opportunity Map

> Web research · tradingview-mcp · 2026-08-15
> Question answered: **what has the community built for TradingView-over-CDP, what does TradingView's in-page surface actually expose, and which of it have we not adopted?**

## 0. The foundational fact

There is **no public TradingView REST/data API and no proprietary CDP extension**. Every
serious implementation uses the same mechanism we do:

> Launch TradingView Desktop (Electron) with `--remote-debugging-port=9222`, then
> `Runtime.evaluate` JavaScript against `window.TradingViewApi.*` in the chart page.

TradingView's *official* offerings — Widgets, Charting Library (Advanced Charts), broker/
trading panels — are **licensed embeds**, not automation endpoints. So CDP-into-the-desktop
-app is the community-standard (and only) path. Live probe of our instance confirms stock
**Chromium 140 / CDP 1.3 / Electron 38.2.2 / TVDesktop 3.3.0**, 53 CDP domains, no custom
TradingView domains.

Shared operational gotchas documented across projects (already handled in our codebase):
bind `127.0.0.1` not `localhost` (IPv6 first on some hosts); strip/`suppress_origin` the
WebSocket `Origin` header; Electron's single-instance lock ignores the debug flag on
relaunch; **undocumented internals break on app updates → pin the TV version** if stability
matters.

---

## 1. Reference implementations surveyed

| Project | What it is | Notable for us |
|---|---|---|
| **Fomo-Driven-Development/MaudeViewTVCore** | REST API (177–186 endpoints) over CDP + a passive **network-capture daemon** | Published a **catalog of TradingView JS-manager singletons** (see §2); captures TV's own WS/REST traffic offline via CDP `Network` domain |
| **RUDE-labs/tradingview-mcp** (fork of `tradesdontlie/tradingview-mcp`) | Adds **CDP connection pooling** for parallel tab ops | Reference design for a per-tab client pool (see §3) — directly applicable to our R1 breach |
| **allisonbit/tradingview-mcp** | 78-tool MCP + `tv` CLI | Confirms `_deps` dependency-injection test pattern + `installCdpMocks`/`mockEvaluateFromTable` test helpers |
| **Unjoselo/tradingview-desktop-mcp** | TV + MetaTrader5 bridge | Documents `suppress_origin`, MSIX/Store path detection, `tv_eval_js` escape hatch |
| **lnv-louis/tradingview-mcp** | 78-tool MCP | Poll-and-diff **streaming** loop with dedup to stdout |

Our lineage: `tradesdontlie/tradingview-mcp` → `m2ux/tradingview-mcp` (this repo, the fork we
push to). The RUDE-labs fork is a sibling of the same upstream — its pool is proven against
the **same single-WS-per-tab contention** we hit on 2026-08-14.

---

## 2. TradingView JS-manager catalog (from MaudeView's `docs/dev/js-internals.md`)

Browser-side singletons reachable via CDP JS evaluation, extracted from 489 JS bundles
(2026-02-11). **Bold = we already drive it.** Grouped by automation potential.

### HIGH potential

| Manager | Gives us | We use it? |
|---|---|---|
| **`chartApi()` / `_getChartApi()`** | Chart sessions, studies (`createStudy`/`modifyStudy`/`removeStudy`), series/pointsets, quote sessions, symbol resolution, timezone | ✅ yes (our chart/data/indicators/study) |
| **`_replayManager`** | Replay start/stop/step/autoplay, `isReplayStarted`, `replayStatusWV` | ✅ yes (`replay.js`) — note: we use `_replayApi`; the manager is the richer surface |
| **`getAlertsRestApi()`** | Alert CRUD + fire management (`listFires`, `deleteFires`, offline fires) | ⚠️ partial (basic `alert_create/list/delete`) — **fire/trigger history unused** |
| `hotlistsManager()` | **Market movers** — top gainers / most active / top losers by exchange | ❌ **no** → candidate `data_get_hotlist` |
| `_accountsManager` + `currentAccountApi()` | **Paper/live account** + order/trade **capability** queries | ❌ **no** → real order management, beyond replay trades |
| `_deepBacktestingManager` | **Strategy backtest sessions**, `activeStrategyReportData`, `activeStrategyStatus` | ❌ **no** → richer than our Strategy-Tester scraping |

### MEDIUM potential

| Manager | Gives us | We use it? |
|---|---|---|
| `ContextMenuManager` | Programmatic context menus (`createMenu`/`showMenu`) — trigger chart actions w/o mouse | ❌ no |
| `_scriptManager` | Pine editor control — `openScript(scriptId)` (cleaner than our DOM-walking in `pine_ui.js`) | ⚠️ partially — we DOM-drive |
| `_sessionSummaryManager` | Session P&L — `realizedPL`, highest profit, win-rate | ❌ no |
| `dialogsOpenerManager` | Track/force dialog open-close state | ❌ no |
| **`toastManager`** | **Event subscription** — `subscribeOnToast(callback)`; groups `"alerts"`, `"alertsFireControl"` | ❌ **no** → **push model** for alert fires instead of polling (see §5) |
| `_executionsPointsManager` | Trade execution markers on chart | ❌ no |
| `_orderPresetsManager` | Saved order configs | ❌ no |
| `_subscriberManager` | Data-feed subscriptions, `setMinAvailableResolution` | ❌ no |
| `_authTokenManager` | Auth token lifecycle | ❌ no |

### LOW potential (skip)

`sessionStorageManager`, `_colorManager`, `_zoneManager` (canvas), `PriceCurrencyCache`,
`iconManager`, `getConfigurationManager`/`getAdapterManager` (Monaco internals).

**Immediate opportunity shortlist:** `data_get_hotlist` (hotlistsManager), alert **fire
history** (getAlertsRestApi.listFires), **paper-account order ops** (accountsManager +
currentAccountApi), **richer backtest report** (deepBacktestingManager), and **event-driven
alert/fire notifications** (toastManager). Each requires the `KNOWN_PATHS` centralization
(`01` R2) first so the new singleton paths live in one place.

---

## 3. Connection pooling for parallel tabs (RUDE-labs design)

Directly applicable to breach **R1** (transport not exclusive). Their change:

- Replace singleton `let client = null` with `Map<targetId, {client, lastUsed}>`, LRU-capped
  at 8, with health checks + eviction.
- `resolveTabTarget(tabIndex)` → `/json/list` filtered to chart targets.
- `getClientForTarget(targetId)` — create-or-reuse a cached per-tab CRI client.
- `getClient(targetId)` routing: explicit `targetId` → pool; `defaultTargetId` (set by
  `tab_switch`) → pool; else → original singleton.
- Every tool accepts optional `tabId`; backward-compatible when omitted.

**Key confirmation:** each chart tab is an **independent Electron renderer process** with its
own `window.TradingViewApi` — so parallel per-tab clients **do not interfere**. This is a
cleaner alternative to our `withTargetEvaluate` **open-use-close-per-call** churn (which is
what produced the 2026-08-14 single-WS-per-tab contention wedges).

---

## 4. Passive network capture (MaudeView)

A separate daemon uses the CDP **`Network`** domain to capture TradingView's own WebSocket /
REST traffic for offline analysis. We currently use only `Runtime` / `Page` / `Input` /
`DOM`. Optional future capability (e.g. reverse-engineering a data feed), **not** required
for the refactors above.

---

## 5. Event-driven (push) vs polling — the timeout-free direction

Two findings converge on replacing our poll-and-timeout model with push:

1. **`toastManager.subscribeOnToast(callback)`** — TradingView's own in-page event bus for
   alert/fire notifications (groups `"alerts"`, `"alertsFireControl"`).
2. **CDP push channels we ignore today** — `Inspector.targetCrashed` (page crash),
   `Target.setDiscoverTargets` (target lifecycle events), plus `Runtime.consoleAPICalled` /
   `exceptionThrown`. Combined with **flat sessions** (one browser-target WebSocket +
   `Target.attachToTarget({flatten:true})` → `sessionId`-scoped commands), connection health
   and tab lifecycle become **events**, not probes — so the `withTimeout` backstop shrinks
   to a last-resort on a single RPC rather than the health-detection mechanism.

`chrome-remote-interface@0.33.3` supports `sessionId` routing on every command/event, so
flat sessions are reachable without a dependency swap.

---

## 6. Research → architecture mapping + build order

| Research finding | Maps to | Action |
|---|---|---|
| Manager catalog (§2) — new singletons to adopt | `01` **R2** (KNOWN_PATHS ignored) | Centralize paths **first** so each new manager is one registry entry, not 13-file edits |
| Connection pool (§3) | `01` **R1** (tab/capture bypass transport) | Adopt a transport-provided per-tab client (scoped-client factory → pool) instead of open/close-per-call |
| Event-driven / toast / flat sessions (§5) | the 2026-08-14 timeout discussion | Follow-up after R1: subscribe to disconnect/crash/target events + `toastManager` for push alerts |
| Passive capture (§4) | new capability | Defer; optional |

**Recommended build order (each independently mergeable):**

1. **R2** — centralize `KNOWN_PATHS` (lowest risk; prerequisite for every new manager).
2. **R1** — transport scoped-client factory; route `tab.js`/`capture.js` through it (fixes the real contention breach). *Optionally* evolve to the RUDE-labs pool.
3. **R3** — consolidate CDP protocol-domain calls into `core/dom.js`.
4. New-tool candidates on the cleaned base, in value order: `data_get_hotlist` → alert fire history → paper-account order ops → deep-backtest report.
5. **Event-driven follow-up** — flat sessions + `Target`/`Inspector`/`toastManager` events → shrink `withTimeout` to a pure RPC backstop.

**Sources:** github.com/Fomo-Driven-Development/MaudeViewTVCore (+ MaudeViewTvDocs,
`docs/dev/js-internals.md`), github.com/RUDE-labs/tradingview-mcp, github.com/allisonbit/
tradingview-mcp, github.com/Unjoselo/tradingview-desktop-mcp, github.com/lnv-louis/
tradingview-mcp, dev.to/iliaa "Driving TradingView Desktop From an AI Agent",
itexus.com TradingView-API guide, tradingview.com/widget.
