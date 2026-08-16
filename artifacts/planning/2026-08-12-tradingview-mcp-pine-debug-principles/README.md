# Pine Script / TradingView-MCP Debugging — Principles & Anti-Patterns

> Session-notes work package · tradingview-mcp · 2026-08-12 · **Status:** Draft (source for a future agent skill)

## Purpose

These notes distill the **principles** and **anti-patterns** discovered while debugging and
refactoring the `RSIZoneDiv` Pine indicator across a v5→v6 migration, a failed UDT
mirror-collapse, a behavior-preserving unification, and a fully-symmetric variant — all
driven through the TradingView-MCP tool surface against a live chart.

They are written to be compiled into an **agent skill** that guides future agents running
long, stateful Pine/MCP debugging sessions without burning tokens on avoidable dead ends.

## Audience & scope

- **Agent** driving TradingView Desktop via the `user-tradingview` MCP server (CDP :9222).
- Workflows: edit Pine → save → render → capture → diff vs a frozen baseline.
- Not a Pine language tutorial; assumes working Pine and MCP fluency. Focus is *process*.

## The two axes that decide everything

Most mistakes in this session came from confusing two independent axes. Name them up front
in any session:

1. **Regression-preserving vs behavior-normalizing.**
   - *Regression-preserving* = byte-for-byte same signals; you may not "fix" asymmetries or
     quirks, only collapse duplication. Requires a frozen green baseline and a diff harness.
   - *Behavior-normalizing* = you are deliberately changing behavior (e.g. unifying the
     high/low side onto one structure). The baseline becomes a *measurement*, not a gate.
   - **Anti-pattern:** silently drifting from one to the other mid-task. Decide explicitly,
     in writing, before editing.

2. **DOM-driving vs headless tooling.**
   - *DOM* tools scrape dialogs/buttons (`pine_copy`, `pine_save_as`, `pine_add_to_chart`,
     old `pine_save`). Fragile: modal dialogs swallow keystrokes, selectors move, editor
     buffer↔identity can be unbound.
   - *Headless* tools hit the chart model / facade REST (`study_add`, `study_add_pine`,
     `study_remove`, `entity_id` selectors, `pine_bind`, buffer-aware `pine_save`).
   - **Principle:** prefer headless for every step that has one; reach for DOM only when no
     headless path exists (and file/track that gap).

## File index

| File | Contents |
|------|----------|
| `01-pine-language-semantics.md` | v5 vs v6 traps: UDT history, `bool na`, lazy eval, `ta.*` in conditionals |
| `02-debug-loop-and-baselines.md` | Reference capture, entity_id targeting, regression diffing, deterministic loop |
| `03-mcp-tooling-headless-vs-dom.md` | Tool selection, failure signatures, the unbound-editor trap, save/register gap |
| `04-refactoring-playbook.md` | Minimal-change sequencing, mirror-collapse limits, side-parameterization, symmetry |
| `05-anti-pattern-catalog.md` | Quick-scan list of every anti-pattern with its detection signature and fix |
| `data/` | Frozen reference captures (UKOIL 30m SymLo baseline; UKOIL 5m three-way SymLo/SymHi discrimination) — the evidence behind `02` §7, `04` §6, `05` P7/P8 |
| `06-optimization-plan-and-progress.md` | **Resumption doc** — the RSIZoneDiv optimization plan, progress, artifact locations, and next steps. Start here when resuming in a new chat. |
| `07-library-generic-refactor-plan.md` | Library-generic engine refactor — Steps 1–5 gated; published pin `RSIZoneDivEng/2` |
| `sources/` | Application Pine for that refactor (`RSIZoneDivEng` + generic shell). Not MCP server code. |

## How to use

- Before editing Pine under MCP, read `01` and `04`.
- Before trusting any capture/diff, read `02`.
- When a write/mutation tool misbehaves, read `03` and match the failure signature.
- When a session "feels stuck," scan `05` for the matching anti-pattern.
