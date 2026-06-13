# Migration Rollback Notes

**Audience:** the operator running `supabase db push` for the first time, and
anyone needing to undo a migration in a controlled way.

> All migrations 0001–0029 are **additive**: they add columns, tables,
> indexes, materialized views, RLS policies, and helper functions. None
> drops a column or table. Rollback is therefore the inverse of each
> migration — drop what it added, in reverse dependency order. Verified
> 2026-06-13.
>
> If you discover a destructive migration in this file, file an issue
> immediately — that would violate the platform's additive-migration
> invariant.

## How to use this file

1. Identify the migration you want to roll back (e.g. `0027`).
2. Run the matching block below against the same Supabase database (psql).
3. Update `supabase_migrations` to mark it un-applied (or delete the row,
   depending on your migration tracker setup).

Always run rollbacks **in reverse order** if rolling back multiple. The
ordering below matches the dependency chain — rollbacks of later
migrations come first because they may depend on earlier objects.

---

## 0030 — agent_handoffs (V2 P7)

```sql
DROP INDEX IF EXISTS agent_handoffs_tenant_idx;
DROP INDEX IF EXISTS agent_handoffs_to_agent_idx;
DROP INDEX IF EXISTS agent_handoffs_from_run_idx;
DROP INDEX IF EXISTS agent_handoffs_objective_idx;
DROP TABLE IF EXISTS agent_handoffs;
```

## 0029 — agent_leases (V2 / I-003)

```sql
DROP INDEX IF EXISTS agent_leases_expiry_idx;
DROP INDEX IF EXISTS agent_leases_owner_run_idx;
DROP INDEX IF EXISTS agent_leases_one_active_per_target;
DROP TABLE IF EXISTS agent_leases;
```

## 0028 — critic_votes + approvals columns (V2 P6)

```sql
DROP INDEX IF EXISTS critic_votes_tenant_idx;
DROP INDEX IF EXISTS critic_votes_approval_idx;
DROP TABLE IF EXISTS critic_votes;
ALTER TABLE approvals DROP COLUMN IF EXISTS escalated;
ALTER TABLE approvals DROP COLUMN IF EXISTS decided_via;
```

## 0027 — agent_improvement_proposals (V2 P4)

```sql
DROP INDEX IF EXISTS agent_improvement_proposals_tenant_idx;
DROP INDEX IF EXISTS agent_improvement_proposals_agent_idx;
DROP INDEX IF EXISTS agent_improvement_proposals_pending_idx;
DROP TABLE IF EXISTS agent_improvement_proposals;
```

## 0026 — objectives + runs.objective_id/attempt_number (V2 P3)

```sql
DROP INDEX IF EXISTS runs_objective_id_attempt_idx;
ALTER TABLE runs DROP COLUMN IF EXISTS attempt_number;
ALTER TABLE runs DROP COLUMN IF EXISTS objective_id;
DROP INDEX IF EXISTS objectives_agent_id_status_idx;
DROP INDEX IF EXISTS objectives_tenant_id_idx;
DROP TABLE IF EXISTS objectives;
```

## 0025 — tenant_monthly_spend (Phase 53)

```sql
DROP FUNCTION IF EXISTS tenant_month_to_date_usd(UUID);
DROP INDEX IF EXISTS tenant_monthly_spend_pk;
DROP MATERIALIZED VIEW IF EXISTS tenant_monthly_spend;
```

## 0024 — skills.cost_estimate_usd (Phase 52)

```sql
ALTER TABLE skills DROP COLUMN IF EXISTS cost_estimate_usd;
```

## 0023 — artifacts (Phase 47)

```sql
DROP INDEX IF EXISTS artifacts_tenant_kind_idx;
DROP INDEX IF EXISTS artifacts_agent_idx;
DROP INDEX IF EXISTS artifacts_run_idx;
DROP TABLE IF EXISTS artifacts;
```

## 0022 — model_feedback_proposals (Phase 45)

```sql
DROP INDEX IF EXISTS model_feedback_proposals_model_idx;
DROP INDEX IF EXISTS model_feedback_proposals_pending_idx;
DROP TABLE IF EXISTS model_feedback_proposals;
```

## 0021 — skills/tools.task_profile (Phase 40)

```sql
ALTER TABLE tools  DROP COLUMN IF EXISTS task_profile;
ALTER TABLE skills DROP COLUMN IF EXISTS task_profile;
```

## 0020 — models catalog (Phase 38)

```sql
DROP INDEX IF EXISTS models_enabled_idx;
DROP INDEX IF EXISTS models_tier_affinity_idx;
DROP INDEX IF EXISTS models_provider_idx;
DROP TABLE IF EXISTS models;
```

## 0019 — skills/tools.preferred_model_tier (Phase 32)

```sql
ALTER TABLE tools  DROP COLUMN IF EXISTS preferred_model_tier;
ALTER TABLE skills DROP COLUMN IF EXISTS preferred_model_tier;
```

## 0018 — budget_reservations (Phase 31)

```sql
DROP INDEX IF EXISTS budget_reservations_run_idx;
DROP TABLE IF EXISTS budget_reservations;
```

## 0017 — tenants.scorecard_thresholds (Phase 27)

```sql
ALTER TABLE tenants DROP COLUMN IF EXISTS scorecard_thresholds;
```

## 0016 — tools.cost_estimate_usd (Phase 26)

```sql
ALTER TABLE tools DROP COLUMN IF EXISTS cost_estimate_usd;
```

## 0015 — agents.model default (Phase 14)

```sql
-- Restore prior default. Adjust to your previous value if different.
ALTER TABLE agents ALTER COLUMN model DROP DEFAULT;
```

## 0014 — agent_scorecards (Phase 20)

```sql
DROP VIEW IF EXISTS agent_scorecards_xtenant_agg;
DROP INDEX IF EXISTS agent_scorecards_unapplied_idx;
DROP INDEX IF EXISTS agent_scorecards_tenant_agent_idx;
DROP TABLE IF EXISTS agent_scorecards;
```

---

## Safety notes

- **All migrations use `IF NOT EXISTS`** so re-running a migration after
  rollback is safe.
- **Data loss on rollback** is implicit: dropping a table loses any rows in
  that table. Tables added by 0014–0029 hold derived/operational data
  (scorecards, proposals, leases, reservations) — not customer business
  data — so the cost of rollback is observability, not customer impact.
- **Materialized view rollback (0025)** drops the cached aggregate but
  doesn't touch the underlying `relay_events` rows; you can re-create the
  view at any time.
- **The cant-fail invariant is NOT in a migration.** It's pinned in
  application code (`packages/core/src/architect/hydrate.ts` and runner
  guards). Rolling back a migration does not weaken cant-fail.

## Adding a new migration

If you add migration 0030 or later, also:

1. Append its rollback block here, BEFORE 0029 (reverse order).
2. Confirm the launch-check still passes:
   ```bash
   pnpm launch:check
   ```
3. Update the standing-gate row in `.planning/PLATFORM.md` if the
   migration count changes the displayed text.
