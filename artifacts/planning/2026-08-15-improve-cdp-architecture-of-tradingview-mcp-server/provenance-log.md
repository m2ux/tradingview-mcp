# Provenance Log

> Improve CDP Architecture of TradingView MCP Server · #24

## Log

One row per task. Append in order.

| Date | Task ID | Assistant | Model | Prompt Class | Context Scope | Description |
|------|---------|-----------|-------|---------------|---------------|-------------|
| 2026-08-15 | 1 (R2) | claude | moonshotai/kimi-k3 | refactoring | repo-only | KNOWN_PATHS registry sweep — centralize 25 `window.TradingViewApi._*` literals across 10 modules into `KNOWN_PATHS` in `connection.js` (commit 4fa01b6) |
| 2026-08-15 | 2 (R1-listing) | claude | moonshotai/kimi-k3 | refactoring | repo-only | `listTargets()` consolidation — centralize `/json/list` fetches into single `listTargets()` in `connection.js`, update all consumers (commit d8f383d) |
| 2026-08-15 | 3 (R1-pool) | claude | moonshotai/kimi-k3 | refactoring | repo-only | Scoped-client factory + LRU-8 pool — `makeScopedClient`/`acquireScopedClient` with lifecycle-aware eviction, retry/`TV_CDP_BUSY` preserved, `drainScopedPool()` on disconnect (commit a3aaf16) |
| 2026-08-15 | 4 (R3) | claude | moonshotai/kimi-k3 | refactoring | repo-only | Protocol consolidation — create `core/protocol.js` for `Page.*`/`Input.*`/`Emulation.*` CDP calls, update `dom.js`/`capture.js`/`batch.js` consumers (commit 015440a) |
| 2026-08-15 | 5 (R4) | claude | moonshotai/kimi-k3 | refactoring | repo-only | Wait adoption — shared `sleep` helper in `wait.js`, replace 46 non-wait `setTimeout` sites across 13 core modules (commit bfe7cf1) |
| 2026-08-15 | 6 (R5) | claude | moonshotai/kimi-k3 | refactoring | repo-only | Health-module split — `health.js` probes-only, `launch.js` + `update_check.js` extracted, re-export shims preserve CLI paths (commit d23d351) |

## Attestation

- Timestamp: 2026-08-16T05:36:40+01:00
- Certifier: Mike Clay <mike.clay@shielded.io>
- Option: certify
