// Per-run mutable state for the runner — primarily an autonomy ratchet
// that downgrades a run to `propose` mid-flight when something safety-relevant
// happens (today: an injection detection from the Phase 13/15
// prompt-injection-guardrail skill).
//
// Singleton Map keyed by runId. State is cleared by clearRunState() called
// at run close — currently from executeRun's finally-ish path. If the runner
// restarts mid-run, the override is lost (the SDK will dispatch under the
// bundle's original autonomy until the next detection re-ratchets); that is
// acceptable for v1 — the injection-guard's redaction is the actual safety
// layer, the ratchet is defense-in-depth.

import type { Autonomy } from "@agent-os/core";

/** WR-09 fix: cap the per-run reasons array so a pathological loop can't
 *  grow it unbounded. The autonomy itself is idempotent (won't move below
 *  propose) so memory is the only concern. */
const MAX_RATCHET_REASONS = 20;

interface RunState {
  /** Mid-run autonomy override. If set, the PreToolUse gate uses this
   *  instead of the bundle's original autonomy for the rest of the run. */
  autonomyOverride: Autonomy | null;
  /** Audit trail — every reason a ratchet fired in this run. Capped at
   *  MAX_RATCHET_REASONS; overflow is counted in `ratchetOverflowCount`. */
  ratchetReasons: string[];
  /** Number of ratchet calls dropped after the reasons[] hit MAX. */
  ratchetOverflowCount: number;
}

const runs = new Map<string, RunState>();

function ensure(runId: string): RunState {
  let state = runs.get(runId);
  if (!state) {
    state = { autonomyOverride: null, ratchetReasons: [], ratchetOverflowCount: 0 };
    runs.set(runId, state);
  }
  return state;
}

/**
 * Downgrade the run's autonomy. Idempotent: if the run is already at or
 * below the target, this is a no-op. The override only ratchets DOWN — an
 * attempt to ratchet to a higher level than the current override (or no
 * override) is logged but ignored.
 */
export function ratchetAutonomy(runId: string, to: Autonomy, reason: string): void {
  const state = ensure(runId);
  const rank: Record<Autonomy, number> = {
    propose: 0,
    execute_safe: 1,
    execute_full: 2,
  };
  const current = state.autonomyOverride ?? "execute_full";
  if (rank[to] >= rank[current]) {
    // No-op — the ratchet doesn't go up.
    return;
  }
  state.autonomyOverride = to;
  if (state.ratchetReasons.length < MAX_RATCHET_REASONS) {
    state.ratchetReasons.push(reason);
  } else {
    state.ratchetOverflowCount++;
  }
  console.warn(
    `[runner] autonomy ratchet for run ${runId}: ${current} → ${to} (reason: ${reason})`,
  );
}

/** Read the override for a run, or null if none set. */
export function getAutonomyOverride(runId: string): Autonomy | null {
  return runs.get(runId)?.autonomyOverride ?? null;
}

/** Read the full audit trail for tests + debug. */
export function getRatchetReasons(runId: string): readonly string[] {
  return runs.get(runId)?.ratchetReasons ?? [];
}

/** Effective autonomy for a run = override if set, else fallback. */
export function effectiveAutonomy(runId: string, fallback: string): string {
  const override = getAutonomyOverride(runId);
  return override ?? fallback;
}

/** Called at run close to free state. */
export function clearRunState(runId: string): void {
  runs.delete(runId);
}

/** Test-only: clear all state. */
export function resetAllRunStateForTests(): void {
  runs.clear();
}
