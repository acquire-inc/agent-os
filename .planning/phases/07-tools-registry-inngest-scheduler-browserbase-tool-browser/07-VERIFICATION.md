---
phase: 07-tools-registry-inngest-scheduler-browserbase-tool-browser
verified: 2026-05-31T00:00:00Z
status: failed
score: 2/3 success criteria met
re_verification: # No previous VERIFICATION.md
gaps:
  - truth: "SC-7-2: Inngest replaces the in-process scheduler; pg_cron remains the trigger that calls Inngest"
    status: failed
    reason: >
      Plan 07-04 (the half of SC-7-2 that wires the system together) was never
      implemented. The `@agent-os/inngest` package from 07-03 exists in isolation
      but is mounted nowhere and triggered by nothing. The 07-04 SUMMARY claims
      files that do not exist in the codebase or in git history. Without the mount
      and the pg_cron bridge, Inngest does NOT replace the scheduler — pg_cron
      still inlines `insert into runs` (0002 line 29) exactly as before. The phase
      goal's middle leg is unachieved.
    artifacts:
      - path: "supabase/migrations/0008_pg_cron_to_inngest.sql"
        issue: "DOES NOT EXIST. Migrations stop at 0007. Not in git history on any branch. 07-04 SUMMARY claims it was created."
      - path: "apps/api/src/index.ts"
        issue: "No /api/inngest mount. Zero `inngest` references. No `serve from inngest/hono`. No runScheduledAgent wiring. Auth middleware unchanged."
      - path: "apps/api/package.json"
        issue: "No `inngest` or `@agent-os/inngest` dependency added (07-04 SUMMARY claims both)."
      - path: "apps/api/src/app.test.ts"
        issue: "No `[inngest mount]` test section (07-04 SUMMARY claims a 401-precedence assertion)."
      - path: "supabase/migrations/0002_pg_cron.sql"
        issue: "Cron fn is still `aos_job_cron_command` inlining `insert into runs`; the 07-04 SUMMARY's claimed target `aos_enqueue_due_runs()` does not exist in 0002 — the SUMMARY's own Deviation note is fabricated."
    missing:
      - "supabase/migrations/0008_pg_cron_to_inngest.sql — rewrite the pg_cron command to net.http_post an `agent/scheduled.run` event at {inngest_url}/api/inngest instead of inlining `insert into runs`; documented rollback block; aos_inngest_url() GUC helper; pg_net extension."
      - "apps/api/src/index.ts — mount `serve as inngestServe from 'inngest/hono'` with [inngest] + [runScheduledAgent] at /api/inngest, ABOVE the /api/* api-key middleware (Inngest authenticates via signing key, not the project bearer)."
      - "apps/api/package.json — add `inngest` + `@agent-os/inngest` deps."
      - "apps/api/src/app.test.ts — assert /api/inngest is not 401 (proves it precedes auth)."
---

# Phase 7: Tools registry + Inngest scheduler + Browserbase tool.browser — Verification Report

**Phase Goal:** Build deltas from main §6 — a first-class `tools` table behind `agent_tools` bindings, replace the in-process scheduler with Inngest (pg_cron triggers it), and add `tool.browser` over Browserbase + Stagehand.
**Verified:** 2026-05-31
**Status:** FAILED (1 of 3 success criteria unmet; the unmet one is the central goal claim)
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria

| #      | Criterion | Status | Evidence |
| ------ | --------- | ------ | -------- |
| SC-7-1 | `tools` + `agent_tools` with RLS; agents bind to tools like skills/MCPs (ensureTool/bindTool mirror, AgentSpec.tools optional, Bundle.tools projected) | ✅ MET | Verified below |
| SC-7-2 | Inngest replaces the in-process scheduler; pg_cron remains the trigger that calls Inngest (0008 posts events; runScheduledAgent claims; /api/inngest mounted above auth) | ✗ UNMET | Verified below — 07-04 not implemented |
| SC-7-3 | tool.browser registered (seed row) + usable from runner (custom dispatch + allowedTools); 3-leg satisfaction (row + dispatch + smoke); agent binding deferred to Phase 8 | ✅ MET | Verified below |

**Score:** 2/3 success criteria met.

---

