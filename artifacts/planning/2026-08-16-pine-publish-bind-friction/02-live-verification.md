# Live verification — 2026-08-16

Cursor MCP was still the old 88-tool server, so checks ran from the worktree against CDP (`TVC:UKOIL` @ 4D).

| PR test | Result | Evidence |
|---------|--------|----------|
| `pine_open({ script_id })` | **PASS** | Opened `RSIZoneDivEng` (`USER;5b5ded…`), header match, `blocked_dialog: null` |
| `pine_bind` Generic while Eng open | **PASS** (switch, not inject-into-wrong) | Header became `RSIZoneDivGeneric`; did **not** leave Eng header with Generic source |
| `pine_publish` already-published | **PASS** fail-loud | `mode: update`, `published_version` stayed `4.0`, `pubId: PUB;72abc288ee55459991046fecfbc23326`, `TV_PINE_PUBLISH_STALE` (Update existing not clicked — not-on-chart gate). Did **not** report success. No version bump (no source delta). |
| `tv_ui_state` Update wizard | **PASS** | `kind: pine_publish_wizard`, `mode: update`, title `Update 'RSIZoneDivEng' library`, buttons include Continue. Old MCP `tv_ui_state` would have missed this surface. |
| `pine_library_exports` published v4 | **PASS** after USER→PUB resolve | 21 exports including `ZoneState` (type) and `step` (fn). Works by `USER;id`, `PUB;id`, and name. |

## Residual

- `pine_publish` did not complete a live **Publish new version** bump (intentionally — no source stamp). Fail-loud on unchanged snapshot is proven; the happy-path version increment is still unit-only.
- Worktree has an uncommitted follow-up: published-scope lookup maps `USER;id` → saved name → `PUB;id` (live miss on first try).
