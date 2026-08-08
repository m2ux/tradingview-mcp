# tradingview-mcp — Comprehension Artifact

> 2026-08-08 · work packages: [2026-08-08-tradingview-mcp-mitigations](../planning/2026-08-08-tradingview-mcp-mitigations/README.md) · coverage: full server surface with depth on the security-audit-affected modules (server, connection, update, health/launch, ui, pine, _format, CI) · related: none

## Architecture Overview

### Project Structure

ESM Node package (`"type": "module"`), entry `src/server.js` (MCP stdio server), CLI at `src/cli/` (`tv` bin), no build step — plain JavaScript, `node --test` for tests, eslint flat config. Dependencies are minimal: `@modelcontextprotocol/sdk` and `chrome-remote-interface` only; `zod` appears in tool registrars (transitive via the MCP SDK).

```
src/
  server.js        MCP server: instructions + 14 registrar calls, stdio transport
  connection.js    CDP client singleton, KNOWN_PATHS, safeString/requireFinite, evaluate()
  wait.js          shared wait/poll helpers
  tools/*.js       14 registrars — thin zod-validated wrappers returning jsonResult()
  core/*.js        domain logic per area; core/index.js re-exports 12 namespaces as public API
  cli/             command router + one module per area (mirrors tools/)
tests/             node --test: unit (sanitization, update, launch, cli, pine_analyze, replay,
                   chart_*) + e2e (needs live TradingView Desktop + CDP)
agents/            one Claude agent (performance-analyst)
skills/            chart-analysis, multi-symbol-scan, pine-develop, replay-practice, strategy-report
.github/workflows/ci.yml
```

### Module Map

