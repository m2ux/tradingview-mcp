# Live verification notes

Unit tests (mocked `_deps`) cover the issue's automated plan. Live Desktop check is still manual.

Observed 2026-08-16 against the running (main) MCP + Desktop:

- CDP connected; chart `TVC:UKOIL` 45m
- `draw_template_list({ drawing_type: "fibonacci channel" })` includes `_Base_T` (96 LineToolFibChannel templates)
- The running MCP process is still the pre-#29 server (89 tools) — `draw_fib_channel` will not appear until the server is started from the worktree

Manual once the worktree server is attached:

1. `draw_fib_channel({ template: "_Base_T", point, point2, point3 })` on three known loci
2. `draw_get_properties` → those points + template level coeffs (0 / 0.49–0.51 / 1)
3. `draw_remove_one` the new `entity_id` if the draw was only a smoke
