---
phase: 7
slug: tools-registry-inngest-scheduler-browserbase-tool-browser
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-30
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `tsx` runners (matches `apps/api/src/app.test.ts` + `packages/core/src/architect/architect.test.ts` precedent — no vitest in repo) |
| **Config file** | none (per-package `test` script in `package.json`) |
| **Quick run command** | `pnpm --filter @agent-os/core run test:architect` (sanity — must stay green) |
| **Full suite command** | `pnpm verify` (runs `scripts/test-all.sh` — typecheck + all `*.test.ts`) |
| **Estimated runtime** | ~30 seconds (excluding integration tests that need DB) |

---

## Sampling Rate

- **After every task commit:** `pnpm -r typecheck` + `pnpm --filter @agent-os/core run test:architect`
- **After every plan wave:** `pnpm verify`
- **Before `/gsd-verify-work`:** Full suite green + manual smoke per Verification Map below
- **Max feedback latency:** ~10 seconds (typecheck), ~30 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-* | 01-tools-registry-schema | 1 | Phase 7 SC #1 | T-7-01 RLS | `tools` table reads return zero rows cross-tenant | unit | `pnpm --filter @agent-os/core run test:tools-schema` | ❌ W0 | ⬜ pending |
| 7-02-* | 02-seedAgent-tools-extension | 1 | SC #1 | — | `AgentSpec.tools` optional → existing seeds unchanged | unit | `pnpm --filter @agent-os/core run test:seed-tools` | ❌ W0 | ⬜ pending |
| 7-03-* | 03-pg-cron-inngest-bridge | 2 | SC #2 | T-7-02 webhook auth | pg_net call carries Inngest signing header; replay-resistant | integration | `pnpm --filter @agent-os/scheduler test` | ❌ W0 | ⬜ pending |
| 7-04-* | 04-inngest-client-hono-mount | 2 | SC #2 | — | `GET /api/inngest` returns 200 with function metadata | smoke | `curl localhost:8787/api/inngest` | ❌ W0 | ⬜ pending |
| 7-05-* | 05-tool-browser-package | 3 | SC #3 | T-7-03 SSRF | URL denylist rejects 169.254/127.0.0.1/private CIDRs | unit | `pnpm --filter @agent-os/tool-browser test` | ❌ W0 | ⬜ pending |
| 7-06-* | 06-tool-browser-runner-integration | 3 | SC #3 | T-7-03 | runner's PreToolUse hook gates tool.browser per autonomy | integration | `pnpm --filter @agent-os/runner test:browser` | ❌ W0 | ⬜ pending |
| 7-07-* | 07-architect-tools-binding | 3 | SC #1 | — | Architect blueprint can list tools; hydrate clamps unknown | unit | `pnpm --filter @agent-os/core run test:architect` | ✅ (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per the researcher's Wave 0 gap list (9 files), the planner's first wave must create:

- [ ] `packages/db/src/schema.ts` — extended with `tools` + `agentTools` tables
- [ ] `supabase/migrations/0007_tools_registry.sql` — migration with RLS
- [ ] `packages/core/src/seed/seedAgent.ts` — `AgentSpec.tools` optional field; `bindTool` helper
- [ ] `packages/core/src/seed/seedAgent.test.ts` — assertion that existing-Phase-1 specs still seed without `tools`
- [ ] `packages/tool-browser/package.json` — new workspace package
- [ ] `packages/tool-browser/src/index.ts` — Stagehand wrapper + URL denylist
- [ ] `packages/tool-browser/src/index.test.ts` — denylist + SSRF tests
- [ ] `apps/api/src/inngest.ts` — Inngest client + handler mount
- [ ] `supabase/migrations/0008_pg_cron_to_inngest.sql` — rewrite `aos_job_cron_command()` to `pg_net.http_post` Inngest webhook

---

## Nyquist Verification Dimensions

Eight dimensions the plan-checker enforces:

1. **Correctness** — each task has source assertions (file path, function signature, expected output).
2. **Coverage** — every phase success criterion has at least one test task.
3. **Determinism** — tests run without DB by default; integration tests gated behind `DATABASE_URL`.
4. **Independence** — each test file standalone (no order dependency).
5. **Performance** — full suite < 60 seconds locally.
6. **Security** — SSRF denylist test, RLS cross-tenant test, signing-header verification test (T-7-01..03 traced above).
7. **Observability** — Inngest function runs visible in Inngest dashboard / pg_net logs.
8. **Reversibility** — every migration has a documented rollback path in the plan's `<rollback>` block.

---

## Status

`status: draft` — flipped to `passed` by `/gsd:verify-work` once all Verification Map rows are ✅.
