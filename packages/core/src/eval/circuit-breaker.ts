// Real-time anomaly circuit-breaker (V2 P5).
//
// The eval scorecard runs on a ~6h cycle. That's the right cadence for durable
// autonomy promotion/demotion, but far too slow to stop an agent that just
// started failing hard — it could burn budget and do damage for hours. This
// breaker runs on EVERY run finish: it looks at the agent's last few runs and,
// on a clear anomaly (N consecutive failures, or any can't-fail event in the
// window), immediately pulls the agent to `propose` or pauses it.
//
// Two safety rules, always:
//   - The breaker NEVER ratchets autonomy UP. It only pulls down or pauses.
//   - It COMPLEMENTS the scorecard; the durable demote verdict still lands on
//     the slow cycle. The breaker is the fast circuit, not the system of record.
//
// Pure decision function + a thin sink-based runner (mirrors eval/job.ts) so the
// whole thing is unit-testable without a live DB.

import type { Autonomy } from "./controller.js";

export interface CircuitBreakerSample {
  status: "done" | "failed" | "escalated" | "skipped" | "quarantined";
  /** Number of cantfail.* events for this run. Any > 0 is the hardest signal. */
  cantfailEventCount: number;
}

export interface CircuitBreakerConfig {
  /** Trailing consecutive failed runs that trip the breaker. */
  consecutiveFailures: number;
  /** A run with >= this many cant-fail events trips immediately. */
  cantfailTrip: number;
}

export const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  consecutiveFailures: 3,
  cantfailTrip: 1,
};

export type CircuitBreakerAction = "none" | "demote_to_propose" | "pause";

export interface CircuitBreakerDecision {
  action: CircuitBreakerAction;
  tripped: boolean;
  rationale: string;
}

/**
 * Decide whether recent runs trip the breaker.
 * @param recent runs in chronological order (oldest → newest).
 */
export function evaluateCircuitBreaker(
  recent: CircuitBreakerSample[],
  currentAutonomy: Autonomy,
  config: CircuitBreakerConfig = DEFAULT_BREAKER_CONFIG,
): CircuitBreakerDecision {
  // Hardest signal: any can't-fail event in the window.
  const cantfail = recent.some((s) => s.cantfailEventCount >= config.cantfailTrip);

  // Trailing consecutive failures, counted from the newest backward.
  let streak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i]!.status === "failed") streak++;
    else break;
  }
  const failStreakTrips = streak >= config.consecutiveFailures;

  if (!cantfail && !failStreakTrips) {
    return {
      action: "none",
      tripped: false,
      rationale: `no trip: ${streak} trailing failure(s) (< ${config.consecutiveFailures}); no cant-fail event in window`,
    };
  }

  const reason = cantfail ? "cant-fail event in window" : `${streak} consecutive failed runs`;

  // Already at the floor and still tripping → pause the agent (stop the bleed).
  // Otherwise pull autonomy straight down to propose.
  if (currentAutonomy === "propose") {
    return { action: "pause", tripped: true, rationale: `${reason}; already at propose floor → pause agent` };
  }
  return { action: "demote_to_propose", tripped: true, rationale: `${reason}; pulling ${currentAutonomy} → propose` };
}

// --- Sink-based runner (DB I/O injected; testable without a live DB) ---------

export interface CircuitBreakerSink {
  /** Most recent runs for the agent, chronological (oldest → newest). */
  fetchRecent: (input: { tenantId: string; agentId: string; limit: number }) => Promise<CircuitBreakerSample[]>;
  /** Pull autonomy to propose. */
  setAutonomyPropose: (input: { tenantId: string; agentId: string; rationale: string }) => Promise<void>;
  /** Pause the agent (enabled=false) — used when it's already at propose and still tripping. */
  pauseAgent: (input: { tenantId: string; agentId: string; rationale: string }) => Promise<void>;
  /** Emit anomaly.circuit_tripped for the dashboard early-warning + audit. */
  emitTripped: (input: { tenantId: string; agentId: string; action: CircuitBreakerAction; rationale: string }) => Promise<void>;
}

export async function runCircuitBreaker(
  input: { tenantId: string; agentId: string; currentAutonomy: Autonomy; windowSize?: number; config?: CircuitBreakerConfig },
  sink: CircuitBreakerSink,
): Promise<CircuitBreakerDecision> {
  const window = input.windowSize ?? 5;
  const recent = await sink.fetchRecent({ tenantId: input.tenantId, agentId: input.agentId, limit: window });
  const decision = evaluateCircuitBreaker(recent, input.currentAutonomy, input.config ?? DEFAULT_BREAKER_CONFIG);

  if (decision.tripped) {
    if (decision.action === "demote_to_propose") {
      await sink.setAutonomyPropose({ tenantId: input.tenantId, agentId: input.agentId, rationale: decision.rationale });
    } else if (decision.action === "pause") {
      await sink.pauseAgent({ tenantId: input.tenantId, agentId: input.agentId, rationale: decision.rationale });
    }
    await sink.emitTripped({ tenantId: input.tenantId, agentId: input.agentId, action: decision.action, rationale: decision.rationale });
  }
  return decision;
}
