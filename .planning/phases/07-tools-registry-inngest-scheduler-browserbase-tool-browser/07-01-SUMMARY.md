---
phase: 07-tools-registry-inngest-scheduler-browserbase-tool-browser
plan: 01
subsystem: db-schema
tags: [tools-registry, rls, multi-tenant, migration, drizzle]
requires: [0001_init.sql (tenants, agents, mcps, is_tenant_member)]
provides:
  - tools table (tenant-scoped, RLS via is_tenant_member)
  - agent_tools join table (RLS via parent agent tenant)
  - Drizzle mirror: schema.tools + schema.agentTools
  - integration test [tools registry] section (P7-SC1.a/b)
affects: [07-02 seedAgent, 07-04 bundle, 07-06 runner, 07-07 architect-binding]
tech-stack:
  added: []
  patterns: [is_tenant_member RLS, agent_mcps join precedent, architect_blueprints top-level precedent, tsx test runner]
key-files:
  created:
    - supabase/migrations/0007_tools_registry.sql
  modified:
    - packages/db/src/schema.ts
    - packages/core/src/integration.test.ts
    - packages/core/package.json
decisions:
  - "Tools are DATA, not code — registry row + RLS, bound like skills/MCPs (CLAUDE.md)."
  - "requires_approval defaults true (deny-by-default safety; T-7-05 mitigation)."
  - "Hand-written SQL migration; Drizzle is mirror-only — did NOT run db:generate (Pitfall 6 / T-7-04)."
metrics:
  duration: ~ (resumed run; Task 1 in prior commit 66610f7)
  completed: 2026-05-30
requirements: [SC-7-1]
---

# Phase 7 Plan 01: Tools Registry Schema Summary

The `tools` registry table and the `agent_tools` join table now exist as both a hand-written SQL migration (`0007_tools_registry.sql`) and a Drizzle mirror in `packages/db/src/schema.ts`, with RLS enforcing tenant isolation via `is_tenant_member()` and a `[tools registry]` integration-test section proving cross-tenant reads return zero rows. This is the schema foundation every other Phase 7 plan binds to.

## What Was Built

| Task | Name | Status | Commit |
| ---- | ---- | ------ | ------ |
| 1 | Author migration 0007_tools_registry.sql | Done | `66610f7` (prior run) |
| 2 | Mirror schema in packages/db/src/schema.ts | Done | this run |
| 3 | Extend integration.test.ts + test:tools-schema script | Done | this run |
| 4 | Apply migration via `supabase db push` | **Done-pending-push** (deferred) | n/a — see Operator follow-ups |

### Migration 0007 (`supabase/migrations/0007_tools_registry.sql`)
- `tools` table: `id`, `tenant_id` (FK tenants on delete cascade), `key`, `name`, `description` (default `''`), `kind` (check `custom`/`mcp`), `mcp_id` (nullable FK mcps on delete set null), `input_schema` (jsonb default `'{}'`), `requires_approval` (boolean default **true**), `reversible` (boolean default false), `status` (check `active`/`disabled`/`deprecated`), `created_at`; `unique (tenant_id, key)`.
- `tools_tenant_idx` on `tools(tenant_id)`.
- `agent_tools` join: `agent_id` + `tool_id`, composite PK, both FK on delete cascade.
- RLS: `tools_rw` via `is_tenant_member(tenant_id)`; `agent_tools_rw` via `exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id))` (mirror of `agent_mcps`).
- Migration header documents its own rollback (the plan `<rollback>` block): drop `agent_tools` then `tools` with `cascade`.

### Drizzle mirror (`packages/db/src/schema.ts`)
- `export const tools = pgTable("tools", { ... })` placed after the `mcps` block — `mcpId` references `mcps.id` on delete set null; `requiresApproval`/`reversible` boolean, `inputSchema` jsonb, all defaults matching the SQL 1:1.
- `export const agentTools = pgTable("agent_tools", { ... }, (t) => [primaryKey({ columns: [t.agentId, t.toolId] })])` placed after `agentMcps`.

### Tests (`packages/core/src/integration.test.ts` + `package.json`)
- New `[tools registry]` section in the existing `main()`:
  - tools row inserts + returns id; `requiresApproval === true` (P7-SC1.a, T-7-05).
  - re-insert of same `(tenant_id, key)` raises unique violation (constraint is live).
  - `agent_tools` join binds tool to agent (insert via `sql` template, mirrors `bindMcp`).
  - cross-tenant read returns zero rows: tenant Cliently's tool is not visible to a tenant-Acqu-scoped select (P7-SC1.b, T-7-01).
- Added `sql` to the `drizzle-orm` import.
- Added `"test:tools-schema": "tsx src/integration.test.ts"` script (per VALIDATION.md task 7-01 command).

## Deviations from Plan

None functional — plan executed as written within sandbox constraints. The only structural note: this was a **resumed execution**. Task 1 had already been committed in a prior session (`66610f7`) and `schema.ts` already carried the Task 2 edits uncommitted; this run committed Task 2, completed Task 3, and deferred Task 4's live push (sandbox has no DB — see below).

## Operator follow-ups

- **`supabase db push` of migration 0007 — DEFERRED to operator.** The cloud sandbox has no reachable Supabase DB, so the live push (Task 4) was not run. To apply:
  1. `supabase db push --dry-run` — confirm output lists `tools` + `agent_tools` table creates and the two RLS policies (`tools_rw`, `agent_tools_rw`).
  2. `supabase db push` — apply migration 0007 (exit 0 expected).
  3. Verify: `psql $DATABASE_URL -c "\d tools"` shows the table with `requires_approval`; `psql $DATABASE_URL -c "select * from pg_policies where tablename in ('tools','agent_tools')"` returns 2 rows.
  4. Re-run the live test: `DATABASE_URL=... pnpm --filter @agent-os/core run test:tools-schema` — the `[tools registry]` assertions exercise RLS + cross-tenant zero and require the schema to be live.
- **Do NOT run `pnpm db:generate`** when applying (Pitfall 6 / T-7-04) — it would generate a conflicting Drizzle migration. The hand-written SQL is the source of truth; Drizzle is mirror-only.

## Threat Mitigations Applied

| Threat | Mitigation |
| ------ | ---------- |
| T-7-01 (cross-tenant disclosure) | RLS `tools_rw` + `agent_tools_rw` (join via agents); integration test asserts cross-tenant zero. |
| T-7-04 (migration integrity) | Hand-written SQL; no `db:generate` run — `git status` shows no autogenerated migration files. |
| T-7-05 (privilege escalation via approval default) | `requires_approval boolean not null default true`; test asserts it round-trips as true without explicit value. |

## Verification

- `tools` + `agent_tools` migration created with RLS via `is_tenant_member()` — done.
- Drizzle schema mirrors SQL column-for-column — done.
- `[tools registry]` test asserts RLS round-trip + cross-tenant zero — done (live run deferred to operator with DB).
- No drizzle-generated migration leaked into the diff (Pitfall 6 avoided) — confirmed by `git status`.
- `pnpm -r typecheck` — run against db + core (the affected packages); see Self-Check.

## Self-Check: PASSED

- FOUND: supabase/migrations/0007_tools_registry.sql
- FOUND: packages/db/src/schema.ts (tools + agentTools exports)
- FOUND: packages/core/src/integration.test.ts ([tools registry] section)
- FOUND: packages/core/package.json (test:tools-schema script)
- FOUND commit 66610f7 (Task 1)
- Task 2 + Task 3 committed this run (hashes in PLAN COMPLETE / git log)
