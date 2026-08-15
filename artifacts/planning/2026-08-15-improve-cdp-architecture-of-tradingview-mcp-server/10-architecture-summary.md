# Architecture Summary

> architecture-summary · Improve CDP Architecture of TradingView MCP Server · #24 Improve CDP architecture · 2026-08-15 · post-implementation review

## Executive Summary

The TradingView MCP server drives a live TradingView Desktop chart through one private channel (the Chrome DevTools Protocol). Over time that channel sprouted ad-hoc side-connections, hand-copied internal addresses in about a dozen files, scattered low-level remote-control calls, and one over-crowded file mixing unrelated jobs. This work restores the channel's intended layered structure — one registry for internal addresses, one managed point that hands out short-lived connections safely, one module for low-level protocol calls, shared wait helpers, and a split of the over-crowded file — so the 88 tools stay dependable and cheap to extend, and working several chart tabs at once no longer wedges the connection.

## System Context

The server is a Node MCP bridge: an AI assistant calls its tools, the tools drive TradingView Desktop (an Electron app) over CDP on `127.0.0.1:9222`, and TradingView Desktop renders the user's charts.

```mermaid
---
title: System Context - CDP Architecture Improvement
---
flowchart LR
    AI([🤖 AI Assistant / MCP client])

    Server[TradingView MCP Server<br/>88 tools · Node]
    TV[(TradingView Desktop<br/>Electron + CDP :9222)]

    AI -->|MCP tool calls| Server
    Server -->|Chrome DevTools Protocol| TV

    style Server fill:#e1f5fe,stroke:#01579b
    style TV fill:#f5f5f5,stroke:#9e9e9e
```

## Package Structure

The change reinforces a one-directional, acyclic layered stack and adds two new modules (highlighted). Domain modules no longer open their own raw connections or issue raw protocol calls; both are confined to the transport and protocol layers.

```mermaid
---
title: Package Diagram - Layered CDP Stack
---
flowchart TB
    subgraph Server [TradingView MCP Server]
        subgraph Tools [Tools layer · zod-validated MCP registrars]
            T[tools/*.js]
        end

        subgraph Domain [Domain layer · core/*.js]
            D[dom · ui · capture · tab<br/>chart · data · pine · batch …]
        end

        subgraph Protocol [Protocol layer · NEW]
            P[core/protocol.js<br/>Page.* / Input.* helpers]
        end

        subgraph Transport [Transport layer]
            C[connection.js<br/>client lifecycle · KNOWN_PATHS registry<br/>scoped-client pool · listTargets]
        end

        subgraph Health [Health · SPLIT]
            H[core/health.js probes]
            L[core/launch.js · NEW]
            U[core/update_check.js · NEW]
        end
    end

    Vendor[[chrome-remote-interface]]

    Tools --> Domain
    Domain --> Protocol
    Domain --> Transport
    Protocol --> Transport
    Health --> Transport
    Transport --> Vendor

    style Server fill:#fafafa,stroke:#424242
    style Tools fill:#e3f2fd,stroke:#1976d2
    style Domain fill:#e3f2fd,stroke:#1976d2
    style Protocol fill:#c8e6c9,stroke:#2e7d32
    style Transport fill:#fff3e0,stroke:#ef6c00
    style Health fill:#c8e6c9,stroke:#2e7d32
```

## Key Flows

The central change is how a tool reads a background chart tab. Before, each such read opened a raw CDP socket and closed it ad hoc; concurrent sockets wedged TradingView's endpoint. Now a bounded LRU pool hands out and reuses short-lived connections.

```mermaid
---
title: Sequence - Targeted read via the scoped-client pool
---
sequenceDiagram
    actor AI as AI Assistant
    participant Tool as MCP Tool
    participant Conn as connection.js (transport)
    participant Pool as Scoped-client pool (LRU-8)
    participant TV as TradingView CDP

    AI->>Tool: read chart tab (target)
    Tool->>Conn: withTargetEvaluate(ref, fn)
    Conn->>Pool: makeScopedClient(target)
    alt cache hit (live socket)
        Pool-->>Conn: reuse client (LRU refresh)
    else miss / stale
        Pool->>TV: open CDP socket
        Pool->>Pool: evict oldest if over bound
        Pool-->>Conn: new client
    end
    Conn->>TV: Runtime.evaluate(expression)
    TV-->>Conn: result
    Conn->>Pool: evict + close (finally)
    Conn-->>Tool: value
    Tool-->>AI: result
```

