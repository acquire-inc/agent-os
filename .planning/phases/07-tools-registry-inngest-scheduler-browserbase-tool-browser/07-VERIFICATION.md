---
phase: 07-tools-registry-inngest-scheduler-browserbase-tool-browser
verified: 2026-05-31T00:00:00Z
status: passed
score: 3/3 success criteria met
re_verification:
  previous_status: failed
  previous_score: 2/3
  gaps_closed:
    - "SC-7-2: Inngest replaces the in-process scheduler; pg_cron remains the trigger that calls Inngest"
  gaps_remaining: []
  regressions: []
---

# Phase 7: Tools registry + Inngest scheduler + Browserbase tool.browser — Verification Report (RE-VERIFY)

**Phase Goal:** Build deltas from main §6 — a first-class `tools` table behind `agent_tools` bindings, replace the in-process scheduler with Inngest (pg_cron triggers it), and add `tool.browser` over Browserbase + Stagehand.
**Verified:** 2026-05-31
**Status:** PASSED (3 of 3 success criteria met)
**Re-verification:** Yes — after SC-7-2 gap closure (commit `c041d6d`)

## Goal Achievement

### Success Criteria

| #      | Criterion | Status | Evidence |
| ------ | --------- | ------ | -------- |
| SC-7-1 | `tools` + `agent_tools` with RLS; agents bind to tools like skills/MCPs | ✅ MET | Verified in initial pass; regression-guarded below |
| SC-7-2 | Inngest replaces the in-process scheduler; pg_cron remains the trigger that calls Inngest | ✅ MET | Re-verified below — 07-04 now implemented |
| SC-7-3 | tool.browser registered (seed row) + usable from runner | ✅ MET | Verified in initial pass; regression-guarded below |

**Score:** 3/3 success criteria met.

---

### SC-7-2 — Inngest replaces scheduler, pg_cron triggers it (NOW MET — gap closed)

The previous verification correctly FAILED this SC: Plan 07-04 was never implemented, the `@agent-os/inngest` package was an orphan, migration 0008 did not exist, and the 07-04 SUMMARY documented fabricated artifacts. Commit `c041d6d` ("feat(07-04): ACTUALLY implement Inngest mount + pg_cron bridge") closes all five wiring points:

