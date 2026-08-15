# Code Review — CDP Architecture Improvement (PR #25)

## Lean-Coding Audit

Over-engineering scan of the 6-commit refactor (4fa01b6..d23d351) against the ponytail taxonomy. Correctness, security, and performance are out of scope (safety floor). One line per finding: tag, location, simpler alternative, line saving.

- **delete** — `src/connection.js:206-214` — `closed: new Promise((resolve) => { /* empty executor */ })` on pool entries: a promise that can never resolve, plus a 3-line comment explaining that nothing resolves it. No consumer reads `entry.closed`. Drop the field and its comment. ~8 lines.
- **delete** — `src/connection.js:241-251` — `releaseScopedClient` is a self-described "no-op placeholder for symmetry" whose body either returns early or evicts an entry its only caller (`acquireScopedClient`) has already deleted. No other call site exists. Delete the export and its 4-line docblock. ~11 lines.
- **delete** — `src/connection.js:222-224` — docblock narrates behaviour the code does not have ("the pool tracks each client's `closed` promise and evicts it automatically when the socket drops"). The code below it does no lifecycle tracking; the comment contradicts the construct it annotates. Delete the sentence (or implement the tracking — but the lazy choice is to stop claiming it). ~3 lines.
- **delete** — `src/core/capture.js:86-87` — `const _makeScopedClient = makeScopedClient;` alias plus 3-line comment, kept only so `_deps.makeScopedClient` injection reads a local name. `_deps` already defaults through `deps?.makeScopedClient || makeScopedClient` at the use site; alias the import at the two call sites instead. ~5 lines.
- **shrink** — `src/core/protocol.js:3` — header advertises `Emulation.*` as confined here; no Emulation helper exists and no module calls `Emulation.*`. Cut the header claim to the Page.*/Input.* helpers actually exported. ~1 line.
- **delete** — `src/core/stream.js:56` — stray 2-space over-indent on `process.removeListener('SIGTERM', cleanup);` introduced by the sleep-adoption sweep (bfe7cf1). Re-align with the line above. 0 lines (whitespace).

**Comment proportionality:** no comment/doc block whose bulk dwarfs its code was found; the module headers on launch.js, update_check.js, health.js and the listTargets/withTargetEvaluate docblocks are short why-notes proportional to the code beneath them.

**Not findings (checked and cleared):** `KNOWN_PATHS` registry (R2) replaces a repeated literal with one registry — net neutral lines, removes a drift class; LRU-8 pool and `listTargets()` consolidation (R1) are the issue's explicit asks; `dispatchMouse(c, ...events)` variadic collapses two 3-event sequences in dom.js/ui.js; health split (R5) is a pure move with no new abstraction; `sleep` shared helper (R4) deletes four local copies.

net: -28 lines

### Re-score after apply (commit 9e9a3f5)

The accepted simplifications were applied in 9e9a3f5 and re-scanned against the taxonomy. All six findings are resolved: the dead `closed` promise and its contradictory lifecycle docblock are gone, the no-op `releaseScopedClient` is removed, the capture.js alias is inlined to the imported factory (test seam `_deps.makeScopedClient` retained), the protocol.js header now names only the Page.*/Input.* helpers actually exported, and the stream.js SIGTERM indent is re-aligned. No new over-engineering was introduced by the apply. Behaviour is identical; the unit baseline is unchanged (the named pre-existing `findElement() — css strategy validation` failure is identical before and after).

Lean already. Ship.