## What Changed

### Components Added/Modified

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `connection.js` scoped-client pool | Added | Bounded LRU-8 pool handing out short-lived per-tab CDP connections; the multi-tab wedge fix |
| `connection.js` `listTargets()` | Added | Single transport-owned read of the CDP `/json/list` endpoint |
| `core/protocol.js` | Added | Single home for raw `Page.*`/`Input.*` CDP domain calls |
| `core/launch.js` | Added | TradingView Desktop launch logic, extracted from health.js |
| `core/update_check.js` | Added | Best-effort update check, extracted from health.js |
| `core/health.js` | Modified | Reduced to health/discovery probes; launch and update-check re-exported |
| `KNOWN_PATHS` registry adoption | Modified | ~13 files now read internal addresses from one registry |
| `wait.js` `sleep` | Modified | Shared delay helper replacing scattered local one-liners |

### Key Changes

- **One registry for internal addresses:** a TradingView internals change is now a one-line edit instead of a hunt through ~13 files.
- **One managed connection point:** short-lived per-tab connections are pooled and reused within a bound, removing the connection wedges seen on 2026-08-14.
- **One protocol module:** low-level remote-control calls live in a single greppable place with one edit site for future protocol changes.
- **Shared wait helpers and a split health module:** stray fixed delays use one canonical helper, and the over-crowded health file is split into three focused modules.

## Before & After

### Before

```mermaid
---
title: "Before: scattered side-channels and duplicated addresses"
---
flowchart LR
    Tool[MCP Tool]
    Domain[core/*.js<br/>each opens own raw CDP socket<br/>hand-copied addresses in ~13 files]
    TV[(TradingView CDP)]

    Tool --> Domain
    Domain -->|many ad-hoc sockets| TV

    style Domain fill:#f5f5f5,stroke:#9e9e9e
    style TV fill:#f5f5f5,stroke:#9e9e9e
```

### After

```mermaid
---
title: "After: layered stack with pooled connections and one registry"
---
flowchart LR
    Tool[MCP Tool]
    Domain[core/*.js]
    Protocol[core/protocol.js]
    Conn[connection.js<br/>pool + registry]
    TV[(TradingView CDP)]

    Tool --> Domain
    Domain --> Protocol
    Domain --> Conn
    Protocol --> Conn
    Conn -->|bounded pooled sockets| TV

    style Domain fill:#f5f5f5,stroke:#9e9e9e
    style Protocol fill:#c8e6c9,stroke:#2e7d32
    style Conn fill:#fff3e0,stroke:#ef6c00
    style TV fill:#f5f5f5,stroke:#9e9e9e
```

## Impact

### Who Is Affected

| Stakeholder | Impact | Notes |
|-------------|--------|-------|
| Users of the 88 tools | Medium | No behaviour change; multi-tab work no longer wedges the connection |
| Maintainers | High | Internal-address changes are one-line edits; new manager surfaces are a registry entry plus a factory call |
| Operators | Low | Pool size tunable via `TV_CDP_POOL_SIZE`; loopback-CDP security invariant retained |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Pool eviction/liveness regression reintroduces the wedge | Low | Medium | Pool state transitions lack a direct unit test (flagged in review); add `tests/scoped_pool.test.js` before relying on the bound |

## Future Considerations

Push-notification and new-tool directions (market-mover lists, richer backtesting, account operations, alert notifications) are deliberately out of scope and recorded as follow-ups on this cleaned base.

## Related Documents

- [Work package plan](06-work-package-plan.md)
- [Design philosophy](02-design-philosophy.md)
- [Code review report](10-code-review.md) · [Test suite review](10-test-suite-review.md)
