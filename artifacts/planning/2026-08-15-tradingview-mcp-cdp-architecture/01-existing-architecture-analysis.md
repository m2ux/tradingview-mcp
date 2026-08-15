# 01 — Existing CDP-Interface Architecture Analysis

> Read-only review of `src/` · tradingview-mcp · 2026-08-15
> Question answered: **is the CDP interface a clean, stratified layer stack or a set of ad-hoc methods?**

## Verdict

A **genuine stratified 4-layer stack, not ad-hoc growth** — with **three localized,
fixable breaches**. The bones are good: dependency flow is one-directional and acyclic,
there is a real transport layer, a coherent domain layer, and an exemplary tool layer.
The organic-growth smell is concentrated in three nameable places, none of which require
an architectural redo.

```
server.js ─► tools/*.js ─► core/*.js ─► connection.js ─► chrome-remote-interface
              (zod+fmt)    (domain)     (transport)         (vendor)
```

`src/` totals **10,578 lines**. Complexity correctly concentrates in `core/`; the 16
`tools/*.js` files are uniformly thin (16–144 lines).

---

## 1. The four layers

### 1.1 Transport — `src/connection.js` (469 lines) — **present and real, but not exclusive**

Owns everything a transport layer should:

- **Client lifecycle** — `connect()` (110), `getClient()` with a liveness probe (90),
  `reconnectTo()` (155), `disconnect()` (431).
- **Bounded calls** — `withTimeout()` wraps every network call with `CDP_CALL_TIMEOUT_MS`
  (added 2026-08-14; default 10 s, env-overridable via `TV_CDP_TIMEOUT_MS`).
- **Retry with backoff** — `connect()` loop; `withTargetEvaluate()` scoped-read retry.
- **Target discovery / resolution** — `findChartTarget`, `findTargetById`,
  `findTargetByRef` (chart_id / URL substring / `layout:`-prefixed or bare layout name).
- **Evaluate primitives** — `evaluate()` / `evaluateAsync()` that all domain code is
  *meant* to use; `withTargetEvaluate()` for background-tab reads without tab switching.
- **`KNOWN_PATHS` registry** — the intended single source of truth for page paths.
- **Sanitizers** — `safeString()` (JSON.stringify injection guard), `requireFinite()`.
- **Security** — `assertLoopbackHost()` refuses non-loopback CDP without `TV_ALLOW_REMOTE_CDP=1`;
  IPv4 `127.0.0.1` default (never `localhost`/`::1`).

**Breach:** it is not the *only* place constructing CDP clients (see §3, R1).

### 1.2 Protocol — **absent as a distinct layer; CDP domain calls leak into domain code**

There is no module that isolates the CDP protocol domains (`Input.*`, `Page.*`, `DOM.*`).
Domain modules call them directly:

- `Input.dispatchMouseEvent` — `core/dom.js:30-36` **and duplicated** in `core/ui.js:415,433,441`
- `Input.dispatchKeyEvent` — `core/dom.js:101,109`
- `Page.captureScreenshot` — `core/capture.js:104`, `core/batch.js:41`
- `Runtime/Page/DOM.enable` — correctly only in `connection.js:133-135` (plus a re-enable in `capture.js:18`)

`core/dom.js` is the *closest thing* to a protocol layer (it wraps `Input.dispatch*` in
`clickAt`/`pressKey` and provides pure JS-snippet builders), but `core/ui.js` bypasses it.
**Tangled.** (R3)

### 1.3 TradingView-domain — `src/core/*.js` — **present and well-organized**

Each module owns a coherent TradingView concern:

