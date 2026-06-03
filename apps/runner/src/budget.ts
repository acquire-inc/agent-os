// Runner-side BudgetTracker singleton + lifecycle integration.
//
// One tracker per runner process. Each run opens at executeRun() entry
// and closes (with budget.summary emit) in a finally block. The SDK
// reports per-message cost; we synthesize a single reserve + commit
// for the run's total spend so the budget.* event stream is populated
// even though we don't pre-reserve before each LLM call (that's the
// SDK's domain and not a place we can mechanically inject).
//
// Per-tool reserve/commit (for paid deterministic tools like
// tool.browser) is a follow-up phase — needs a per-tool cost estimate
// table that doesn't exist today.
//
// BudgetEventSink emits to console for now; Relay emit lands when the
// runner-tenant-context wiring is solid.

import { BudgetTracker, type BudgetEvent } from "@agent-os/core";

let trackerSingleton: BudgetTracker | null = null;

function defaultSink(evt: BudgetEvent): void {
  // Compact one-line log so production tail | grep budget. works.
  console.log(
    `[budget] ${evt.eventName} run=${evt.runId} amount=$${evt.amountUsd.toFixed(4)} committed=$${evt.committedTotal.toFixed(4)} cap=$${evt.capUsd.toFixed(2)}`,
  );
}

export function getBudgetTracker(): BudgetTracker {
  if (!trackerSingleton) {
    trackerSingleton = new BudgetTracker(defaultSink);
  }
  return trackerSingleton;
}

/** Test-only: reset the singleton between tests. */
export function resetBudgetTrackerForTests(): void {
  trackerSingleton = null;
}
