# Phase 31 — DB-backed budget reservations

**Triggered by:** Phase 16 documented "in-flight reserves lost on runner restart" as acceptable v1; this phase ships the v2 persistence.
**Status:** complete

## Delivered

- `supabase/migrations/0018_budget_reservations.sql` — `budget_reservations` table + RLS via `is_tenant_member()`
- `packages/db/src/schema.ts` — Drizzle `budgetReservations` table mirrors
- `packages/db/src/budget-persister.ts` — `makeReservationPersister(db)` factory exposing `insert / remove / listForRun`
- `packages/db/src/index.ts` — re-exports `makeReservationPersister`
- `packages/core/src/budget/tracker.ts`:
  - `ReservationPersister` interface (now exported from `@agent-os/core`)
  - `BudgetTracker` accepts an optional persister; write-through on reserve/commit/release
  - `setRunTenant(runId, tenantId)` — caller-provided context for persister calls
  - `hydrateRun(runId)` — async re-hydration from the persister on runner boot
  - Sequence counter advances past the highest hydrated `:rN` so new reservations don't collide
- `apps/runner/src/budget.ts` — singleton wires the Drizzle-backed persister when `DATABASE_URL` is set
- `apps/runner/src/execute.ts` — after `openRun`, calls `setRunTenant` + `hydrateRun` (best-effort; logs on failure)

## Tests

`packages/core/src/budget/tracker.test.ts` — Phase 31 group adds 6 assertions across 2 groups:
- Persister write-through on reserve/commit/release (2 inserts + 2 removes for a reserve→commit + reserve→release pair)
- `hydrateRun` rebuilds `reservedTotal` from a stubbed persister; subsequent reserve receives a sequence number past the hydrated max

## Operator gate

`supabase db push` — migration 0018 must be applied. After push:
- Existing runs are unaffected (the table only gains new rows)
- A runner restart mid-run re-hydrates in-flight reservations and resumes cap enforcement from the prior state

## Acceptance ✓

- `test:budget` → 57 passed (was 51)
- All 17 core suites + 5 runner suites still green
- Typecheck clean across core / db / runner / api / inngest
