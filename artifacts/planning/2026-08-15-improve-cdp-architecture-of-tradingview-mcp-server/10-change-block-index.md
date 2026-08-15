# Change Block Index

> chore/24-improve-cdp-architecture vs main · 23 files · 114 hunks · est. review ~57 minutes (30 sec/change)

## Block Rationale

### [Block 1 — src/connection.js:131](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/connection.js#L131)

Consolidates the CDP `/json/list` HTTP endpoint into a single transport-owned `listTargets()` export (R1). Previously `findChartTarget`, `findTargetById`, `findTargetByRef`, and several functions in `tab.js` each issued their own `fetch` against the same endpoint — four socket-open sites for one logical read. The three connection.js finders now route through the shared helper, so the endpoint's URL and response handling exist in exactly one place.

### [Block 2 — src/connection.js:177](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/connection.js#L177)

Introduces the scoped-client factory with an LRU-8 pool (`makeScopedClient`, `acquireScopedClient`, `drainScopedPool`), the work package's central change (R1). Callers that need a dedicated per-tab CDP connection previously each constructed raw `CDP({...})` clients and closed them ad hoc; concurrent scoped sockets against TradingView's CDP endpoint were observed to wedge it. The pool caps live scoped sockets at eight (tunable via `TV_CDP_POOL_SIZE`), refreshes entries on hit for LRU ordering, and `disconnect()` now drains the pool so no socket outlives the shared client.

### [Block 3 — src/connection.js:275](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/connection.js#L275)

Rewires `withTargetEvaluate` to borrow its per-target client from the pool instead of opening a raw `CDP(...)` per call. This is the adoption half of the pool: the retry loop's connection acquisition is now pooled, so repeated targeted reads against background tabs reuse an existing socket rather than churning connections — the churn that motivated the pool in the first place.

### [Block 4 — src/core/protocol.js:1](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/protocol.js#L1)

New module: the single designated home for raw CDP `Page.*` and `Input.*` domain calls (R3). It exports thin helpers (`captureScreenshot`, `dispatchMouse`, `dispatchKey`, `insertText`) that take a client plus params, so domain modules consume named operations instead of reaching into `client.Page`/`client.Input` directly. Confining the protocol surface to one module makes the CDP-domain footprint greppable and gives future protocol changes one edit site.

### [Block 5 — src/core/launch.js:1](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/launch.js#L1)

New module carrying the TradingView Desktop launch logic extracted from `health.js` (R5): platform-specific executable discovery, the MSIX `WindowsApps` copy-local workaround, detached spawn with early-failure detection, and the CDP readiness poll. The `_resolveLaunchDeps` seam keeps every side effect injectable for tests. `health.js` re-exports `launch`, so existing import paths are unchanged.

### [Block 6 — src/core/update_check.js:1](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/update_check.js#L1)

New module carrying the best-effort git-pull update check extracted from `health.js` (R5). It compares local HEAD against the origin default branch via the GitHub REST API with a one-hour cache, and never throws — any failure (offline, detached HEAD, non-git install) resolves to `null` so the health check can't be broken by the update probe. Re-exported via `health.js` for import-path compatibility.

### [Block 7 — src/core/health.js:1](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/health.js#L1)

Shrinks from 489 lines and three concerns to just the health/discovery probes (`healthCheck`, `discover`, `uiState`), with launch and update-check re-exported from their new modules (R5). The probes also adopt the `KNOWN_PATHS` registry for chart-API path expressions, replacing local literals. Behaviour is preserved: the public surface of the module is identical, only its cohesion changes.

### [Block 8 — src/wait.js:6](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/wait.js#L6)

Adds the shared `sleep(ms)` helper to the wait module (R4). The codebase carried dozens of local `setTimeout`-promise one-liners under various names (`delay`, `sleep`, inline); centralising the primitive in the module that already owns wait semantics gives every unconditional delay one canonical spelling, and the doc comment steers callers toward condition-based polling when a nameable condition exists.

### [Block 9 — src/core/dom.js:16](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/dom.js#L16)

Adopts the protocol module for trusted input dispatch (R3) and the shared `sleep` (R4). `clickAt`'s move/press/release sequences and `pressKey`'s keyDown/keyUp pairs now go through `dispatchMouse`/`dispatchKey` rather than calling `c.Input.dispatchMouseEvent`/`dispatchKeyEvent` inline, and the local `sleep` definition is deleted in favour of the wait.js import.

