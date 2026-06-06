// Phase 37 integration test: BudgetTracker re-hydration after runner restart.
//
// Simulates a runner process boundary by:
//   1. Tracker A opens a run, reserves N items, commits some, leaves K
//      uncommitted in-flight.
//   2. We discard tracker A (simulates process restart).
//   3. Tracker B (fresh instance with the same persister) opens the run
//      and calls hydrateRun. The K in-flight reservations come back.
//   4. New reserves get sequence numbers past the highest hydrated :rN.
//   5. Cap math accounts for the hydrated total — a fresh reserve that
//      would breach the cap after hydration is correctly refused.
//
// Uses an in-memory stub of the ReservationPersister so this test has no
// DB dependency. The same logic exercises makeReservationPersister() over
// Drizzle when DATABASE_URL is set.
//
// Run: pnpm --filter @agent-os/core test:hydrate-restart

import { BudgetTracker, type ReservationPersister } from "./tracker.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

/** Shared in-memory store — simulates the budget_reservations table
 *  across the simulated process boundary. */
function makeSharedPersister() {
  const rows = new Map<string, { amountUsd: number; tenantId: string; runId: string }>();
  const persister: ReservationPersister = {
    insert: async (args) => {
      rows.set(args.id, { amountUsd: args.amountUsd, tenantId: args.tenantId, runId: args.runId });
    },
    remove: async (id) => {
      rows.delete(id);
    },
    listForRun: async (runId) =>
      [...rows.values()].length === 0
        ? []
        : [...rows.entries()]
            .filter(([, r]) => r.runId === runId)
            .map(([id, r]) => ({ id, amountUsd: r.amountUsd })),
  };
  return { persister, rows };
}

const RUN = "run-hydrate-001";
const TENANT = "tenant-1";

async function main() {
  console.log("• Group 1 — in-flight reservations re-hydrate across a process boundary");
  {
    const { persister, rows } = makeSharedPersister();

    // === Tracker A: simulated process #1 ===
    const trackerA = new BudgetTracker(() => {}, persister);
    trackerA.openRun(RUN, 2.0);
    trackerA.setRunTenant(RUN, TENANT);

    const a = trackerA.reserveSpend(RUN, 0.4);
    const b = trackerA.reserveSpend(RUN, 0.3);
    const c = trackerA.reserveSpend(RUN, 0.5);
    trackerA.commitSpend(RUN, b.reservationId!, 0.25); // commit b
    // a and c are still in-flight; reserved total in tracker A = 0.4 + 0.5 = 0.9

    // Give the fire-and-forget persister writes a tick.
    await new Promise((r) => setImmediate(r));

    assert(rows.size === 2, `2 rows persisted (a + c after b's commit-delete) — got ${rows.size}`);

    // === Drop tracker A entirely (simulates process restart). ===
    void trackerA;

    // === Tracker B: simulated process #2 with the same persister ===
    const trackerB = new BudgetTracker(() => {}, persister);
    trackerB.openRun(RUN, 2.0);
    trackerB.setRunTenant(RUN, TENANT);
    const hydration = await trackerB.hydrateRun(RUN);
    assert(hydration?.rehydratedCount === 2, `hydrated 2 reservations (got ${hydration?.rehydratedCount})`);

    const snap = trackerB.snapshot(RUN);
    assert(
      Math.abs((snap?.reservedTotal ?? 0) - 0.9) < 1e-9,
      `reservedTotal rehydrated to 0.9 (got ${snap?.reservedTotal})`,
    );
    assert(snap?.committedTotal === 0, "committedTotal stays 0 on hydration (sourced from runs.cost_usd by caller)");

    // === New reserves get sequence past the hydrated max ===
    const d = trackerB.reserveSpend(RUN, 0.1);
    assert(
      d.reservationId !== a.reservationId && d.reservationId !== c.reservationId,
      "new reservation id != hydrated ids",
    );
    // The hydrated max from a/c was r3 (a=r1, b=r2, c=r3). Next should be r4.
    assert(d.reservationId?.endsWith(":r4"), `next reservation seq = r4 (got ${d.reservationId})`);
  }

  console.log("\n• Group 2 — cap math respects hydrated total: post-hydration breach is refused");
  {
    const { persister, rows } = makeSharedPersister();

    const trackerA = new BudgetTracker(() => {}, persister);
    trackerA.openRun(RUN, 1.0);
    trackerA.setRunTenant(RUN, TENANT);

    trackerA.reserveSpend(RUN, 0.4);
    trackerA.reserveSpend(RUN, 0.4);
    // committed=0, reserved=0.8, cap=1.0
    await new Promise((r) => setImmediate(r));
    assert(rows.size === 2, "2 reservations persisted");

    void trackerA;

    const trackerB = new BudgetTracker(() => {}, persister);
    trackerB.openRun(RUN, 1.0);
    trackerB.setRunTenant(RUN, TENANT);
    await trackerB.hydrateRun(RUN);

    // Another 0.3 would push reserved to 1.1 > cap 1.0 — should be refused.
    const blocked = trackerB.reserveSpend(RUN, 0.3);
    assert(blocked.ok === false, "post-hydration reserve that breaches cap is refused");
    assert(blocked.reason === "would_breach_cap", "reason = would_breach_cap");

    // A 0.2 would push reserved to 1.0 — exactly at cap, allowed.
    const allowed = trackerB.reserveSpend(RUN, 0.2);
    assert(allowed.ok === true, "post-hydration reserve at-cap is allowed");
  }

  console.log("\n• Group 3 — empty persister hydration is a no-op");
  {
    const { persister } = makeSharedPersister();
    const tracker = new BudgetTracker(() => {}, persister);
    tracker.openRun(RUN, 1.0);
    tracker.setRunTenant(RUN, TENANT);
    const hydration = await tracker.hydrateRun(RUN);
    assert(hydration?.rehydratedCount === 0, "empty hydration returns 0");
    const snap = tracker.snapshot(RUN);
    assert(snap?.reservedTotal === 0, "no rehydrated reserved total");
    // Sequence counter should still start at r1.
    const first = tracker.reserveSpend(RUN, 0.1);
    assert(first.reservationId?.endsWith(":r1"), `first reservation is r1 (got ${first.reservationId})`);
  }

  console.log("\n• Group 4 — without a persister, hydrateRun returns null (no-op)");
  {
    const tracker = new BudgetTracker(); // no sink, no persister
    tracker.openRun(RUN, 1.0);
    const hydration = await tracker.hydrateRun(RUN);
    assert(hydration === null, "no persister -> hydrateRun returns null");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