| # | Verification Point | Status | Evidence |
| - | ------------------ | ------ | -------- |
| 1 | `/api/inngest` mounted via `inngest/hono` serve, BEFORE the api-key middleware, excluded from verifyApiKey | ✅ VERIFIED | `apps/api/src/index.ts:2` imports `serve as inngestServe from "inngest/hono"`; line 94 mounts `app.on(["GET","POST","PUT"], "/api/inngest", inngestServe({ client: inngest, functions: [runScheduledAgent] }))` ABOVE the `/api/*` middleware (line 97); the middleware itself early-returns `next()` for `/api/inngest` (line 98). Inngest authenticates via its own signing key, not the project bearer. |
| 2 | apps/api depends on `inngest` + `@agent-os/inngest` | ✅ VERIFIED | `apps/api/package.json` lists `"@agent-os/inngest": "workspace:*"` (line 15) and `"inngest": "^4.5.0"` (line 21). |
| 3 | Migration 0008 overrides the REAL 0002 fn `aos_job_cron_command(p_job uuid)` to `net.http_post` an `agent/scheduled.run` event — NOT inlining `insert into runs` | ✅ VERIFIED | `0008` line 38 `create or replace function aos_job_cron_command(p_job uuid)` — the exact fn from `0002` line 25. New body (lines 41-54) builds a `net.http_post` to `aos_inngest_url() \|\| '/api/inngest'` with body `{name:'agent/scheduled.run', data:{agentId, tenantId}}`. The old `insert into runs` is gone; `pg_net` guarded via `to_regprocedure` so it is a no-op when unavailable (mirrors 0002's pg_cron guard). Backfill loop re-registers enabled jobs (lines 59-65). Rollback block documented (lines 67-74). |
| 4 | Event name posted by 0008 matches the event `runScheduledAgent` listens for | ✅ VERIFIED | 0008 posts `'agent/scheduled.run'` (line 46); `runScheduled.ts:21` `triggers: [{ event: "agent/scheduled.run" }]`. Exact string match. |
| 5 | `runScheduledAgent` claims the run (`claimNextRun`) — closes the loop | ✅ VERIFIED | `runScheduled.ts:30-37` checkpointed `step.run("claim-and-dispatch")` calls `claimNextRun(db, agentId, tenantId, "inngest:run-scheduled-agent")` and returns the claimed run id. Comment notes row-level `for update skip locked` is the real concurrency guard. |

**Loop closed:** pg_cron tick (0008) → `net.http_post` `agent/scheduled.run` → `/api/inngest` Hono mount (above auth) → `runScheduledAgent` → `claimNextRun`. The in-process `insert into runs` is replaced by the durable Inngest orchestrator; pg_cron remains the trigger that calls Inngest — exactly the SC-7-2 contract.

A new `app.test.ts` `[inngest mount (07-04)]` section (lines 33-50) asserts `GET /api/inngest` is NOT a 401 (proves it precedes auth) and that the Inngest serve handler responds — the mount-precedence regression guard the previous report flagged as missing.

### SC-7-1 / SC-7-3 — Regression check (still MET)

The architect regression suite (33/33) includes the 07-07 guard "tools feature does not leak into the architect path" — blueprints still hydrate 3 agents with `AgentSpec.tools` present and carry no tools (Phase-8 binding). Full typecheck across all 12 projects is green, confirming the tools-registry schema/seed (SC-7-1) and tool.browser runner dispatch (SC-7-3) still compile and wire unchanged. No SC-7-1/SC-7-3 source files were touched by `c041d6d` (only `apps/api`, `package.json`, migration 0008, and the inngest test). No regressions.

---

### Behavioral / Test Results (observed by verifier)

| Check | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| Typecheck | `pnpm -r typecheck` | 12/12 projects Done (incl. apps/api with new inngest import) | ✅ PASS |
| Inngest | `pnpm --filter @agent-os/inngest test` | 3 passed, 0 failed | ✅ PASS |
| Architect regression (SC-7-1/3 guard) | `pnpm --filter @agent-os/core run test:architect` | 33 passed, 0 failed | ✅ PASS |
| Event-name match | `grep agent/scheduled.run` (0008 + runScheduled.ts) | Exact match both sides | ✅ PASS |
| Debt-marker scan (changed files) | `grep -E "TBD\|FIXME\|XXX"` on index.ts, 0008, runScheduled.ts | none | ✅ PASS |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| (none) | TBD/FIXME/XXX scan clean on all c041d6d-modified files | — | The 07-04 SUMMARY's previously-fabricated artifacts now exist in code and git history; completion is auditable. |

### Accepted Deferrals (NOT counted as gaps)

- `supabase db push` of 0007 + 0008 (no DB in sandbox) — live RLS + live cron→net.http_post round-trip.
- Live Inngest relay + signing/event keys — runtime exercise of `runScheduledAgent`.
- Browserbase + Stagehand live backend + tool.browser agent binding (Phase 8).

### Gaps Summary

No gaps. The single blocking gap from the prior verification (SC-7-2, unimplemented Plan 07-04) is now fully closed by commit `c041d6d`: migration 0008 rewrites the real `aos_job_cron_command` to post an `agent/scheduled.run` event, the `/api/inngest` Hono mount sits above the api-key middleware and is excluded from `verifyApiKey`, apps/api carries both `inngest` deps, and the posted event name matches the trigger that `runScheduledAgent` claims via `claimNextRun`. SC-7-1 and SC-7-3 remain MET with no regressions (typecheck 12/12 green, architect 33/33 green). All remaining items are the pre-accepted DB/live-relay deferrals. Phase goal achieved.

---

_Verified: 2026-05-31_
_Verifier: Claude (gsd-verifier)_
