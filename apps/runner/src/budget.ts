// Runner-side BudgetTracker singleton + lifecycle integration.
//
// One tracker per runner process. Each run opens at executeRun() entry
// and closes (with budget.summary emit) in a finally block. The SDK
// reports per-message cost; we synthesize a single reserve + commit
// for the run's total spend so the budget.* event stream is populated
// even though we don't pre-reserve before each LLM call (that's the
// SDK's domain and not a place we can mechanically inject).
//
// Phase 26: per-tool reserve/commit landed via dispatchCustomTool —
// tools with a per-invocation cost estimate go through reserve-before /
// commit-after at the dispatch boundary.
//
// Phase 31: optional db-backed persister survives runner restart. When
// DATABASE_URL is set, the singleton wires a Drizzle-backed persister
// over `budget_reservations` (migration 0018). Without the env var
// the tracker is in-memory only (acceptable for tests / dry-run).

import { BudgetTracker, type BudgetEvent, type ReservationPersister } from "@agent-os/core";
import { createDb, makeReservationPersister, type Db } from "@agent-os/db";

let trackerSingleton: BudgetTracker | null = null;
let cachedDb: Db | null = null;

function defaultSink(evt: BudgetEvent): void {
  // Compact one-line log so production tail | grep budget. works.
  console.log(
    `[budget] ${evt.eventName} run=${evt.runId} amount=$${evt.amountUsd.toFixed(4)} committed=$${evt.committedTotal.toFixed(4)} cap=$${evt.capUsd.toFixed(2)}`,
  );
}

function getPersister(): ReservationPersister | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (!cachedDb) cachedDb = createDb(url);
  return makeReservationPersister(cachedDb);
}

export function getBudgetTracker(): BudgetTracker {
  if (!trackerSingleton) {
    trackerSingleton = new BudgetTracker(defaultSink, getPersister());
  }
  return trackerSingleton;
}

/** Test-only: reset the singleton between tests. */
export function resetBudgetTrackerForTests(): void {
  trackerSingleton = null;
  cachedDb = null;
}