### SC-7-1 — Tools registry + bindings (MET)

| Artifact | Status | Evidence |
| -------- | ------ | -------- |
| `supabase/migrations/0007_tools_registry.sql` | ✅ VERIFIED | `tools` table (tenant_id FK, key, kind check custom/mcp, requires_approval default **true**, unique(tenant_id,key)); `agent_tools` composite-PK join; RLS `tools_rw` via `is_tenant_member(tenant_id)` and `agent_tools_rw` via parent-agent tenant (mirrors `agent_mcps`); rollback documented. |
| `packages/db/src/schema.ts` | ✅ VERIFIED | `tools` + `agentTools` pgTable blocks mirror the SQL column-for-column (lines 119-126, 219-232). |
| `packages/core/src/seed/seedAgent.ts` | ✅ VERIFIED | `ensureTool` (mirrors `ensureSkillFromDir`, defaults requiresApproval=true) and `bindTool` (mirrors `bindMcp` — parameterized `sql` + `on conflict do nothing`); `AgentSpec.tools?` is OPTIONAL; `seedAgent` resolves+binds with `?? []` no-op when absent. |
| `packages/core/src/bundle.ts` | ✅ VERIFIED | `Bundle.tools[]` assembled from the `agent_tools` join (lines 92-95, 101, 160-167) — plain projection, no credentials. |
| `packages/core/src/integration.test.ts` `[tools registry]` + `seedAgent.test.ts` | ⚠ CODE PRESENT, DB-DEFERRED | Both test files exist and read correctly (cross-tenant zero, requiresApproval round-trip, idempotent re-bind, Bundle.tools). They are DB-bound and cannot run in the sandbox — accepted deferral. |

Key links WIRED: AgentSpec.tools → ensureTool → bindTool → agent_tools → Bundle.tools → runner. Backward-compat honored: 26 existing seeds compile unchanged (typecheck green). **Live RLS round-trip is the accepted `supabase db push` deferral.**

### SC-7-2 — Inngest replaces scheduler, pg_cron triggers it (UNMET — BLOCKER)

| Artifact | Status | Evidence |
| -------- | ------ | -------- |
| `packages/inngest/src/client.ts` | ✅ VERIFIED | Inngest client; dev/signing-key ternary (Pitfall 4) correct. |
| `packages/inngest/src/functions/runScheduled.ts` | ⚠ ORPHANED | `runScheduledAgent` claims a run via `claimNextRun` in a checkpointed `step.run`. Substantive — but **nothing mounts or invokes it** (no /api/inngest). |
| `supabase/migrations/0008_pg_cron_to_inngest.sql` | ✗ MISSING | Does not exist in the tree or in git history on any branch. The pg_cron→Inngest bridge — the literal "pg_cron remains the trigger that calls Inngest" clause — was never built. |
| `apps/api/src/index.ts` /api/inngest mount | ✗ MISSING | Zero `inngest` references in apps/api/src. No `inngest/hono` serve, no mount above auth. |
| `apps/api/package.json` deps | ✗ MISSING | No `inngest` / `@agent-os/inngest` dep. |
| `apps/api/src/app.test.ts` `[inngest mount]` | ✗ MISSING | Not present. |

**The 07-04 SUMMARY documents work that does not exist.** Commit `ea6de6e` ("4 missing SUMMARYs (04-07)") added only the SUMMARY/STATE/ROADMAP docs — no 07-04 code commit exists. The SUMMARY even names a target function (`aos_enqueue_due_runs()`) that is absent from migration 0002 (the real fn is `aos_job_cron_command`, still inlining `insert into runs`). Result: Inngest does NOT replace the in-process scheduler, and pg_cron does NOT call Inngest. The central goal claim of the phase is unachieved.

### SC-7-3 — tool.browser registered + runner-usable (MET)

