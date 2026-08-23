# Implementation plan — issue #29

## Acceptance (from the issue)

- `draw_fib_channel({ template, point, point2, point3 })` creates a Fibonacci channel
- Return `{ success, entity_id, template, points }` in the same shape as `draw_shape`
- Unknown template name → `{ success: false }` and **no** `createMultipointShape`
- No silent factory-default fallback
- Always-on (same gate as `draw_shape`, not `draw_clear`)
- Flat `draw_` prefix — do not invent `/area/tool` names

## Non-goals

- Date-window OHLCV / “extremes in range”
- Parallel channel, disjoint channel, or a generic `draw_from_template`
- Extending `draw_shape` with optional `point3` + `template`
- Renaming loci to wave-0/1/2 in the schema (Kennedy 0→2 + parallel-through-1 is a caller convention)

## Design

### 1. `drawFibChannel` in `src/core/drawing.js`

Compose over existing primitives; do not change `drawShape`.

1. `requireFinite` on all six coordinates; refuse empty `template`.
2. `listTemplates({ drawing_type: "fibonacci channel" })` — exact name must appear in `/drawing-templates/LineToolFibChannel/`.
3. `getTemplate({ drawing_type: "fibonacci channel", name })` — reuse `src/core/drawing_templates.js`.
4. `evaluateAsync` (not sync `evaluate`) because `createMultipointShape` is async:
   ```
   api.createMultipointShape(
     [point, point2, point3],
     { shape: "fib_channel", template: content }
   )
   ```
5. Diff `getAllShapes()` before/after (same as `drawShape`) for `entity_id`.

Extend `_resolve` with `evaluateAsync`. Pass `{ evaluateAsync }` into list/get so tests inject one mock.

### 2. Tool + CLI

- `src/tools/drawing.js` — register `draw_fib_channel` with required `template`, `point`, `point2`, `point3`.
- `src/cli/commands/drawing.js` — `tv draw fib-channel --template _Base_T --time … --price … --time2 … --price2 … --time3 … --price3 …`.
- Not added to `GATED_TOOLS`.

### 3. Docs / tool count

89 → 90 default, 96 → 97 with `TV_ALLOW_DANGEROUS=1`:

- `src/server.js` instructions
- `AGENTS.md` / `CLAUDE.md` — “Draw on the chart”
- `docs/tool-registry.md`
- `README.md` drawing table

Document TV click order: baseline `point`→`point2`, offset `point3`.

### 4. Tests (mocked `_deps`)

`tests/draw_fib_channel.test.js`:

- Success: `createMultipointShape` invoked with `shape: "fib_channel"`, three `{time,price}` points, and `template` equal to the fetched content; returns `entity_id` / `template` / `points`.
- Unknown template name: `success: false`, no create call.
- Empty template / non-finite `point3`: refuse without create.
- List-endpoint failure: `success: false`, no create.

Add the file to `package.json` `test` / `test:unit` / `test:all`.
Assert `draw_fib_channel` is registered by default in `tests/server-gating.test.js`.

Live (manual, not CI): pass any saved Fib Channel `template`, `direction` (`bullish` L→H→L / `bearish` H→L→H), and three bar times; `draw_get_properties` returns those resolved points and the template level coeffs.

## Files

| Path | Change |
|------|--------|
| `src/core/drawing.js` | `drawFibChannel` + `evaluateAsync` in `_resolve` |
| `src/tools/drawing.js` | register `draw_fib_channel` |
| `src/cli/commands/drawing.js` | `fib-channel` subcommand |
| `src/server.js` | tool count + one-line guide |
| `AGENTS.md`, `CLAUDE.md` | decision-tree bullet |
| `docs/tool-registry.md` | new tool section |
| `README.md` | drawing table row |
| `tests/draw_fib_channel.test.js` | new |
| `tests/server-gating.test.js` | always-on assertion |
| `package.json` | include new test file |
