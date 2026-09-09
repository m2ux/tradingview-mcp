# Lean Change — drop duplicate Close projection

**Rung taken:** Does it need to exist? (YAGNI) · **Intensity:** full

```javascript
  const dialogs = await getVisibleDialogs();
  // ponytail: Close classification lives on dialogs[].close_surface, add when a caller needs a compact Close map without scanning dialogs
  return {
    success: true,
    ...state,
    dialogs,
    blocking_dialog: dialogs.length > 0 ? dialogs[dialogs.length - 1] : null,
  };
```

**Check:** `tests/issue26_pine_friction.test.js` still asserts `close_surface` on classified dialogs. No test named `close_controls`.

**Skipped:** Dedicated Close map — add when a caller needs one without scanning `dialogs`.
