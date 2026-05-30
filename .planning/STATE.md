---
status: In Progress
current_phase: 7
current_phase_name: Tools registry + Inngest scheduler + Browserbase tool.browser
plans_total: 7
plans_complete: 3
last_activity: 2026-05-30
---

# Project State — Acqu / Cliently Agent OS

## Status

**In Progress** — Phase 7 (Tools registry + Inngest scheduler + Browserbase tool.browser), executing 7 plans across 3 waves.

## Current Position

- Phase 1–6: complete (doctrine seeded through fulfillment + revenue ops; Architect feature + remix shipped).
- Phase 7: plans verified by gsd-plan-checker (iteration 2 PASSED). Executing.
- 07-01 (tools registry schema): COMPLETE — migration 0007 + Drizzle mirror + RLS tests. `supabase db push` deferred to operator (sandbox has no DB; see 07-01-SUMMARY.md Operator follow-ups). 1/7 plans done.
- 07-02 (seedAgent tools extension + Bundle): COMPLETE — ensureTool/bindTool/AgentSpec.tools (optional) + Bundle.tools[] + backward-compat test. typecheck 10/10, architect 31/31. 2/7 plans done.
- 07-03 (@agent-os/inngest package): COMPLETE — client (dev-aware signingKey) + runScheduledAgent (concurrency.limit, claimNextRun). 11 pkgs typecheck, inngest test 5/5. Finished inline after executor timeout. 3/7 plans done.

## Sandbox constraints (executors MUST honor)

- **Supabase DB is NOT reachable from this sandbox.** For any `[BLOCKING] supabase db push` task: write the migration SQL + Drizzle schema mirror + tests, run `pnpm -r typecheck`, then DEFER the actual `supabase db push` — record it as an operator follow-up in SUMMARY.md. Do NOT fail the plan on an unreachable DB.
- **Package installs are authorized.** `inngest`, `@browserbasehq/sdk`, `@browserbasehq/stagehand` are pre-verified legitimate (researcher confirmed via npm registry; no postinstall scripts). npm is reachable. Proceed past the `checkpoint:human-verify` install gates.
- **Live Browserbase smoke (07-06) needs API keys + network** — not available here. Write the smoke-test code, then DEFER execution as an operator follow-up in SUMMARY.md.

## Key decisions

- Model: config is config, not code. Tools are DATA (registry rows), mirroring skills/MCPs.
- `tool.browser` row seeded UNBOUND (no agent binding) per RESEARCH Open Question 1 — first consumer in Phase 8.
- Sequential execution on the main tree (`use_worktrees=false`) for this single-threaded session.