### [Block 10 — src/core/capture.js:4](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/capture.js#L4)

Drops the module's private scoped-client factory (a raw `CDP({...})` plus `Page.enable()`) in favour of the pooled `makeScopedClient` from connection.js (R1), and routes the actual screenshot through `protocol.js`'s `captureScreenshot` helper (R3). The `_deps.makeScopedClient` injection seam is preserved so existing tests substituting a stub CDP connection keep working unchanged.

### [Block 11 — src/core/tab.js:12](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/tab.js#L12)

Removes the module's direct `chrome-remote-interface` import and all four of its `/json/list` fetches, routing target enumeration through `listTargets()` and per-target connections through the pooled `makeScopedClient` (R1). Inline `setTimeout` delays become `sleep(...)` (R4). This file was the largest second source of raw CDP socket opens after connection.js, so its conversion is where the socket-open count reduction mostly lands.

### [Block 12 — src/core/ui.js:380](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/ui.js#L380)

Adopts the shared `sleep` for UI-settle delays (R4) and routes `mouseClick`'s coordinate dispatch through the protocol helpers (R3). No behavioural change — the same events in the same order, one import site fewer for raw `Input.*` calls.

### [Block 13 — src/core/batch.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/batch.js#L5)

Adopts the shared `sleep` for the inter-symbol delay in the batch loop (R4) and the `KNOWN_PATHS` registry import (R2). The batch runner's pacing behaviour is unchanged.

### [Block 14 — src/core/chart.js:4](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/chart.js#L4)

Registry adoption (R2): chart-API path expressions now interpolate `KNOWN_PATHS` entries instead of embedding `window.TradingViewApi...` literals, and local delays use the shared `sleep` (R4). Five small hunks, all mechanical substitutions.

### [Block 15 — src/core/data.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/data.js#L5)

Registry adoption (R2) across the graphics-collection builders and study-value readers, plus shared `sleep` (R4). The Pine graphics path strings (`_graphics._primitivesCollection...`) and chart-API roots now come from `KNOWN_PATHS`, so a TradingView internals change touches one registry entry rather than five call sites in this file.

### [Block 16 — src/core/indicators.js:4](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/indicators.js#L4)

Replaces the local `CHART_API` literal with `KNOWN_PATHS.chartApi` (R2) and the local `delay` helper with the shared `sleep` (R4). The dialog polling loops (open, type-query settle, close) keep their existing intervals and retry counts.

### [Block 17 — src/core/pine.js:8](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/pine.js#L8)

Registry and sleep adoption (R2, R4) across the Pine editor workflows — compile, save, smart-compile, add-to-chart, copy, and publish paths. Fifteen hunks of mechanical substitution; none of the editor state-machine logic or save-verification behaviour changes.

### [Block 18 — src/core/pine_ui.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/pine_ui.js#L5)

Registry and sleep adoption (R2, R4) across the Pine open-dialog UI walks, plus removal of the now-dead `PINE_FACADE` constant and a stale trailing snippet in `getEditorBufferInfo` (lean-coding pass). Eighteen hunks; the dialog scraping selectors and flows are untouched.

### [Block 19 — src/core/alerts.js:9](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/alerts.js#L9)

Two-hunk registry and sleep adoption (R2, R4) in alert creation. Behaviour identical.

### [Block 20 — src/core/drawing.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/drawing.js#L5)

Single-hunk import change: picks up `KNOWN_PATHS` (and re-orders imports) for registry adoption (R2). Behaviour identical.

### [Block 21 — src/core/pane.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/pane.js#L5)

Registry and sleep adoption (R2, R4) in pane layout/focus/symbol operations. Five hunks, all mechanical.

### [Block 22 — src/core/replay.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/replay.js#L5)

Import-side registry adoption (R2) for the replay API path in `start`/`step`. Three hunks; replay control flow unchanged.

### [Block 23 — src/core/stream.js:5](https://github.com/m2ux/tradingview-mcp/blob/9e9a3f59199ca39616d3d8561d9335af4ad71b40/src/core/stream.js#L5)

Replaces the local `CHART_API` and `_chartWidgetCollection` literals with `KNOWN_PATHS` entries (R2) and deletes the local `sleep` in favour of the wait.js import (R4). The poll/dedupe streaming loop is unchanged.
