---
target: src/core/pine.js smartCompile and the seven live-edit traps
date: 2026-09-09
lens: L12 structural
---

# Structural analysis (L12)

## Claim

Library compile encodes “do not add a study” as a **button preference**, not as a conservation constraint. `preferSave` only reorders the same Add/Update/Save/Enter cascade. Three experts who disagree still share that a compile is a click on some persist control. The transformed claim: a library compile is a persist that **must not produce a study on any termination path**. The gap is preference versus invariant.

## Concealment mechanism

`preferSave` looks like the fix. Tests click Save when both buttons exist, so the remaining Add/Enter arms stay green. The cascade after the Save click reads as leftover indicator behaviour rather than a second producer of a study.

A review-passing “improvement” that deepens the concealment: add `study_added: false` to the tool description and keep the cascade. Reviewers see the contract; the page script still clicks Add when Save is missing.

Properties visible only after that strengthening:

1. The test stub returns Add when `preferSave && !clicks.save`.
2. Enter is the no-button producer and is not gated on `preferSave`.
3. `study_added` is measured after the click, so a failure can still report a new study.

## Improvements

Host-side refuse when `preferSave && clicked !== 'Pine Save'` makes the invariant checkable. That improvement conceals a page script that still clicks Add before the host returns — the study is already on the chart. A second improvement: the page script returns null when `preferSave && !saveBtn`, and the host skips Enter. The remaining property is UI drift: `saveButton` class or `offsetParent` fails while Add remains.

## Structural invariant

Some persist control other than Pine Save still exists on a library buffer, and the compile walk still knows how to press it.

## Conservation law

**A library compile produces a persist or an error, never a study.**

| Resource | Producers | Clearers | Termination paths | Verdict |
|----------|-----------|----------|-------------------|---------|
| Study on chart (library compile) | Add click, Update click, Enter | none in `smartCompile` | Save present: matched (Save only). Save missing: unmatched Add. No buttons: unmatched Enter | unmatched |
| Editor buffer (bind) | `setSource` | dirty refuse unless `reload` | identity miss, dirty, clean, reload | matched |
| Chart bitmap | CDP screenshot | `TV_CHART_CLIP_BLOCKED` before capture | occluded, no pane, clear pane | matched |
| Publish wizard | Publish script click | leftover-wizard resume | leftover, fresh, not-on-chart interstitial | matched |

The law holds only when every library-compile path is Save or error. One unmatched Add path falsifies it.

Inverted design: compile a library by writing the facade only (no chart buttons). New impossibility: live syntax markers then require a compile that does not touch the chart widget. The conservation between “Save-or-error” and “no chart widget” is the same: **chart mutation is not a compile side effect**.

## Meta-law

The conservation law conceals that `preferSave` is compiled into the page string as a boolean, so tests that inspect the string and stubs that honour it never execute the cascade. Concrete test: a library buffer with Add visible and Save absent must return `success: false` and leave `studyCount` unchanged. If that test is written only against the stub’s `preferSave` branch, the law looks satisfied while the page script still clicks Add.

## Bug table

| Location | What breaks | Severity | Fixable / structural | Reachability |
|----------|-------------|----------|----------------------|--------------|
| [pine.js:819](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L819) | Library compile clicks Add when Save is missing | High | fixable — gate the cascade | conditional — Save control absent |
| [pine.js:827](https://github.com/m2ux/tradingview-mcp/blob/7cc922312381b5897f72635a2a88136b79763848/src/core/pine.js#L827) | Enter after no click can add a library | High | fixable — skip Enter when `preferSave` | conditional — no persist button found |
| Same as [CR-1](10-code-review.md#cr-1--library-compile-still-adds-to-chart-when-pine-save-is-missing) | — | — | — | cited, not restated |

Plot-slot, Monaco fill, Close classify, dirty bind, leftover wizard, and occluded clip have matched producer/clearer ledgers on this walk.