| Artifact | Status | Evidence |
| -------- | ------ | -------- |
| `packages/tool-browser/src/ssrf.ts` | ✅ VERIFIED | `assertUrlAllowed` rejects non-http(s), localhost aliases, metadata IPs (169.254.169.254, fd00:ec2::254), and DNS-resolves then BlockList-checks private/loopback/link-local v4+v6. 15/15 tests pass. |
| `packages/tool-browser/src/index.ts` | ✅ VERIFIED | `runBrowserTool`: validate → SSRF-guard → fetch → write-to-file → return path (non-negotiable #4). Swappable `BrowserFetcher`; Browserbase/Stagehand backend correctly deferred to Phase 8. |
| `apps/runner/src/custom-tools.ts` | ✅ VERIFIED | `customToolDispatch["tool.browser"]` → `runBrowserTool`; `deriveAllowedTools` builds an explicit allowlist from bundle.tools + mcpServers (Pitfall 5 — never unset); `dispatchCustomTool` refuses unbound tool / unregistered handler. 6/6 tests pass. |
| `apps/runner/src/execute.ts` | ✅ VERIFIED | `liveRun` sets `allowedTools: deriveAllowedTools(b)` in the SDK options (line 125). |
| `scripts/seed/acqu-tool-browser.ts` | ✅ VERIFIED | `ensureTool("tool.browser")` for tenant Acqu, kind=custom, requiresApproval=true, **UNBOUND** (binding deferred to Phase 8 per RESEARCH OQ1 — correct). |

Per the verification brief, SC-7-3's deferred agent binding is intentional and NOT a gap. The 3-leg satisfaction (registry row + runner dispatch + smoke) is fully present. Note: a residual TOCTOU DNS-rebinding window exists between SSRF lookup and the fetch's own lookup — acceptable for the Phase 7 Node-fetch boundary; the Browserbase backend (Phase 8) is the place to close it.

---

### Behavioral / Test Results (observed by verifier)

| Check | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| Typecheck | `pnpm -r typecheck` | 12/12 projects Done | ✅ PASS |
| Architect regression | `pnpm --filter @agent-os/core run test:architect` | 33 passed, 0 failed | ✅ PASS |
| Inngest | `pnpm --filter @agent-os/inngest test` | 3 passed, 0 failed (SUMMARY claimed 5 — immaterial) | ✅ PASS |
| tool-browser | `pnpm --filter @agent-os/tool-browser test` | 15 passed, 0 failed | ✅ PASS |
| runner | `pnpm --filter @agent-os/runner test` | 6 passed, 0 failed | ✅ PASS |
| seed-tools / tools-schema | `pnpm --filter @agent-os/core run test:seed-tools` | DATABASE_URL required — DB-bound, sandbox has no DB | ⚠ SKIP (accepted deferral) |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| (none in modified code) | TBD/FIXME/XXX scan clean | — | No debt markers in any Phase-7-modified file. |
| `07-04-SUMMARY.md` | Documents non-existent artifacts (migration 0008, /api/inngest mount, app.test assertion) | 🛑 BLOCKER | The SUMMARY claims completed work that is absent from code and git history — completion is not auditable; the phase goal's SC-7-2 is unmet despite the SUMMARY's "status: complete". |

### Accepted Deferrals (NOT counted as gaps)

- `supabase db push` of 0007 (no DB in sandbox) — SC-7-1 live RLS round-trip.
- Browserbase + Stagehand live backend (Phase 8) — SC-7-3 ships SSRF boundary + Node-fetch contract.
- Live Inngest relay + signing/event keys — runtime exercise of the function.
- tool.browser agent binding (Phase 8, RESEARCH OQ1) — explicitly out of SC-7-3 scope.

### Gaps Summary

Two of three success criteria are fully achieved: the tools registry (SC-7-1) and tool.browser (SC-7-3) are present, substantive, and wired, with only the documented DB-push items deferred. The phase FAILS on SC-7-2 — the literal "replace the in-process scheduler with Inngest (pg_cron triggers it)" goal. The `@agent-os/inngest` package exists but is an orphan: there is no `/api/inngest` mount and no migration 0008, so pg_cron still creates runs directly and Inngest is never invoked. The 07-04 SUMMARY asserts these artifacts were built; they exist nowhere in the codebase or git history, and the SUMMARY references a pg_cron function name that doesn't exist in 0002. Closing the gap requires implementing Plan 07-04 for real: migration 0008 (pg_cron → net.http_post → `agent/scheduled.run`), the Hono mount above the auth middleware, the api deps, and the mount-precedence test.

---

_Verified: 2026-05-31_
_Verifier: Claude (gsd-verifier)_
