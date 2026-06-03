// BudgetTracker tests.
// Run: pnpm --filter @agent-os/core test:budget

import { BudgetTracker, type BudgetEvent } from "./tracker.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const RUN = "run-test-001";

function newTracker() {
  const sunk: BudgetEvent[] = [];
  const tracker = new BudgetTracker((e) => sunk.push(e));
  return { tracker, sunk };
}

function main() {
  console.log("• Group 1 — happy path: open / reserve / commit / close");
  {
    const { tracker, sunk } = newTracker();
    tracker.openRun(RUN, 2.0);
    const r = tracker.reserveSpend(RUN, 0.5, { tool: "llm.completion" });
    assert(r.ok === true, "reserve succeeds under cap");
    assert(r.reservationId !== null, "returns a reservationId");
    assert(r.state.reservedTotal === 0.5, "reserved total = 0.5");

    const c = tracker.commitSpend(RUN, r.reservationId!, 0.42);
    assert(c.ok === true, "commit succeeds");
    assert(c.delta === 0.5 - 0.42, "delta = reserved - actual (positive = under)");
    assert(c.state.reservedTotal === 0, "reserved total cleared after commit");
    assert(Math.abs(c.state.committedTotal - 0.42) < 1e-9, "committed total = 0.42");

    const close = tracker.closeRun(RUN);
    assert(close !== null, "close returns the summary event");
    assert(close!.eventName === "budget.summary", "close emits budget.summary");

    const eventNames = sunk.map((e) => e.eventName);
    assert(eventNames[0] === "budget.reserved", "first event is reserved");
    assert(eventNames[1] === "budget.committed", "second event is committed");
    assert(eventNames[2] === "budget.summary", "third event is summary");
    assert(sunk.length === 3, `exactly 3 sink events (got ${sunk.length})`);
  }

  console.log("\n• Group 2 — release on failure clears the reserve");
  {
    const { tracker, sunk } = newTracker();
    tracker.openRun(RUN, 2.0);
    const r = tracker.reserveSpend(RUN, 0.3);
    const rel = tracker.releaseSpend(RUN, r.reservationId!);
    assert(rel.ok === true, "release succeeds");
    assert(rel.state.reservedTotal === 0, "reserved total cleared after release");
    assert(rel.state.releasedTotal === 0.3, "released total = 0.3");
    assert(rel.state.committedTotal === 0, "committed total unchanged");

    // Next reserve still works
    const r2 = tracker.reserveSpend(RUN, 0.4);
    assert(r2.ok === true, "post-release reserve succeeds");
    assert(r2.state.reservedTotal === 0.4, "reserved total = 0.4 (not 0.7 — release cleared)");

    assert(sunk.find((e) => e.eventName === "budget.released") !== undefined, "budget.released emitted");
  }

  console.log("\n• Group 3 — cap breach refuses and emits budget.cap_breached");
  {
    const { tracker, sunk } = newTracker();
    tracker.openRun(RUN, 1.0);
    const r1 = tracker.reserveSpend(RUN, 0.7);
    assert(r1.ok === true, "first reserve under cap succeeds");

    const r2 = tracker.reserveSpend(RUN, 0.5);
    assert(r2.ok === false, "second reserve that would breach cap is refused");
    assert(r2.reason === "would_breach_cap", "reason is would_breach_cap");
    assert(r2.reservationId === null, "no reservationId on refusal");

    const breach = sunk.find((e) => e.eventName === "budget.cap_breached");
    assert(breach !== undefined, "budget.cap_breached event emitted");
    assert(breach!.amountUsd === 0.5, "breach event amount = the refused amount");

    // Tracker state is unchanged — the in-flight 0.7 reservation is still live
    const snap = tracker.snapshot(RUN);
    assert(snap !== null, "snapshot present");
    assert(snap!.reservedTotal === 0.7, "reserved total stays at 0.7 — refused reserve did not land");
  }

  console.log("\n• Group 4 — multiple reservations stack and commit independently");
  {
    const { tracker } = newTracker();
    tracker.openRun(RUN, 5.0);
    const a = tracker.reserveSpend(RUN, 1.0, { call: "A" });
    const b = tracker.reserveSpend(RUN, 1.5, { call: "B" });
    const c = tracker.reserveSpend(RUN, 0.5, { call: "C" });
    assert(a.ok && b.ok && c.ok, "all 3 reserves succeed");

    const snap1 = tracker.snapshot(RUN)!;
    assert(snap1.reservedTotal === 3.0, "reserved total = 3.0 after 3 reserves");

    tracker.commitSpend(RUN, b.reservationId!, 1.3);
    const snap2 = tracker.snapshot(RUN)!;
    assert(snap2.reservedTotal === 1.5, "reserved total = 1.5 after committing B");
    assert(Math.abs(snap2.committedTotal - 1.3) < 1e-9, "committed = 1.3");

    tracker.releaseSpend(RUN, c.reservationId!);
    const snap3 = tracker.snapshot(RUN)!;
    assert(snap3.reservedTotal === 1.0, "reserved = 1.0 after releasing C");
    assert(snap3.releasedTotal === 0.5, "released = 0.5");

    tracker.commitSpend(RUN, a.reservationId!, 0.95);
    const snap4 = tracker.snapshot(RUN)!;
    assert(snap4.reservedTotal === 0, "reserved = 0 after committing A");
    assert(Math.abs(snap4.committedTotal - 2.25) < 1e-9, "committed = 2.25");
  }

  console.log("\n• Group 5 — unknown run / unknown reservation errors");
  {
    const { tracker } = newTracker();
    const r = tracker.reserveSpend("not-a-run", 0.1);
    assert(r.ok === false, "reserve on unknown run fails");
    assert(r.reason === "unknown_run", "reason = unknown_run");

    tracker.openRun(RUN, 1.0);
    const c = tracker.commitSpend(RUN, "not-a-reservation", 0.1);
    assert(c.ok === false, "commit on unknown reservation fails");
    assert(c.reason === "unknown_reservation", "reason = unknown_reservation");

    const rel = tracker.releaseSpend(RUN, "not-a-reservation");
    assert(rel.ok === false, "release on unknown reservation fails");
    assert(rel.reason === "unknown_reservation", "reason = unknown_reservation");
  }

  console.log("\n• Group 6 — cap_breached fires once per run (no spam)");
  {
    const { tracker, sunk } = newTracker();
    tracker.openRun(RUN, 0.5);
    tracker.reserveSpend(RUN, 0.4); // under cap
    tracker.reserveSpend(RUN, 0.2); // breach
    tracker.reserveSpend(RUN, 0.3); // breach (silent)
    tracker.reserveSpend(RUN, 1.0); // breach (silent)

    const breaches = sunk.filter((e) => e.eventName === "budget.cap_breached");
    assert(breaches.length === 1, `cap_breached emitted exactly once (got ${breaches.length})`);
  }

  console.log("\n• Group 7 — summary captures the final state");
  {
    const { tracker } = newTracker();
    tracker.openRun(RUN, 2.0);
    const r = tracker.reserveSpend(RUN, 0.5);
    tracker.commitSpend(RUN, r.reservationId!, 0.4);
    const close = tracker.closeRun(RUN)!;
    assert(close.committedTotal === 0.4, "summary.committedTotal = 0.4");
    assert(close.reservedTotal === 0, "summary.reservedTotal = 0");
    assert(close.capUsd === 2.0, "summary.capUsd = 2.0");
    assert(
      (close.metadata?.capUtilizationPct as number) === 20,
      "metadata.capUtilizationPct = 20 (0.4 / 2.0 = 20%)",
    );

    // After close, the run is forgotten
    assert(tracker.snapshot(RUN) === null, "snapshot after close is null");
    assert(tracker.hasRun(RUN) === false, "hasRun after close is false");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