| File | Lines | Concern |
|---|---|---|
| `pine.js` | 1310 | Pine Script lifecycle (largest) |
| `pine_ui.js` | 1074 | Pine UI automation |
| `data.js` | 825 | OHLCV / studies / pine graphics |
| `ui.js` | 498 | Panels, clicks, layouts, scroll/zoom |
| `health.js` | 489 | Health + launch + update (**cohesion grab-bag**, R5) |
| `capture.js` | 394 | Screenshot + snapshot |
| `stream.js` | 335 | Quote/bar streaming |
| `tab.js` | 335 | Tab management (**transport bypass**, R1) |
| `chart.js` | 311 | Chart state/symbol/timeframe |
| `drawing_templates.js` | 309 | Drawing style templates |
| `indicators.js` | 261 | Indicator add/remove/inputs |
| `study.js` | 248 | Headless study lifecycle |
| `dom.js` | 211 | CDP input + JS-snippet builders |
| `watchlist.js` | 204 | Watchlist ops |
| `pane.js` | 183 | Pane layout/focus |
| `update.js` | 163 | Self-update |
| `replay.js` | 142 | Bar replay |
| `alerts.js` | 128 | Alerts |
| `drawing.js` | 113 | Draw shapes |
| `batch.js` | 86 | Multi-symbol batch |
| `err.js` | 49 | Structured `tvError` (leaf, zero imports) |
| `index.js` | 17 | Public barrel (`export * as chart …`) |

`core/index.js` exposes a clean public barrel. The problem is *how* modules reference page
internals (§3, R2).

### 1.4 Tool / MCP — `src/tools/*.js` — **clean, exemplary**

Every tool file follows one identical pattern (zod arg schema → call `core` →
`jsonResult`/`errorResult`). Result formatting is centralized in `tools/_format.js`
(jsonResult / errorResult / UNTRUSTED fencing / transient-CDP `retryable:true` surfacing).
`server.js` registers 17 tool groups through `capabilities.js`'s `wrapRegistrar` allowlist.
**Zero CDP / zero `TradingViewApi` references in any `tools/` file.**

---

## 2. Dependency direction

One-directional and acyclic:

```
server.js ──► tools/*.js ──► core/*.js ──► connection.js ──► chrome-remote-interface
                              │ ├──► wait.js ──► connection.js
                              │ ├──► core/dom.js ──► connection.js   (shared primitives)
                              │ ├──► core/pine_ui.js ──► connection.js
                              │ └──► core/err.js                     (leaf)
cli/commands/*.js ──► core/*.js            (parallel CLI surface over the same domain core)
```

- **No circular imports.** `connection.js` imports only `core/err.js` (a leaf) — acceptable.
- **Intra-core imports are few and sane** (`indicators/pine/ui` → `dom.js`; `pine` → `pine_ui.js`;
  several → `err.js`) — "shared helper" edges, not cycles.
- **One anomaly:** `core/tab.js` and `core/capture.js` import `chrome-remote-interface`
  **directly**, creating a second edge from the domain tier to the vendor library that
  bypasses the transport tier (R1). `core/health.js` additionally mixes `child_process`/
  `https` (launch + update-check) into a "domain" module (R5).

---

## 3. The three breaches (evidence)

### R1 — Transport layer is bypassed by two domain modules

`core/tab.js` and `core/capture.js` construct their own raw CDP clients and re-implement
the scoped-client + timeout + cleanup pattern that `connection.js` already owns.

| Signal | Sites | Evidence |
|---|---|---|
| `chrome-remote-interface` imports | 3 files (should be 1) | `connection.js:1`, **`core/tab.js:12`**, **`core/capture.js:5`** |
| Raw `await CDP(` construction | 5 sites | `connection.js:231`; **`tab.js:59,84,105`**; **`capture.js:17`** |
| Direct `Runtime.evaluate` | 9 sites | `connection.js:97,232,346,409` (legit — transport-internal); **`tab.js:60,66,85,107`**; **`capture.js:40`** |

`tab.js` builds its own clients for `withShell`, `isTargetVisible`, `withTarget`; `capture.js`
does the same via `_makeScopedClient`. Both duplicate logic `withTargetEvaluate()` already
provides. **Fix: route both through a transport-provided scoped-client factory.**

### R2 — `KNOWN_PATHS` failed as the single-source-of-truth for page paths

`KNOWN_PATHS` (defined in `connection.js`) is imported by exactly **one** consumer
(`core/data.js:37`), while the same path literal is hard-coded across many files:

