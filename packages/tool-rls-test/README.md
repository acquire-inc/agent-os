# @agent-os/tool-rls-test

The hard-gate RLS test harness for Phase 9. Runs cross-tenant query attacks against every RLS-protected table, with positive controls to prove the wiring is real.

## D-01 — required env (READ THIS BEFORE RUNNING)

This package's `asUser(db, userId, fn)` helper impersonates a tenant via the GUC `request.jwt.claim.sub` (the same GUC `is_tenant_member()` consults via `auth.uid()`).

**The Postgres connection used MUST be a non-service-role connection.** Service-role bypasses RLS by design — a passing test against service-role is meaningless.

Set `RLS_TEST_DATABASE_URL` to a Supabase authenticated-role connection string. **Never re-use `DATABASE_URL`** (which is service-role for the API + runner). Two distinct envs by design.

## Pitfall 5 — false pass signal

If you see "100% pass in milliseconds" AND "positive controls returned 0", your connection is service-role and the test is lying to you. Every vector in `ATTACK_VECTORS` runs a positive control FIRST — if the positive control fails (returns 0 when it should return ≥1), the vector throws. This is the wiring proof: a vector that says "passed" without exercising the positive control is broken.

## What it tests

`ATTACK_VECTORS` is an `Object.freeze([...])` registry, one entry per RLS-protected table. Each vector:
1. As `tenantB.userB`, reads from the table → asserts ≥1 row (positive control).
2. As `tenantA.userA`, attempts to read `tenantB`'s rows → asserts 0 rows (the RLS test).
3. Returns `{ id, table, passed, actual, expected }`.

The registry is **append-only forever** — `assertVectorsAppendOnly()` throws if a PR shrinks it. New tenant-scoped tables must add a new `AV-NNN` entry.

## Usage

```ts
import { createDb } from "@agent-os/db";
import { runIsolationSuite } from "@agent-os/tool-rls-test";

if (!process.env.RLS_TEST_DATABASE_URL) {
  throw new Error("RLS_TEST_DATABASE_URL required (authenticated-role; NOT service-role)");
}
const db = createDb(process.env.RLS_TEST_DATABASE_URL);

const result = await runIsolationSuite({
  tenantPairs: [
    { userA: "...uuid", userB: "...uuid", tenantA: "...uuid", tenantB: "...uuid" },
  ],
}, { db });

console.log(`passed=${result.passed} count=${result.count} results=${result.resultsPath}`);
if (!result.passed) process.exit(1);
```

The result envelope is written to a file (CLAUDE.md non-negotiable #4 — never return large blobs); the function returns the path.
