---
status: In Progress
current_phase: 7
current_phase_name: Tools registry + Inngest scheduler + Browserbase tool.browser
plans_total: 7
plans_complete: 7
last_activity: 2026-05-30
---

# Project State — Acqu / Cliently Agent OS

## Status

**Phase 7 COMPLETE** — gsd-verifier PASSED (3/3 success criteria). Operator DB-push + live-relay/Browserbase follow-ups remain (sandbox limits, documented).

## Current Position

- Phase 1–6: complete (doctrine seeded through fulfillment + revenue ops; Architect + remix shipped).
- Phase 7: 7/7 plans done (executed inline after the background gsd-executor agents kept stream-timing-out and rewriting history on the shared branch).
  - 07-01 tools registry schema (migration 0007 + Drizzle mirror + RLS) — db push deferred.
  - 07-02 seedAgent tools extension (ensureTool/bindTool/AgentSpec.tools optional) + Bundle.tools[].
  - 07-03 @agent-os/inngest package (client + runScheduledAgent). Fixed createFunction signature inline.
  - 07-04 Inngest /api/inngest Hono mount + migration 0008 pg_cron→Inngest bridge — db push deferred.
  - 07-05 @agent-os/tool-browser (SSRF guard T-7-03 + runBrowserTool contract, Node-fetch backend).
  - 07-06 runner allowedTools narrowing (Pitfall 5) + tool.browser custom dispatch.
  - 07-07 seed tool.browser row (unbound, RESEARCH OQ1) + architect regression.

## Verification snapshot

- `pnpm -r typecheck` — 12 packages green.
- `pnpm --filter @agent-os/core run test:architect` — 33/33.
- Per-package tests: inngest 3/3, tool-browser 15/15, runner 6/6.

## Sandbox constraints (carried)

- Supabase DB NOT reachable — migrations 0007 + 0008 authored + typecheck-verified; `supabase db push` deferred to operator.
- Browserbase + Stagehand backend deferred to Phase 8 (V3 API surface moving); Phase 7 ships the SSRF boundary + fetch-backed contract.
- Live Inngest relay + signing keys deferred to operator.

## Key decisions

- Tools are DATA (registry rows), mirroring skills/MCPs. AgentSpec.tools is OPTIONAL — all 26 prior seeds compile unchanged.
- tool.browser seeded UNBOUND; first consumer binds in Phase 8.
- Switched Phase 7 execution from background gsd-executor subagents to inline sequential after repeated stream-idle timeouts caused history rewrites on the shared branch. One-executor-at-a-time on a shared branch is the safe pattern without worktrees.

## Next

- Operator: apply migrations 0007 + 0008 (`supabase db push`), then `pnpm seed:tool-browser`.
- Phase 8: Phase-4 doctrine batch seed (moat + meta-layer) — and bind tool.browser to its first consumer (creative-miner).
