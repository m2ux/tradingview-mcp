# Pine Language Semantics — v5 vs v6 Traps

> The single largest source of "impossible" regressions this session. Each of these changed
> behavior *silently* (no compile error, or only a warning) during the v5→v6 migration.

## 1. UDT field history `[1]` — the headline trap

**Principle.** In Pine, the history-referencing operator `[1]` behaves fundamentally
differently for a `var`-declared UDT than for a flat series variable.

- A flat series `x` builds a per-bar history; `x[1]` is the previous bar's value.
- A `var` UDT `u` is a **single persistent object** mutated in place. `(u[1]).field` does
  **not** give you last bar's `field` series value — it reads the *current* field off the
  previous bar's *object reference*, which is the same object. Net effect: field-level
  `[1]` on a `var` UDT does **not** reproduce per-field series history.
- In v5 `udt.field[1]` was effectively *erroneous*; in v6 it is a **compile error**. Only
  non-`var` UDTs (a fresh object each bar) give well-defined `(u[1]).field` history.

**Anti-pattern (the "mirror-collapse").** Collapsing duplicated low/high code by moving
per-side scalars into a `var` UDT and reading `udt.field[1]` — assuming it preserves `[1]`
semantics. It does not. This produced a clean compile and a silent 3→0 signal regression.

**Fix / rule.** If the original logic relies on `scalar[1]` history, keep state as **flat
global series variables**. Extract *pure functions* that take the previous-bar values as
explicit arguments (`prevX`), and hoist every `[1]` / `ta.*` read to global scope. Do not
move history-read state into `var` UDT fields.

> Empirical probe used: `scripts/udt_hist_probe.pine` (compares standalone-series `[1]`
> against `(varUdt[1]).field` and counts mismatches).

## 2. `bool` three-state `na` removal (v5 → v6)

**Principle.** v5 `bool` could be `na`; in a conditional, `na` behaved as falsy. v6 removed
three-state `bool` — `na` bools are impossible, and historical `na` reads become `false`.

**Consequence.** Logic that depended on "not yet initialized" being `na` (distinct from
`false`) changes timing in early bars. If you must reproduce v5 timing, gate flags
explicitly, e.g. `hist_ok = bar_index >= 1` and `flag := hist_ok and <cond>`.

**Detection.** A regression that appears only in the first few bars, or a mid-series signal
lost because a downstream edge never arms. Note: this was *suspected* but *ruled out* as the
cause of the mid-series loss — see the lazy-eval trap, which was the real culprit.

## 3. Lazy / short-circuit evaluation of `and` / `or` / ternary (v6)

**Principle.** v6 short-circuits boolean operators. If the left side decides the result, the
right side **is not evaluated**.

**Why it bites.** Stateful calls — anything wrapping `ta.*` (e.g. library methods such as
`mint1.no_rzl_fall()`, `mint1.is_rzh_w_fall()`) — maintain internal rolling history. If such
a call sits on the short-circuited side of `and`/`or`/ternary, it is **skipped on some
bars**, corrupting its own history. Result: a *mid-series* signal silently lost. No warning.

**This was the actual root cause** of the v6 3→2 regression, not the `bool na` change.

**Fix / rule (hoist-everything-stateful).** Compute every stateful call **once per bar, in
global scope, before any conditional**, into a plain variable; reference the variable in the
conditional. Never let a `ta.*`-wrapping call appear inside `and`/`or`/ternary.

```pine
// BAD (v6): RHS skipped when LHS false → internal ta.* history corrupts
ok := cond_a and mint1.no_rzl_fall()

// GOOD: hoist
m_no_rzl_fall = mint1.no_rzl_fall()   // every bar, unconditional
ok := cond_a and m_no_rzl_fall
```

## 4. `ta.*` history calls inside conditionals (compiler warns — heed it)

Related to #3 but for **direct** `ta.*` calls (`ta.falling`, `ta.change`, `ta.rising`).
The v6 compiler emits a warning when these appear in a conditional expression. Hoisting them
to globals removed the warnings — but (crucially) **removing the warning did not by itself
restore the lost signal**, because the stateful library methods (#3) were still conditional.
Treat the warning as a *symptom*, not the whole disease.

## 5. Long ternary lines silently truncated on injection

**Anti-pattern.** Passing very long single-line ternaries to `pine_set_source` can truncate
at line boundaries, producing `Mismatched input 'end of line without line continuation'`.
**Rule.** Wrap long ternaries at `?` / `:` boundaries before injection; verify with a compile.

## 6. `shorttitle` length limit (10 chars)

`indicator(..., shorttitle='...')` is capped at 10 characters. `RSIZoneDivUni` (13) fails;
`RSIZSymLo` fits. The `shorttitle` — not the long title — is what identity-guard parameters
(`script_name`) match against.

## 7. v5 → v6 built-in converter is a starting point, not a finish

The converter handles syntax but **not** the semantic traps above (lazy eval, `bool na`,
conditional `ta.*`). Expect to do a manual semantics pass afterward and re-verify against a
frozen baseline. Budget for it.
