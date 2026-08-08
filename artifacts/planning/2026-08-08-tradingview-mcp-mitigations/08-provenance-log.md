# Provenance Log

| Task ID | Assistant | Model | Prompt Class | Context Scope | Description |
|---|---|---|---|---|---|
| 1 | cursor | kimi-k3 | code-generation | mixed | Capability allowlist gate primitive (src/capabilities.js) + unit tests |
| 2 | cursor | kimi-k3 | code-generation | repo-only | Registrar gate wiring, ui_evaluate removal, server-gating tests, README Security Model |
| 3 | cursor | kimi-k3 | code-generation | repo-only | Untrusted-content fencing in jsonResult + fencing tests + server instruction |
| 4 | cursor | kimi-k3 | code-generation | repo-only | tv_update hardening: token gate, origin allowlist, signed-tag/pinned-SHA, fail-closed npm ci |
| 5 | cursor | kimi-k3 | code-generation | repo-only | kill_existing schema default false, exact-path PID kill, MSIX fallback honors flag |
| 6 | cursor | kimi-k3 | code-generation | repo-only | ui_find_element css guard, pine_check upload opt-in, remote-CDP loopback guard |
| 7 | cursor | kimi-k3 | code-generation | repo-only | CI supply-chain: SHA-pinned actions, least-privilege permissions, blocking audit, dependency-review job |
| 8 | cursor | kimi-k3 | code-generation | repo-only | Exact dependency pins, lockfile-lint + security:audit script, performance-analyst agent rescope |