| Module | Responsibility | Depends on |
|--------|---------------|------------|
| `server.js` | MCP server construction, instructions, registrar wiring | tools/* |
| `connection.js` | CDP client lifecycle, target discovery (`/json/list`), `evaluate()`/`evaluateAsync()`, `KNOWN_PATHS` verified TradingView API paths, input sanitizers (`safeString`, `requireFinite`) | chrome-remote-interface |
| `tools/_format.js` | `jsonResult()` — the single MCP response shape | — |
| `tools/*.js` | zod schemas + error-wrapped delegation to core | core/*, _format |
| `core/health.js` | health check, discovery, cross-platform TradingView launch (incl. MSIX local-copy fallback), process kill | connection, child_process |
| `core/update.js` | self-update: `git fetch origin main` + `merge --ff-only` + conditional `npm ci` (dependency-injected execSync/existsSync for tests) | child_process |
| `core/ui.js` | DOM automation — click/hover/keyboard/type/scroll/findElement/layouts; string-built JS evaluated in page | connection |
| `core/pine.js` | Pine editor automation + `check()` posting source to `pine-facade.tradingview.com` as Guest | connection, fetch |
| `core/{chart,data,capture,drawing,alerts,batch,replay,indicators,watchlist,pane,tab}.js` | chart read/write domains | connection |

### Design Patterns

- **Bridge/Adapter**: MCP tools are thin zod adapters over core domain functions; the same core is reused by the CLI and exported as `tradingview-mcp/core`.
- **Singleton connection**: one cached CDP client with liveness re-check and exponential-backoff reconnect (5 attempts, 500ms base, 30s cap).
- **Direct-path probing**: `KNOWN_PATHS` pins internal TradingView widget APIs (`window.TradingViewApi._activeChartWidgetWV`, `_replayApi`, `_alertService`, …) verified at call time via `verifyAndReturn`.
- **Dependency injection for tests**: `core/update.js` (`_deps`) and launch internals accept injected `execSync`/`existsSync`/`spawn` so unit tests run without git/processes.
- **Evaluate-everything**: nearly all chart interaction funnels through `connection.evaluate()` — one chokepoint for page-context execution.

## Key Abstractions

### Core Types

- MCP tool result: `{ content: [{ type: 'text', text: JSON.stringify(...) }], isError? }` via `jsonResult()`.
- `KNOWN_PATHS` — string map of live-probed TradingView API paths (chartApi, chartWidgetCollection, bottomWidgetBar, replayApi, alertService, layoutManager, symbolSearchApi, pineFacadeApi).
- CDP `client` / `targetInfo` module-level singletons.

### Data Model / State Management

State lives in the TradingView page (chart widget model, studies, drawings, alerts); the server holds almost no domain state — only the CDP client singleton and target info. Data flows: tool args → zod validation → core builds a JS expression (using `safeString`/`requireFinite` for interpolation) → `Runtime.evaluate` in page → JSON result back.

### Error Handling

Tool layer: try/catch → `jsonResult({ success: false, error }, true)`. Core: thrown Errors with actionable messages (e.g. "No TradingView chart target found. Is TradingView open with a chart?"). `evaluate()` unwraps `exceptionDetails` into `JS evaluation error: …`. Update path is fail-safe: every guard returns before any mutation.

## Design Rationale

### Unconditional tool registration (server.js)
- **Observation**: all 14 registrars run unconditionally; no trust tiering between read tools and power tools (`ui_evaluate`, `tv_update`, `tv_launch`, `draw_clear`, `alert_delete`).
- **Hypothesized rationale**: maximize capability out-of-the-box; the tool selection guide in server instructions substitutes for access control.
- **Trade-offs**: optimizes capability and simplicity; sacrifices any security boundary — an agent driven by injected chart text can invoke the most powerful tools.
- **Implications for changes**: a `DANGEROUS_TOOLS` gate can be added per-registrar or centrally at registration with no structural change; the single `server.tool` funnel makes per-name filtering cheap.

### Self-update via git fast-forward (core/update.js)
- **Observation**: fetch + `--ff-only` merge of `origin/main`, `npm ci` when the lockfile changed; guards for non-git, dirty tree, non-main, diverged history; no origin-URL allowlist, no tag/SHA pinning, no token gate; `npm ci` failure leaves updated code with a warning.
- **Hypothesized rationale**: convenience for non-technical installs; `--ff-only` + guards chosen as "safe by design".
- **Trade-offs**: optimizes zero-effort updates; sacrifices supply-chain control — whatever lands on the mutable `origin/main` runs after restart, and the tool is agent-reachable.
- **Implications**: hardening points are isolated inside `update()`; `_deps` injection means new guards are unit-testable.

### Launch with default kill (core/health.js)
- **Observation**: `tv_launch` defaults `kill_existing` true (tool description: "default true"); kill via `taskkill /F /IM TradingView.exe` / `pkill -f TradingView` (substring match), used both pre-launch and in the MSIX fallback path.
- **Hypothesized rationale**: the most common failure is a running instance without the debug port; killing it makes launch "just work".
- **Trade-offs**: optimizes first-run success; sacrifices safety — broad `pkill -f` can terminate unrelated matching processes and discards the user's live session state.
- **Implications**: default flip + exact-path matching is localized to `killExisting`/`launch`.

### String-built CSS selectors (core/ui.js)
- **Observation**: attribute selectors built by concatenation with only `"` escaped (`value.replace(/"/g, '\\"')`); `ui_find_element` with `strategy=css` passes the query to `querySelectorAll`.
- **Hypothesized rationale**: minimal escaping covered the observed inputs.
- **Trade-offs**: simplicity vs correctness — a `]` or `\` in a value breaks or mis-selects.
- **Implications**: a `cssEscapeAttr()`/`CSS.escape()` helper touches few call sites (click, hover, findElement).

### Unfenced tool output (tools/_format.js)
- **Observation**: `jsonResult` JSON-serializes results verbatim; chart text (Pine labels/tables/boxes, console, strategy results, UI labels) returns to the agent indistinguishable from instructions. Server instructions say how to pick tools, nothing about untrusted content.
- **Hypothesized rationale**: output was treated as trusted because it originates from "the user's own chart".
- **Trade-offs**: zero overhead vs indirect-prompt-injection exposure — the core audit theme.
- **Implications**: `jsonResult` is the single funnel — a `wrapUntrusted(content, origin)` helper here reaches every tool; per-tool opt-in decides which outputs are chart-derived.

### pine_check upload (core/pine.js)
- **Observation**: `check({ source })` POSTs full Pine source to `https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=0000…` with a browser Referer header.
- **Implications**: off-machine data flow; gating behind `TV_ALLOW_PINE_CHECK_UPLOAD` is one guard at function entry.

### CDP host configurability (connection.js)
- **Observation**: `TV_CDP_HOST`/`CDP_HOST` can point off-loopback; the default `127.0.0.1` (not `localhost`) is deliberate — Electron's debug port binds IPv4 only and some Windows machines resolve localhost to ::1 first.
- **Implications**: remote-CDP guard is a startup check in this module; the IPv4 default must be preserved.

## Data Flow and Operational Context

### Data Flow Map

- Tool call: agent JSON args → zod schema (tools/*.js) → core function → JS expression string → `connection.evaluate()` → CDP `Runtime.evaluate` in TradingView page → JSON back through the same funnel.
- `tv_update`: agent call → `update()` → `git`/`npm` child processes in repo root → result JSON; running process keeps old code until restart (explicit `restart_required: true`).
- `pine_check`: source string → `URLSearchParams` → HTTPS POST to TradingView pine-facade → diagnostics JSON.
- Chart text out: page primitives (lines/labels/tables/boxes) → core data/pine readers → `jsonResult` → agent context — **unfenced today**.

### Invariant Alignment

| Invariant | Producer Enforces? | Consumer Assumes? | Gap? |
|-----------|-------------------|-------------------|------|
| Interpolated strings are safe JS literals | `safeString` (JSON.stringify) where used | core expression builders | Partial — selector builders in `core/ui.js` escape only `"` |
| Update target is trustworthy code | none (mutable origin/main) | user trusts fetched code | Gap — no allowlist/pin/token |
| Chart-originated text is data, not instructions | none | agent treats output as data | Gap — no fencing or instruction |
| Killed process is the TradingView binary | none (`pkill -f` substring) | launch assumes only TV killed | Gap — substring match |

### Execution Context

Single Node process on stdio; synchronous-ish tool handling; child processes only in health/update. Failure consequences: tool error returns to agent (`isError: true`) — no process-level crash paths observed except launch spawn handling.

### Operational Scenarios

| Scenario | Effect on This Code Path | Risk |
|----------|--------------------------|------|
| TradingView not running / no CDP | connect retries 5× with backoff, then actionable error | low |
| Tab switch | `reconnectTo(targetId)` re-attaches client | low |
| Update with dirty tree / wrong branch | guarded refusal before mutation | low |
| Update with `npm ci` failure | code updated, deps stale, warning returned | medium — running restart loads mismatched deps |
| MSIX install blocks CDP port | fallback copies package locally (~330MB one-time) and relaunches | medium — copy not hash-verified |

## Domain Concept Mapping

### Glossary

| Domain Term | Technical Construct | Description |
|-------------|---------------------|-------------|
| CDP | `connection.js` client | Chrome DevTools Protocol channel into TradingView Desktop (Electron) |
| Chart API | `KNOWN_PATHS.chartApi` | Live-probed internal TradingView widget API (`_activeChartWidgetWV`) |
| Study / indicator | core/indicators, chart_manage_indicator | Pine or built-in analytic on the chart; entity IDs are session-specific |
| Pine graphics | data_get_pine_lines/labels/tables/boxes | Drawings made by custom Pine via line/label/table/box.new — invisible to normal OHLCV reads |
| Replay | core/replay.js | Bar-by-bar historical playback for practice trading |
| MSIX local copy | `_copyMsixPackageLocal` (core/health.js) | Windows Store installs block the debug port; package is copied out of WindowsApps and relaunched |
| Pine facade | `KNOWN_PATHS.pineFacadeApi` | TradingView's REST endpoint used by `pine_check` for server-side compile diagnostics |

### Domain Model

The server is a capability bridge: MCP tool namespace ↔ CDP evaluate ↔ TradingView widget internals. Domains (chart, data, pine, drawing, alerts, replay, capture, batch, watchlist, indicators, ui, pane, tab, health) map 1:1 across tools/, core/, and cli/commands/.

## Open Questions

| # | Question | Status | Resolution | Deep-Dive Section |
|---|----------|--------|------------|-------------------|
| 1 | Which tool outputs are chart-derived and need fencing (pine lines/labels/tables/boxes, console, strategy results, tv_ui_state, ui_find_element — anything else)? | Resolved | Enumerated against mitigation plan §3: those plus `ui_find_element`; batch_run aggregates already-fenced reads | Deep-Dive: Security Surface — 2026-08-08 |
| 2 | Does any registrar rely on side effects that a DANGEROUS_TOOLS skip would break? | Resolved | Registrars are independent `server.tool` calls; skipping registers nothing else | Deep-Dive: Security Surface — 2026-08-08 |
| 3 | Is `npm ci --no-audit` in update() the only dependency mutation path reachable from a tool? | Resolved | Yes — `tv_update` is the only tool invoking package installs | Deep-Dive: Security Surface — 2026-08-08 |
| 4 | Where exactly do the MSIX copy and kill paths interleave? | Resolved | `_copyMsixPackageLocal` runs after early-failure/CDP-timeout, then `killExisting()` before respawn (health.js:367-380) | Deep-Dive: Security Surface — 2026-08-08 |
| 5 | Do skills push agents to act on compile errors without confirmation (audit claim re pine-develop)? | Resolved | `skills/pine-develop/SKILL.md` is an inner dev loop ("fix errors, repeat until 0 errors", "always compile after every change") — agent-initiated edits, not execution of error-text instructions; no change strictly required, optional hardening note tracked | Deep-Dive: Security Surface — 2026-08-08 |

### Remaining follow-up items (out of scope)

- Windows MSIX local-copy hash verification design (needs a Windows test environment).
- Whether `tv_launch` itself belongs in DANGEROUS_TOOLS (depends on DP-3 stakeholder decision).

## Deep-Dive Sections

### Security Surface — 2026-08-08

Traced the four audit-critical flows end-to-end:

1. **Tool registration** (`server.js:73-86`): 14 registrars, unconditional. No central tool list exists; gating must be a name-set check either inside each registrar or wrapped around `server.tool`. `tools/ui.js:88` registers `ui_evaluate`; `tools/health.js:30` registers `tv_update`; both are one-line removals/gates.
2. **Update path** (`core/update.js:23-104`): guards before mutation are genuine (non-git, branch, dirty, ahead-check); the trust gap is *what* is fetched — `git fetch origin main` with no remote-URL verification, mutable-branch follow, and no authorization token. `npm ci` failure is warn-not-fail (`depsWarning`), leaving code/deps skew. `_deps` injection makes every new guard unit-testable; `tests/update.test.js` already exists.
3. **Launch/kill** (`core/health.js:352-360`): `killExisting` is invoked pre-launch when `killFirst` and unconditionally in the MSIX fallback (`health.js:376`); `pkill -f TradingView` matches any process whose command line contains the substring.
4. **Untrusted output** (`tools/_format.js`): single `jsonResult` funnel; fencing helper here covers all 84 tools, with per-call-site opt-in for chart-derived payloads (data.js pine readers, pine console/errors, strategy results, tv_ui_state, ui_find_element).
5. **Agent/skill surface**: `agents/performance-analyst.md` grants `tools: "*"` — includes `ui_evaluate`/`tv_update`/`alert_delete`/`draw_clear`/`pine_set_source`; least-privilege read list is a one-file change.
6. **CI** (`.github/workflows/ci.yml`): `ubuntu-latest`, `node-version: [20.x, 22.x]`, `actions/checkout@v4` / `actions/setup-node@v4` mutable tags, `npm audit --audit-level=high` with `continue-on-error: true`, no `permissions:` block — all findings confirmed verbatim.

Edge cases noted: `kill_existing` default is declared in the *tool description* ("default true") while the zod schema leaves it optional — flipping the default touches both; the MSIX fallback kills even when the caller passed `kill_existing: false`.
