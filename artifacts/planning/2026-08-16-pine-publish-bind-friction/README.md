# Pine publish/bind friction — August 2026

> Server-side gaps from [issue #26](https://github.com/m2ux/tradingview-mcp/issues/26) · Started 2026-08-16 · **Status:** PR [#27](https://github.com/m2ux/tradingview-mcp/pull/27) open

> Encountered while finishing the RSIZoneDiv library-generic refactor (#20). The Pine work gated 58/58 after a manual UI walk; these are MCP bugs, not Pine bugs.

## 🎯 Executive Summary

`pine_publish` can report `success: true` without walking **Update existing**, so `import user/Lib/N` stays on a stale snapshot. `pine_bind` can inject into the wrong editor identity. `tv_ui_state` is blind to the publish wizard. `pine_open` is name-only and leaves the Open picker up. Persist-verify is noisy on CRLF vs LF. There is no published-export probe.

This package hardens those tools so an agent cannot overwrite a published library with an indicator, or claim a publish that did not bump `/N`.

## Problem Overview

| # | Failure | Harm |
|---|---------|------|
| 1 | `pine_publish` returns same pubId + version 1.0 on an already-published library | Consumer `import …/1` missing new exports (`eng.step`) |
| 2 | Publish wizard absent from `tv_ui_state.dialogs` | Agent starts a second publish or clicks community Publish |
| 3 | `pine_bind(script_id)` injects Generic source into Eng header | Save would overwrite the published library with an indicator |
| 4 | `pine_open` name-only; leftover **Open my script** | Ambiguous Eng/Engine/EngineLib; blocks Save / add-to-chart |
| 5 | Persist-match is byte-exact (CRLF vs LF) | False `TV_PINE_UNBOUND` after a real save |
| 6 | No published `export` list for `user/Lib/N` | Only proof of stale `/1` is a consumer compile |

## Solution Overview

- `pine_publish`: detect prior `published_version` / **Update existing**; fail if that path is not completed; return `mode` + `published_version` after.
- `tv_ui_state`: classify Pine publish/update wizard (title, step, buttons) into `dialogs` / `blocking_dialog`.
- `pine_bind`: switch Open/Save/Publish identity or refuse; never inject into a mismatched header.
- `pine_open`: accept `script_id`; dismiss Open dialog on success; return `blocked_dialog` when the picker remains.
- `pine_save`: normalize newlines before persist-match.
- `pine_read_script` + `pine_library_exports`: `scope: published` and version `N`.

## 📊 Progress

| # | Item | Status |
|---|------|--------|
| 1 | Planning folder + worktree + branch | ✅ |
| 2 | `pine_publish` update-existing + evidence | ✅ |
| 3 | `tv_ui_state` wizard visibility | ✅ |
| 4 | `pine_bind` identity refuse/switch | ✅ |
| 5 | `pine_open` script_id + dismiss | ✅ |
| 6 | CRLF/LF persist-match | ✅ |
| 7 | Published-export probe | ✅ |
| 8 | Unit tests + docs | ✅ |
| 9 | PR against `m2ux/tradingview-mcp` | ✅ [#27](https://github.com/m2ux/tradingview-mcp/pull/27) |
| 10 | Live Desktop checks (worktree vs CDP) | ✅ 2026-08-16 |

**Status:** ⬚ pending · 🟡 in progress · ✅ complete · ❌ blocked

## 🔗 Links

| Resource | Link |
|----------|------|
| Issue | [#26](https://github.com/m2ux/tradingview-mcp/issues/26) |
| Related | [#12](https://github.com/m2ux/tradingview-mcp/issues/12) published-scope read, [#17](https://github.com/m2ux/tradingview-mcp/issues/17) headless save |
| Branch | `fix/26-pine-publish-bind-friction` |
| Worktree | `.worktrees/2026-08-16-pine-publish-bind-friction` |
| Pull request | [#27](https://github.com/m2ux/tradingview-mcp/pull/27) |
| Plan | [01-plan.md](01-plan.md) |

## GitNexus blast radius (pre-edit)

| Symbol | Risk | Direct callers |
|--------|------|----------------|
| `publishScript` | LOW | CLI pine |
| `bindScript` | LOW | `registerPineTools` |
| `openScript` | **HIGH** | tools, `bindScript`, `copyScript`, `publishScript`, CLI |
| `uiState` | LOW | CLI chart |
| `save` | (persist-match only) | tools |

`openScript` changes stay additive: optional `script_id`, stronger dismiss, `blocked_dialog` on leftover picker. Existing `{ name }` callers keep working.