- **`window.TradingViewApi` literal: 13 files.**
- **`_activeChartWidgetWV.value()` redefined as an identical local `CHART_API` const in 4 files:**
  `chart.js:7`, `indicators.js:7`, `study.js:16`, `stream.js:7`
  (only `data.js:37` does it right: `const CHART_API = KNOWN_PATHS.chartApi;`).
- Inlined raw additionally in `health.js`, `ui.js`, `capture.js`, `pane.js`, `alerts.js`,
  `wait.js`, `pine_ui.js`.

If a page path changes on a TradingView update, you edit ~13 files. **Fix: every domain
imports paths from `connection.js`'s `KNOWN_PATHS`; retire the local consts.**

### R3 — No protocol layer; CDP domain calls scattered

`Input.dispatch*` and `Page.captureScreenshot` are spread across `dom.js` / `ui.js` /
`capture.js` / `batch.js`, and `ui.js:415-447` re-implements `dom.js`'s own `clickAt`.
**Fix: funnel all CDP protocol-domain calls through one module (`core/dom.js`).**

---

## 4. Secondary smells

- **R4 — Magic-number `setTimeout` sleeps scattered across ~15 files** with no shared
  settle/delay helper; `tab.js` alone has eight (1500/700/400/800/500/2000/1000/400 ms);
  `dom.js`, `pine_ui.js`, `indicators.js`, `stream.js` each redefine their own `sleep`/`delay`.
  *Network* timeouts/retries are correctly centralized in `connection.js`; only *UI-settling*
  sleeps are scattered. `wait.js` centralizes *polling* waits correctly.
- **R5 — `core/health.js` is a cohesion grab-bag (489 lines)** mixing CDP health, process
  launch (`spawn`/`execSync`), MSIX filesystem copying, and GitHub update-checks. Belongs
  split into `health` + `launch` + `update`.

---

## 5. Strongest vs weakest

**Strongest**
1. Tool layer is exemplary (uniform zod, centralized fenced formatting, capability gating, zero CDP leakage).
2. `connection.js` is a real transport layer (liveness probe, bounded calls, retry, loopback enforcement, transient classification).
3. Dependency direction is clean and acyclic; proper barrel; MCP + CLI share one domain core.
4. Security is layered (loopback assertion, zod at boundary, `safeString` injection guard, UNTRUSTED fencing, registrar allowlist).
5. `core/dom.js` is a good pattern (pure, unit-testable JS-snippet builders separated from live dispatch).

**Weakest**
1. `tab.js` / `capture.js` bypass the transport layer (R1).
2. `KNOWN_PATHS` ignored — path literal duplicated across 13 files (R2).
3. No protocol layer — `Input.*`/`Page.*` scattered (R3).
4. Magic-number sleeps scattered (R4).
5. `health.js` cohesion grab-bag (R5).

---

## 6. Refactor list (each independently mergeable)

| ID | Refactor | Risk | Leverage |
|----|----------|------|----------|
| **R1** | Add a transport-provided scoped-client factory in `connection.js`; route `tab.js` + `capture.js` through it (delete their raw `CDP(` + `Runtime.evaluate`) | Medium | High — fixes contention + removes duplication |
| **R2** | Centralize page paths: make all domains import `KNOWN_PATHS`; delete the 4 duplicate `CHART_API` consts + inline literals | Low | High — single-point-of-change; prerequisite for new managers (see `02`) |
| **R3** | Consolidate CDP protocol-domain calls (`Input.dispatch*`, `Page.captureScreenshot`) into `core/dom.js`; make `ui.js` use it | Medium | Medium — removes duplication, isolates protocol |
| **R4** | Introduce one shared `delay`/`settle` helper; replace scattered magic-number sleeps | Low | Low-Med — readability/consistency |
| **R5** | Split `health.js` into `health` / `launch` / `update` | Medium | Medium — cohesion, testability |

**Recommended order:** R2 (lowest risk, unblocks new work) → R1 (fixes the real breach) →
R3 → R4 → R5. See `02-external-research-and-opportunities.md` §6 for how external designs
(connection pool, event-driven) slot in after R1.
