---
phase: 09-tenant-isolation-tester-secrets-rotation-external-launch-gat
plan: 06
subsystem: batch-seed-runner + hard-gate-verify-script + manifest
tags: [batch-seed, hard-gate, isolation-live, t-critical-guard, operator-checkpoints]
requires: [09-04 (4 tool seeds), 09-05 (4 T-critical agent seeds)]
provides:
  - scripts/seed/seed-phase-9.ts (idempotent batch runner; T-critical hard-fail guard; tool seeds precede agent seeds per S8)
  - scripts/verify/isolation-live.ts (HARD GATE #2 entry point; D-01 env check; exit code = gate status)
  - scripts/verify/package.json + tsconfig.json (new @agent-os/verify workspace)
  - docs/acqu-phase-9-agent-manifest.md (operator manifest; HARD GATE #2 callout; Open Q #1 exemption disclosure)
  - 2 new root pnpm scripts: seed:phase-9, verify:isolation-live
  - pnpm-workspace.yaml extended to include scripts/verify
affects: [Phase 10 unblocked once Task 5 gate-pass returned]
tech-stack:
  added: ["@agent-os/verify workspace (new)"]
  patterns: [seed-phase-4 batch runner template, browser-smoke verify-script shape, phase-4 manifest template]
key-files:
  created:
    - scripts/seed/seed-phase-9.ts
    - scripts/verify/isolation-live.ts
    - scripts/verify/package.json
    - scripts/verify/tsconfig.json
    - docs/acqu-phase-9-agent-manifest.md
  modified:
    - scripts/seed/package.json
    - package.json (root)
    - pnpm-workspace.yaml
decisions:
  - "seed-phase-9 hard-fail guard checks all 4 spec.model literals === 'anthropic/claude-opus-4.8' BEFORE createDb. Defense-in-depth catch for PR drift; the seedAgent-level exemption (per Open Q #1 RESOLVED) and the runtime cantfail.model_violation assertion are the primary defenses."
  - "Tool seeds (4) run BEFORE agent seeds (4) per S8 — agent bindings need registry rows to exist."
  - "Manifest documents the Open Q #1 (RESOLVED) exemption disclosure explicitly: even with tenant default_model_override set to Hermes, the 4 T-critical agents in this phase IGNORE the override at seed time AND at runtime."
  - "scripts/verify is a new workspace (was not in pnpm-workspace.yaml). Added next to scripts/seed."
metrics:
  duration: ~25m (autonomous tasks)
  completed_autonomous: 2026-06-01
  pending_operator_checkpoints: 3 (Task 3 db-push, Task 4 seed-run, Task 5 HARD GATE)
requirements: [SC-9-1, SC-9-6]
---

# Phase 9 Plan 06: Batch Runner + Hard-Gate Verify + Manifest Summary

The Phase 9 close-out: the autonomous deliverables for the batch seed runner, the HARD GATE #2 verification script, and the operator manifest are shipped. Three operator-action checkpoints remain — they require the live Supabase data plane this sandbox cannot reach.

## What Shipped (Autonomous)

### Task 1: `scripts/seed/seed-phase-9.ts`

The idempotent batch runner. Mirrors `seed-phase-4.ts` shape exactly — same hard-fail guard pattern, same eyeball table, same `padEnd` column structure.

- **T-critical hard-fail guard** (lines 41-50): iterates all 4 specs, asserts `spec.model === "anthropic/claude-opus-4.8"`, throws BEFORE `createDb` if any drift. Error message cites CLAUDE.md can't-fail list + Open Q #1 RESOLVED disclosure.
- **Ordering** (S8): 4 `seedTool*()` calls run BEFORE 4 `seedAgent(db, spec)` calls. Verified by inline grep gate: `seedToolRlsTest` index < `seedAgent(db, spec` index.
- **Eyeball table**: 4 rows with `⚠ T-CRITICAL` tag. Bindings section shows `tools=[...] skills=[...] mcps=[...]` per agent.
- **Closing handoff**: prints `HARD GATE #2` reminder + the Open Q #1 disclosure ("If override is set, T-critical agents IGNORE it; non-critical tiers still rewrite").

Wired in `scripts/seed/package.json`: `"phase-9": "tsx seed-phase-9.ts"`. Root pnpm script: `seed:phase-9 → pnpm --filter @agent-os/seed run phase-9`.

### Task 2: `scripts/verify/isolation-live.ts` + manifest

The HARD GATE #2 entry point. Composed against `runIsolationSuite` from `@agent-os/tool-rls-test`.

- **D-01 env checks** (lines 24-32): hard-fail if `RLS_TEST_DATABASE_URL`, `RLS_TEST_USER_A`, `RLS_TEST_USER_B` are unset. Error messages cite Pitfall 1 (service-role would false-pass).
- **Bidirectional tenantPairs**: `(acqu, cliently)` AND `(cliently, acqu)` — catches asymmetric policy gaps where one direction is locked but the other leaks.
- **Exit code = gate status**: exit 0 on `result.passed === true`; exit 1 on fail with results.json path printed for triage.
- **`HARD GATE PASSED` / `HARD GATE FAILED` log line**: the operator-attachable audit trail.

New workspace `@agent-os/verify` added to `pnpm-workspace.yaml`. `pnpm --filter @agent-os/verify typecheck` green. Root pnpm script: `verify:isolation-live`.

Manifest doc `docs/acqu-phase-9-agent-manifest.md`:
- Hard tier lock callout: all 4 / 4 T-critical (vs 7 / 22 in Phase 4).
- Tools table (4 rows) + Agents table (4 rows).
- Tier overrides vs. doctrine: explicit Open Q #1 RESOLVED disclosure — T-critical agents ignore `default_model_override` at both seed and runtime; an `anthropic/claude-opus-4.8` row regardless of override state is the correct expectation.
- HARD GATE #2 section: pass criteria, false-pass detection rules, failure routing.

## Verification (Autonomous tasks)

- `pnpm --filter @agent-os/seed typecheck` — green.
- `pnpm --filter @agent-os/verify typecheck` — green.
- `pnpm -r typecheck` — all 14 packages green (new `@agent-os/verify` included).
- All Task 1 + Task 2 plan verify grep gates: OK (keys+guard present; opus literal in guard; script wired; ordering correct; D-01 env check present; manifest contains all 7 required terms; root pnpm script resolves).

## Pending Operator Checkpoints

The three `[BLOCKING]` gates from 09-06-PLAN.md remain. They cannot be executed from this sandbox; they require the live Supabase data plane + a non-service-role connection + 2 pre-seeded tenants.

### [BLOCKING] Task 3 — `supabase db push` for migration 0010

Migration `supabase/migrations/0010_security_findings.sql` (from 09-01) was authored but not pushed (sandbox has no DB connection — precedent set in Phase 7 with 0007 + 0008). The migration creates `security_findings` + `audit_log_tenant_ts_idx` + the policy.

**Operator runs:**
```bash
supabase db push
psql "$DATABASE_URL" -c "select tablename from pg_tables where schemaname='public' and tablename='security_findings';"
psql "$DATABASE_URL" -c "select indexname from pg_indexes where tablename='audit_log' and indexname='audit_log_tenant_ts_idx';"
psql "$DATABASE_URL" -c "select policyname from pg_policies where tablename='security_findings';"
```

Each query should return 1 row.

### [BLOCKING] Task 4 — `pnpm seed:phase-9` against live DB

Prerequisites:
- Task 3 complete (table + index + policy verified).
- `DATABASE_URL` set to the SAME live Supabase used in Task 3.
- `AOS_VAULT_KEY` set.
- (Optional) Decide whether to clear `tenants.default_model_override` for the Acqu tenant. Per Open Q #1 RESOLVED, the T-critical agents will land at `claude-opus-4.8` regardless. Clearing the override (`update tenants set default_model_override = null where id = ...;`) cleans up the non-critical tier rewrites if desired.

**Operator runs:**
```bash
pnpm seed:phase-9 2>&1 | tee /tmp/seed-phase-9-$(date +%s).log
psql "$DATABASE_URL" -c "select key, model from agents where key in ('tenant-isolation-tester','secrets-rotation','access-auditor','security-anomaly-watchdog') order by key;"
psql "$DATABASE_URL" -c "select key, requires_approval from tools where key in ('tool.rls-test','tool.vault-rotate','tool.access-audit','tool.access-log-analyzer') order by key;"
```

Expected: exit 0; no `HARD FAIL` line; 4 tool seeds + 4 agent seeds; eyeball table renders; 4 agent rows show `claude-opus-4.8`; `tool.vault-rotate` shows `requires_approval=true` and the other 3 show `false`. Re-running is safe (idempotent).

### [BLOCKING] Task 5 — HARD GATE #2 — `pnpm verify:isolation-live`

Prerequisites:
- Task 4 complete.
- `RLS_TEST_DATABASE_URL` set to a Supabase **`authenticated`-role** connection (NOT service-role).
- `RLS_TEST_USER_A` = user UUID, member of `tenants.acqu`.
- `RLS_TEST_USER_B` = user UUID, member of `tenants.cliently`.
- At least 1 row per tenant in every RLS-protected table (positive controls need data to return).

**Operator runs:**
```bash
pnpm verify:isolation-live
```

Expected:
```
HARD GATE: passed=true count=20+ resultsPath=/tmp/tool-rls-test-XXX/results.json
HARD GATE PASSED — Phase 10 unblocked.
```
Exit code 0.

If exit code 1: inspect `results.json` for vectors with `actual > 0` (cross-tenant leaks); fix the RLS policy on the named table via a new migration; re-run from Task 3.

## Phase 10 Status

**BLOCKED on operator Tasks 3-5.** Once Task 5 returns gate-pass, Phase 10 (external launch / GenX deltas per `docs/plans/GENX-PLAN.md`) is unblocked from the security side. The other launch gates — Relay P0 (step 2 in the execution order), AGENTS gap closers (step 3), CRA blocklist (in step 4) — remain pending.

## What's Next

Once operator confirms Task 5 gate-pass:

1. Phase 9 closes. The 4 T-critical agents + 4 deterministic tools are live.
2. **Step 2 — Relay P0**: ship `relay_events` + `run_summaries` migrations, the SessionEnd composer, the 4-table coexist-and-mirror writers. Per `docs/plans/AGENT-OS-PLAN.md` §8. Includes the seedAgent T-critical override exemption + the runtime `cantfail.model_violation` assertion (Open Q #1 RESOLVED implementation contract).
3. **Step 3 — AGENTS gap closers**: ship the 2 missing SKILL.md files (`verification-before-completion`, `clarify-before-acting` — referenced by 50+ agents), replace the `ad-ops` doctrine-numbered tool literals (`tool.1` / `tool.4` / `tool.17`) with real registry keys, decide `offer-architect` / `offer-validator` (ship or remove from can't-fail).
4. **Step 4 — GenX deltas**: `tenants` column additions, `/relay/ingest` endpoint + Pixel SDK contract, CRA blocklist implementation (`packages/core/src/architect/cra-blocklist.ts` + `assertNotCraProhibited` + `architect.refused` + `cantfail.cra_violation` per `docs/plans/GENX-PLAN.md` Open Q #8 RESOLVED), free-tier cap enforcement.

Hard rule from the plans: step 2 (Relay) lands BEFORE any step-4 tenant path lights up.
