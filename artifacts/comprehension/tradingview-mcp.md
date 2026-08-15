# tradingview-mcp — Comprehension

> 2026-08-08 · work packages: [2026-08-08-tradingview-mcp-mitigations](../planning/2026-08-08-tradingview-mcp-mitigations/README.md), [2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server](../planning/2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server/README.md) · coverage: full server surface; depth on the CDP transport layer, page-path registry usage, and per-module protocol-call scatter, read at branch `chore/24-improve-cdp-architecture` commit `4ff5104` · related: none

MCP server (88 tools by default, 95 with `TV_ALLOW_DANGEROUS=1`) that reads and drives a live TradingView Desktop chart over the Chrome DevTools Protocol.

## Structure

### Overview

One Node process on stdio fronts a thin zod tool layer; every chart touch funnels through a singleton CDP client in `src/connection.js` — with three known bypass sites that open their own private sockets (`src/core/capture.js`, `src/core/tab.js`, and `src/connection.js`'s own `withTargetEvaluate`). Tool output is fenced at a single formatter.

```
agent (MCP) ── stdio ── src/server.js ── registrars (src/tools/*) ── core domains (src/core/*)
                                  │                                        │
                        capabilities.js gate (TV_ALLOW_DANGEROUS)          ▼
                                                              src/connection.js  (client singleton,
                                                              KNOWN_PATHS, evaluate chokepoint)
                                                                          │
                                                                          ▼
                                                  CDP ws://127.0.0.1:9222 ── TradingView Desktop (Electron)
```

### Project

ESM Node package (`"type": "module"`), no build step — plain JavaScript, `node --test`, eslint flat config. Dependencies: `@modelcontextprotocol/sdk` and `chrome-remote-interface` only.

#### Build units

| Unit | Path | Role |
|------|------|------|
| MCP server | `src/server.js` | instructions + registrar wiring, stdio transport |
| CLI | `src/cli/` | `tv` bin; one module per area mirroring `src/tools/` |
| Public core API | `src/core/index.js` | re-exports 12 namespaces (`chart, data, pine, health, capture, drawing, drawing_templates, replay, alerts, batch, watchlist, indicators, ui`) as `tradingview-mcp/core` |
| Tests | `tests/` | `node --test` unit + e2e (live Desktop + CDP) |
| Agents/skills | `agents/`, `skills/` | one Claude agent; five task skills |
| CI | `.github/workflows/ci.yml` | unit tests on push |

#### Entry points

Process start → `src/server.js` constructs the MCP server, runs 16 registrar calls through [wrapRegistrar](https://github.com/m2ux/tradingview-mcp/blob/4ff51041ee352dd31461287dc6d665c63d5cf3b2/src/capabilities.js#L34), and connects stdio. Each tool call then walks:

```
server.tool handler → zod schema (src/tools/<area>.js) → core function (src/core/<area>.js)
  → JS expression string → connection.evaluate() → Runtime.evaluate in the chart page
  → JSON back → jsonResult() (+ fenceValue on chart-derived strings)
```

The CLI (`src/cli/`) reaches the same `core/*` functions without the MCP layer.

### Module Map

| Module | Responsibility | Depends on |
|--------|---------------|------------|
| `src/server.js` | MCP server construction, instructions, registrar wiring | `tools/*`, `capabilities.js` |
| `src/capabilities.js` | `TV_ALLOW_DANGEROUS=1` gate: `wrapRegistrar` skips registering gated tools | — |
| `src/connection.js` | CDP client singleton (`getClient`/`connect`/`reconnectTo`/`disconnect`), target discovery (`/json/list`, `findChartTarget`/`findTargetById`/`findTargetByRef`), `evaluate()`/`evaluateAsync()`, `withTargetEvaluate` scoped-client reads, `attachChart`, `KNOWN_PATHS` registry, `safeString`/`requireFinite`, `assertLoopbackHost`, `isTransientCdpError` | `chrome-remote-interface` |
| `src/wait.js` | shared wait/poll helpers (`waitForChartReady`, `waitForChartRender`) | `connection.js` |
| `src/tools/_format.js` | `jsonResult()` response shape; `fenceString`/`fenceValue` untrusted-content fencing | — |
| `src/tools/*.js` (16 registrars) | zod-validated thin wrappers delegating to core | `core/*`, `_format` |
| `src/core/chart.js` | chart state, symbol/timeframe/type, visible range, scroll, symbol search (REST) | `connection.js` |
| `src/core/data.js` | OHLCV, indicator values/series, Pine graphics readers, trades/equity | `connection.js` |
| `src/core/stream.js` | quote/bars/values/lines/labels/tables/all-panes streaming reads | `connection.js` |
| `src/core/pine.js` | Pine editor automation, compile, save/bind/publish, facade REST `check()` | `connection.js`, `fetch` |
| `src/core/pine_ui.js` | Pine Editor UI walks (open/save-as/publish wizard) | `connection.js` |
| `src/core/study.js` | headless study lifecycle (`studyAdd`/`studyRemove`/`studyIds`) | `connection.js` |
| `src/core/tab.js` | tab list/new/close/switch — drives the **Electron shell window** DOM directly | `connection.js`, `chrome-remote-interface` |
| `src/core/capture.js` | screenshot, snapshot | `connection.js`, `chrome-remote-interface` |
| `src/core/dom.js` | CDP `Input.dispatch*` payloads, click-at, key press, DOM expression builders | `connection.js` |
| `src/core/ui.js` | UI verbs (click/hover/keyboard/type/scroll/find), panels, layouts, in-page REST | `connection.js` |
| `src/core/health.js` | health check, discovery, `uiState`, cross-platform launch incl. MSIX fallback, kill, **and `checkForUpdate` git-compare** | `connection.js`, `child_process` |
| `src/core/update.js` | self-update (git ff-only + conditional `npm ci`, DI `_deps`) | `child_process` |
| `src/core/replay.js` | bar-replay control and practice trades | `connection.js` |
| `src/core/{alerts,batch,watchlist,indicators,pane,drawing,drawing_templates}.js` | remaining chart domains | `connection.js` |

### Design Patterns

#### Bridge/Adapter

MCP tools are thin zod adapters over core domain functions; the same core is reused by the CLI and exported as `tradingview-mcp/core`. One registrar per area, wired unconditionally except where `capabilities.js` gates.

#### Singleton connection — with scoped-client exceptions

One cached CDP client with liveness re-check and exponential-backoff reconnect (5 attempts, 500 ms base, 30 s cap) is the shared transport. Three sites deliberately bypass the singleton with short-lived private clients: [withTargetEvaluate](https://github.com/m2ux/tradingview-mcp/blob/4ff51041ee352dd31461287dc6d665c63d5cf3b2/src/connection.js#L183) (background-tab reads, retry loop + `TV_CDP_BUSY` marker), [_makeScopedClient](https://github.com/m2ux/tradingview-mcp/blob/4ff51041ee352dd31461287dc6d665c63d5cf3b2/src/core/capture.js#L15) in `captureScreenshot`, and three `CDP({...})` opens in `src/core/tab.js` (`withShell` probe, `isTargetVisible`, `withTarget`). `isTransientCdpError` and the 4-attempt retry exist because these private sockets race the shared client on TradingView's dev-tools endpoint — the wedge observed under parallel tab work on 2026-08-14.

#### Direct-path probing — registry honoured two ways, ignored a third

`KNOWN_PATHS` in `connection.js` pins live-probed TradingView widget API paths (`_activeChartWidgetWV`, `_chartWidgetCollection`, `_replayApi`, `_alertService`, `layoutManager`, `symbolSearchApi`, `pineFacadeApi`), each verified at call time by `verifyAndReturn`. Consumption splits three ways: `data.js` imports the map directly (`CHART_API`, `BARS_PATH`); `drawing.js`, `batch.js`, and `replay.js` use the verified getters (`getChartApi`, `getChartCollection`, `getReplayApi`); and ~10 modules re-hardcode the same literals — `chart.js`, `stream.js` (×2), `indicators.js`, `study.js`, `pine_ui.js`, `pane.js` (×2), `alerts.js`, `wait.js`, and `health.js` (×6). The getter idiom is the in-tree proof of the intended pattern.

#### Dependency-injection seam around the transport

Eleven core modules import `evaluate`/`evaluateAsync` aliased (`_evaluate`) behind a `_resolve(_deps)` helper so tests inject fakes (`chart`, `data`, `study`, `replay`, `watchlist`, `drawing`, `drawing_templates`, `batch`, `capture`, `health`, `dom`); seven bind the functions directly (`pine`, `stream`, `pane`, `indicators`, `alerts`, `ui`, `pine_ui`). The seam means a transport refactor that preserves the exported signatures lands behind the DI modules with no call-site edits, leaving the direct-binding modules as a mechanical sweep.

#### Dependency injection for tests

`core/update.js` (`_deps`), `core/health.js` launch internals, and `core/dom.js` accept injected `execSync`/`existsSync`/`spawn`/clients so unit tests run without git, processes, or a live CDP endpoint.

#### Evaluate-everything chokepoint

Nearly all chart interaction funnels through [evaluate](https://github.com/m2ux/tradingview-mcp/blob/4ff51041ee352dd31461287dc6d665c63d5cf3b2/src/connection.js#L250): ~150 call sites across 19 core modules (heaviest: `chart.js` 44, `replay.js` 38, `pine_ui.js` 30, `study.js` 28, `data.js` 25). GitNexus maps 150 execution flows through it. Raw CDP protocol calls outside `connection.js` are few and localized: `Page.captureScreenshot` (`capture.js`), `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` (`dom.js` 7 sites), and the `tab.js`/`capture.js` client opens.

#### Untrusted-content fencing

`fenceString`/`fenceValue` in `src/tools/_format.js` wrap chart-derived strings in `UNTRUSTED_<origin>_START/END` fences at the single response funnel — the mitigation for indirect prompt injection via Pine labels/tables, console text, and UI state.

### Core Types

| Type | Role |
|------|------|
| MCP tool result `{ content: [{ type: 'text', text }], isError? }` | the single response shape, via `jsonResult()` |
| `KNOWN_PATHS` | string map of live-probed TradingView API paths — the intended page-path registry |
| CDP `client` / `targetInfo` | module-level singletons in `connection.js` |
| Target reference | `target` param resolved by `findTargetByRef`: CDP target id → `/chart/<id>` segment → URL substring, chart pages only |
| `{ retryable: true, code: 'TV_CDP_BUSY' }` error | transient-endpoint signal telling the tool layer to advise wait/retry |

### Traits and Interfaces

| Interface | Reached for |
|-----------|-------------|
| `evaluate(expression, opts)` / `evaluateAsync` | page-context execution on the shared client — the one chokepoint |
| `withTargetEvaluate(ref, fn)` | reads against a background tab without switching the active tab |
| `attachChart(ref)` / `reconnectTo(targetId)` | re-point the shared client (tv_attach, tab_switch, reconnect after drop) |
| `getChartApi()` … `getMainSeriesBars()` | verified KNOWN_PATHS strings for expression builders |
| `safeString` / `requireFinite` | interpolation safety for expression builders |
| `assertLoopbackHost` | refuse non-loopback CDP endpoints unless `TV_ALLOW_REMOTE_CDP=1` |
| `wrapRegistrar` (capabilities) | tool gating at registration time |

### Data Model

State lives in the TradingView page (chart widget model, studies, drawings, alerts); the server holds almost no domain state — the CDP client singleton, `targetInfo`, and a 1-hour `checkForUpdate` cache in `health.js`. Data flow: tool args → zod validation → core builds a JS expression (interpolating via `safeString`/`requireFinite`) → `Runtime.evaluate` in page → JSON result back → fenced at `jsonResult`.

## Behaviour

### Data Flow Map

Trust enters at two edges: tool arguments from the agent (validated by zod, interpolated via `safeString`) and page content coming back (fenced at `jsonResult`). A second, less visible edge is the CDP transport itself: `/json/list` HTTP fetches and WebSocket attaches.

#### Standard tool call

agent args → zod (tools/*) → core expression builder → `evaluate()` → shared client `Runtime.evaluate` → value → `jsonResult`(+fence) → agent.

#### Background-tab read (`target` param)

tool arg `target` → `findTargetByRef` (`/json/list`) → `withTargetEvaluate` opens a **private** socket to that target → scoped `Runtime.evaluate` → close. Retries 4× on `isTransientCdpError`, then throws `TV_CDP_BUSY`.

#### Tab switch / attach

`tab_switch` → shell-window DOM click via a private shell client (`withShell`) → `reconnectTo(targetId)` closes the shared client and re-attaches it to the new target. `tv_attach` does the `reconnectTo` without the DOM click, so it reaches background tabs.

#### Screenshot

`captureScreenshot` opens its own scoped client (`_makeScopedClient`), evaluates clip bounds, and calls `Page.captureScreenshot` — bypassing the shared client to avoid interfering with in-flight evaluates, at the cost of one more competing socket.

### Design Patterns (runtime)

#### Retry-on-transient at the bypass, not at the chokepoint

Transient-CDP tolerance (`isTransientCdpError`, backoff, `TV_CDP_BUSY`) lives only on the `withTargetEvaluate` scoped path. The shared-client path relies on the `getClient` liveness probe and full reconnect instead — an asymmetry: the code has learnt where sockets wedge, and the mitigation sits at the private-socket site rather than at a shared transport policy.

#### Shell-window DOM driving

Tab create/switch/close cannot be done through chart-page CDP (Electron accelerators don't fire from CDP input, `/json/activate` doesn't drive the Desktop tab bar), so `tab.js` locates the `app/window/index.html` target and clicks `.tabs-container .tab` in its DOM. This is why `tab.js` holds its own clients: the shell window is a different CDP target from any chart.

### Invariant Alignment

| Invariant | Producer enforces? | Consumer assumes? | Gap? |
|-----------|-------------------|-------------------|------|
| Interpolated strings are safe JS literals | `safeString` (JSON.stringify) where used | core expression builders | Partial — selector builders in `core/ui.js` escape only `"` |
| Update target is trustworthy code | none (mutable origin/main) | user trusts fetched code | Gap — no allowlist/pin/token |
| Chart-originated text is data, not instructions | `fenceString`/`fenceValue` at `jsonResult` | agent treats fenced output as data | Closed since 2026-08-08 pass (fencing now present) |
| Killed process is the TradingView binary | resolved-executable PID match (`taskkill /PID`, `kill <pid>`) | launch kills only TradingView | Narrowed — exact-PID now |
| One writer per chart target | none — shared client plus up to three private-socket sites | TradingView endpoint tolerates concurrent clients | Gap — races surface as `TV_CDP_BUSY` wedges under parallel tab work |
| Fixed-duration waits are routed through a shared helper | `wait.js` structured waits (`waitForChartReady`/`waitForChartRender`, DI-injectable) adopted by batch/data/chart; bare `sleep` in `core/dom.js` | 32 raw `setTimeout` sleeps across 10 core modules bypass both (tab.js 8, pine.js 5, chart.js 5) | Gap — helpers exist and are proven in-tree; adoption, not invention, is the missing step |
| Public core API matches actual consumers | `core/index.js` re-exports 12 namespaces | `cli/commands/` imports tab/stream/pane/capture/indicator core modules the facade omits | Gap — the facade is partial; CLI usage makes tab/stream/study/dom/pane de-facto public |
| Page paths come from the KNOWN_PATHS registry | registry exists with verified getters; data.js imports the map, drawing/batch/replay use the getters | ~10 modules re-hardcode the same literals | Gap — registry bypass; a TradingView path change means editing ~15 sites across 10 files |
| Target listing (`/json/list`) is read through connection.js finders | 3 finders in connection.js | tab.js re-implements the fetch 5 times | Gap — a `listTargets()` export collapses the copies |
| CDP protocol calls live in the transport module | `connection.js` owns `Runtime.evaluate` | `dom.js` (Input.dispatch), `capture.js` (Page.captureScreenshot), `tab.js` (client opens) call CDP directly | Partial — scattered but few; each carries its own error/retry idiom |
| Health module does health only | — | `health.js` also launches, kills, MSIX-copies, and git-compares for updates | Gap — cohesion smell: `checkForUpdate` + `launch` + `healthCheck` + `uiState` + `discover` in one 489-line module |

### Execution Context

Single Node process on stdio; tool handlers are effectively serialized by the MCP loop, but `withTargetEvaluate`/`tab.js`/`capture.js` private sockets introduce real concurrency against TradingView's dev-tools endpoint. Failure consequences: tool error returns to the agent (`isError: true`); `TV_CDP_BUSY` marks retryable contention; no process-level crash paths observed except launch spawn handling. Observable at default verbosity only through returned error text.

### Error Handling

| Error type | Consumer reaction |
|------------|-------------------|
| zod validation failure | `isError: true` response before any core call |
| JS page exception (`exceptionDetails`) | unwrapped to `JS evaluation error: …` at both `evaluate` and the `withTargetEvaluate` scoped helper |
| Connection failure | 5-attempt exponential backoff in `connect()`, then actionable message ("Is TradingView open with a chart?") |
| Transient socket close on scoped path | `isTransientCdpError` → 4 retries, then `TV_CDP_BUSY` (`retryable: true`) |
| Target not found / no ref match | thrown Error naming the missing target, surfaced as tool error |
| `npm ci` failure after update | warn-not-fail (`depsWarning`); code/deps skew left to the operator |

### Resource Bounds

#### Declared limits

| Constant | Value | Binds |
|----------|-------|-------|
| `MAX_RETRIES` / `BASE_DELAY` | 5 / 500 ms (30 s cap) | `connect()` backoff |
| scoped-path retries | 4 (300 ms × attempt) | `withTargetEvaluate` |
| OHLCV cap | 500 bars | data reads |
| Pine labels cap | 50 per study (overridable) | label reads |
| trades cap | 20 per request | strategy reads |
| update cache | 1 hour | `checkForUpdate` git calls |

#### Enforcement

Caps live in the core readers; the retry budgets are the only transport-level bounds. There is **no bound on concurrent private sockets** — each `target`-param read, screenshot, and tab op opens one.

#### Peak cost

| Site | Live at peak | Bounded by |
|------|-------------|------------|
| parallel `target` reads | 1 shared client + N scoped clients | nothing — N = outstanding calls |
| `data_get_ohlcv` | 500 bars × OHLCV | the cap above |
| `pine_get_source` | full script text (can exceed 200 KB) | nothing — documented as avoid-unless-editing |

### Operational Scenarios

| Scenario | Effect on this code path | Risk |
|----------|------------------------|------|
| TradingView not running / no CDP | connect retries 5× with backoff, then actionable error | low |
| Tab switch | shell-DOM click, then `reconnectTo(targetId)` re-attaches shared client | low |
| Parallel background-tab reads | private sockets race the shared client → transient closes, `TV_CDP_BUSY` | medium — the 2026-08-14 wedge; retries mask but do not remove contention |
| TradingView update moves widget paths | every hardcoded path site needs editing (~15 sites in 10 files); registry consumers (data.js) need one edit | medium — registry-bypass cost |
| Update with dirty tree / wrong branch | guarded refusal before mutation | low |
| Update with `npm ci` failure | code updated, deps stale, warning returned | medium |
| MSIX install blocks CDP port | fallback copies package locally (~330 MB one-time) and relaunches | medium — copy not hash-verified |

## Inferred Design Rationale

Rationale here is read out of the code, its comments and its structure; where the source documents a reason outright, the entry says so.

### One shared CDP client with liveness probe

The singleton plus `Runtime.evaluate('1')` liveness re-check gives every tool a ready transport without per-call attach cost, and full reconnect (not in-place repair) keeps recovery logic to one path. It costs cross-tab flexibility — the shared client is glued to one target — which is exactly what the scoped-client exceptions were later added to work around. Changing it (e.g. per-target client pooling) touches the ~150 `evaluate` call sites only through `connection.js`'s exports, so the chokepoint makes a transport redesign cheap relative to its blast radius.

### Scoped private clients for background tabs and screenshots

`withTargetEvaluate`, `_makeScopedClient`, and the `tab.js` opens each attach a short-lived client to a target the shared client does not hold (a background chart, the shell window, or the same chart mid-evaluate). The code documents the trade-off: comments on `withTargetEvaluate` record that TradingView's endpoint transiently closes these fresh sockets when the shared one is busy — "service busy, retry", not a real failure — and the retry/`TV_CDP_BUSY` machinery mitigates rather than removes the contention. This is the design point the current work package's R1 breach (transport-layer bypass) names: the exceptions have become a second, unsanctioned transport layer, and the wedge evidence lives in its retry comments.

### KNOWN_PATHS as verified registry — adopted late, ignored by convention

The registry exists with `verifyAndReturn` so a path is checked at call time and fails with a named error. Only `data.js` imports it; `chart.js`, `stream.js`, `study.js`, `indicators.js` and five more modules define local `CHART_API`/`CWC` constants with the same literals. The inference: the registry landed after those modules were written and no pass consolidated them. What it costs: a TradingView layout change is a scattered, error-prone edit; what it constrains: nothing structurally — the literals are identical, so consolidation is mechanical.

### Shell-window DOM driving for tabs

`tab.js`'s header comment documents the finding outright: CDP-level activation and synthesized accelerators do not drive the Desktop tab bar, so tab ops click the shell window's DOM. This forces `tab.js` to hold its own CDP clients (the shell is a different target from every chart) and explains why tab switching is the one flow that both opens private sockets **and** re-points the shared client (`reconnectTo`) afterwards.

### Health module as operational grab-bag

`health.js` (489 lines) exports `healthCheck`, `discover`, `uiState`, and `launch`, and privately carries `checkForUpdate` (git fetch + SHA compare behind a 1-hour cache) and the MSIX local-copy/kill machinery. The plausible rationale: these are all "is the environment right" operations sharing process-detection helpers. The cost is cohesion: a launch change and a health-report change touch the same file, `checkForUpdate`'s git dependency sits oddly next to page probes, and the module is the second-largest non-Pine core file.

### Unconditional registration, env-gated power tools

Registrars run through `wrapRegistrar`, which skips gated tools unless `TV_ALLOW_DANGEROUS=1` (88 default / 95 gated: `ui_evaluate`, `tv_update`, `tv_launch`, `draw_clear`, `alert_delete` class). Rationale recorded in `capabilities.js`: dangerous capabilities are denied by default and added deliberately. This replaced the pre-2026-08-08 unconditional registration noted in the prior comprehension pass.

### CDP host default 127.0.0.1 with remote opt-in

Comment in `connection.js` documents the reason outright: Electron's debug port binds IPv4 only and some Windows machines resolve `localhost` to `::1` first. `assertLoopbackHost` refuses non-loopback endpoints unless `TV_ALLOW_REMOTE_CDP=1`, because a remote CDP endpoint exposes the authenticated TradingView session.

## Domain Concept Mapping

### Glossary

| Domain term | Technical construct | Description |
|-------------|---------------------|-------------|
| CDP | `connection.js` client | Chrome DevTools Protocol channel into TradingView Desktop (Electron) |
| Chart API | `KNOWN_PATHS.chartApi` | live-probed internal widget API (`_activeChartWidgetWV`) |
| Study / indicator | `core/indicators`, `core/study`, `chart_manage_indicator` | Pine or built-in analytic on the chart; entity IDs are session-specific |
| Pine graphics | `data_get_pine_lines/labels/tables/boxes` | drawings made by custom Pine via line/label/table/box.new |
| Replay | `core/replay.js` | bar-by-bar historical playback for practice trading |
| Shell window | `core/tab.js` `withShell` | the Electron `app/window/index.html` target owning the tab bar |
| Scoped client | `withTargetEvaluate`, `_makeScopedClient` | short-lived private CDP client aimed at one target |
| `TV_CDP_BUSY` | error code from `withTargetEvaluate` | endpoint contention; retryable |
| MSIX local copy | `_copyMsixPackageLocal` (`core/health.js`) | Windows Store installs block the debug port; package copied out of WindowsApps and relaunched |
| Pine facade | `KNOWN_PATHS.pineFacadeApi` | TradingView REST endpoint for server-side compile diagnostics |
| `TV_ALLOW_DANGEROUS` | `capabilities.js` | env gate registering power tools |

### Domain Model

The server is a capability bridge: MCP tool namespace ↔ CDP evaluate ↔ TradingView widget internals. Domains (chart, data, pine, study, tab, capture, drawing, alerts, replay, stream, batch, watchlist, indicators, ui, pane, health) map 1:1 across `tools/`, `core/`, and `cli/commands/`. The transport is stratified in intent — tools → core → connection — with the three scoped-client sites as the standing exceptions that the CDP-architecture work package (R1–R5) targets.

## References

Coverage: full server surface at `4ff5104` (`chore/24-improve-cdp-architecture`); prior pass covered the security-audit-affected modules at 2026-08-08.

| Reference | What it carries |
|-----------|-----------------|
| [Comprehension log — 2026-08-15](../planning/2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server/15-codebase-comprehension.md) | the questions, CDP-transport deep-dive, and open items behind this revision |
| [CDP interface analysis (prior research)](../planning/2026-08-15-tradingview-mcp-cdp-architecture/README.md) | the R1–R5 breach evidence and build order this artifact cross-references |

| Contributing work package | Dates |
|---------------------------|-------|
| 2026-08-08-tradingview-mcp-mitigations | 2026-08-08 |
| 2026-08-15-improve-cdp-architecture-of-tradingview-mcp-server | 2026-08-15 |
