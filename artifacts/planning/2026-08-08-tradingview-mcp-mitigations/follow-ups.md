# Follow-Ups

> TradingView MCP Security Mitigations · #none (repo issues disabled) · updated 2026-08-08

| ID | Surfaced at | Item | Owner / next step | Status |
|----|-------------|------|-------------------|--------|
| F-1 | strategic-review | `CSS.escape()`/`cssEscapeAttr()` for user-derived selector values (requirements in-scope #6; `ui_find_element` css-strategy guard PR1-TC-18 is a negative blacklist; whitelist escaping not implemented) | Agent + human decision at review-findings gate — fix in-place or defer to [deferred-items.md](deferred-items.md) | open |
| F-2 | strategic-review | `package.json` `test` / `test:unit` / `test:all` / `test:cli` scripts omit `tests/capabilities.test.js`, `tests/fencing.test.js`, `tests/guards.test.js`, `tests/server-gating.test.js` — new suites run under bare `node --test tests/` only | Agent + human decision at review-findings gate — add the four files to the script lists | open |
