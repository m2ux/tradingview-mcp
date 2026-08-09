# pine-publish — reference

Companion to [SKILL.md](SKILL.md). Captured from live private publish/update walks.

## ui_evaluate patterns

### Probe visible dialogs and primary actions

```js
(() => {
  const sel = '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]';
  const nodes = [...document.querySelectorAll(sel)].filter((n) => n.offsetParent || n.getClientRects().length);
  return nodes.map((d) => ({
    text: (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    buttons: [...d.querySelectorAll('button, [role="button"]')]
      .filter((b) => b.offsetParent || b.getClientRects().length)
      .map((b) => ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 80)),
  }));
})()
```

Note: bare `.pine` editor shells may use `js-dialog` — ignore surfaces without publish wizard controls.

### Click by label inside dialogs (handles doubled text)

```js
((re) => {
  const rx = new RegExp(re, 'i');
  const btns = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')];
  for (let i = btns.length - 1; i >= 0; i--) {
    const b = btns[i];
    if (!b.offsetParent && !b.getClientRects().length) continue;
    const t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
    if (rx.test(t)) { b.click(); return t; }
  }
  return null;
})('^update existing script')
```

### Fill largest textarea in publish wizard

```js
((value) => {
  const sel = '[role="dialog"], [aria-modal="true"], [class~="js-dialog"]';
  let best = null, area = 0;
  for (const inp of document.querySelectorAll('textarea, [contenteditable="true"]')) {
    const dlg = inp.closest(sel);
    if (!dlg || (!inp.offsetParent && !inp.getClientRects().length)) continue;
    const r = inp.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area) { best = inp; area = a; }
  }
  if (!best || area < 1000) return false;
  best.focus();
  if (best.isContentEditable) best.textContent = value;
  else {
    const proto = best.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(best, value);
  }
  best.dispatchEvent(new Event('input', { bubbles: true }));
  best.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})('Release notes…')
```

### Source stamp for update (Monaco)

Prefer `pine_set_source` with `script_name` guard when fiber access works. If Save does not dirty, set via usable Monaco + click Save:

```js
(() => {
  function usable(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (el.offsetParent || el.getClientRects().length) && r.width >= 40 && r.height >= 40;
  }
  // locate editor via project FIND_MONACO pattern, then:
  // editor.setValue(editor.getValue() + '\n// E2E publish stamp ' + Date.now())
  return true;
})()
```

## Verification notes

- **Private** publications often **omit** `pine-facade/list/?filter=published`.
- Prefer: editor version chip, `filter=saved` version, successful dependent `import user/Lib/N`, wizard dismissed.
- `pine_smart_compile` with `require_published_imports: true` is a good post-library gate for dependents.

## Related tools

| Tool | Role |
|------|------|
| `tv_ui_state` | Dialog + key button snapshot |
| `ui_evaluate` | Async page JS (`awaitPromise` always on) |
| `ui_set_input` / `ui_wait_for` | Generic form/poll helpers |
| `pine_open` / `pine_save` / `pine_set_source` | Identity + source |
| `pine_publish` | Best-effort first-time path only |
| `pine_list_scripts` | published_version / ui_visible |
| `pine_smart_compile` | import_errors gate |
