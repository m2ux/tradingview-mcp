# MCP Tooling — Headless vs DOM, Failure Signatures, Save/Register Gap

> Prefer operations that do **not** touch live UI elements. The read path is already headless
> (chart model via `window.TradingViewApi.*`); the write path historically was not. This
> document is the field guide to which tool to use and how to recognize each failure mode.

## 1. Tool selection matrix

| Task | Use (headless) | Avoid (DOM) |
|------|----------------|-------------|
| Add a saved Pine script to chart | `study_add_pine` (name or script_id) → returns `entity_id` | `pine_add_to_chart`, `indicator_add` |
| Add a built-in study | `study_add` → returns `entity_id` | `chart_manage_indicator` add path |
| Remove / de-duplicate a study | `study_remove(entity_id)` | manual DOM / `chart_manage_indicator` |
| Read a study's historical series | `data_get_study_series(entity_id=...)` | name-substring match on a duplicated study |
| Read a saved script's source | `pine_read_script(name/script_id)` (no editor side effects) | `pine_open` + `pine_get_source` |
| Bind editor buffer to an identity | `pine_bind(name/script_id)` | `pine_open` (Open-dialog) |
| Persist buffer to cloud | buffer-aware `pine_save` (returns `verified`, `persisted_matches_buffer`, `bound_mismatch`) | legacy `pine_save` (bare `Ctrl+S` dispatch) |
| Create a **new** registered identity | *(gap — see §4)* `pine_copy` / `pine_save_as` (DOM) | — |

## 2. Failure signatures → cause → action

| Signature | Likely cause | Action |
|-----------|--------------|--------|
| `Could not open Pine script name menu.` | DOM save-as scraping a moved selector (`.tv-script-widget [class*="nameButton"]`) | Retry once; otherwise this is the DOM-registration gap — prefer a headless path or a pre-existing identity |
| `Refusing Add to chart while a dialog is already open` / `blocked_dialog` | A modal (Open dialog, "Save this script before adding?") intercepted the apply | Dismiss dialogs; ensure script is **saved first**; re-issue |
| `capture_screenshot` timeout / `pine_get_source` fails after `pine_open` | Lingering blocking dialog swallowing events | Close dialogs (e.g. "Close menu" / `Escape`), re-observe |
| `pine_save` returns `verified:false` but version bumped | **Known false-negative** (stale facade read right after dispatch) — or a real unbound buffer | Check `persisted_matches_buffer` / `bound_mismatch`; if unbound, `pine_bind` then save |
| `No study matching "<name>"` after restart | Active tab changed / study not on this tab | Re-derive tab (`tab_list` → `chart_get_state`), or use a dedicated session tab |
| `study_added:false` ambiguous | DOM add infers success from a count delta; update-in-place doesn't change count | Use `study_add_pine` which returns a typed `entity_id` |
| Duplicate identical studies on one chart | DOM `addToChart` prefers "Add" over "Update" when buffer↔study unbound | `study_remove` the duplicate by `entity_id`; keep exactly one |

## 3. The unbound-editor trap (and the `pine_bind` fix)

`pine_set_source` injects into the Monaco **buffer**, but if that buffer is not bound to the
on-chart study's identity, the chart does not reflect the edit and `pine_save` can't verify
against the right script. This produced both the `verified:false` false-negative and the
accidental overwrite of a cloud script (which collapsed the on-chart studies from 3 signals
to 1).

**Rule.** Before editing + saving, run `pine_bind(name/script_id)` to fetch the registered
source into the buffer and confirm the match. Then `pine_set_source` → buffer-aware
`pine_save` and check `persisted_matches_buffer:true` and no `bound_mismatch`.

## 4. The save/register gap (tracked as issue #17)

There is **no headless way to create a *new* registered script identity.** The naive
pine-facade `save`/`new` REST endpoints yield an **orphan** script (absent from the Open
dialog, unpublishable, not stably resolvable by `study_add_pine`). That is why
`pine_copy`/`pine_save_as` deliberately drive the UI "Make a copy…" flow — it is the only
known route to a *registered* identity.

**Implication for the agent.** When a variant needs its own identity to coexist with another
on the chart, you must either:
- use one DOM `pine_copy` (now healthier after the #18 bind/save work), or
- reuse an existing scratch identity and target by `entity_id` (name collision is fine when
  you capture by id).

**Do not** attempt to "work around" the gap by calling orphan facade endpoints directly —
you will get an unregistered script that breaks the downstream headless add.

## 5. Gating vs reliability — don't conflate them

`capabilities.js GATED_TOOLS` is a **blast-radius / trust** boundary (destructive,
process-spawn, fan-out): `tv_update`, `tv_launch`, `alert_delete`, `draw_clear`,
`batch_run`, `net_request`, `ui_fiber_action`. The DOM pine tools are **not** gated — they
are merely *fragile*, which is a different axis. A tool being flaky is not, by itself, a
reason to gate it; it is a reason to build a headless replacement. (See issue #17.)

## 6. Shell/sandbox vs auth (environment traps)

- `gh` and remote git/SSH need **full host permissions** (`required_permissions:["all"]`).
  Sandbox denials masquerade as auth failures (`Bad credentials`, `connection reset`,
  `Could not read from remote repository`). Re-run the *same* command outside the sandbox
  before concluding credentials/SSH are broken.
- Leave `GH_TOKEN`/`GITHUB_TOKEN` unset for keyring auth; a stale value overrides the keyring
  and yields HTTP 401.
- Local CDP reads (localhost:9222) may also need to escape the sandbox network allowlist.
- **GitHub ops are REST-only here.** Never `gh pr create/view/list` (GraphQL). Use
  `gh api repos/...` for issues/PRs.
