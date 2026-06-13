// Autonomous manager (V2 P8).
//
// Today an operator spawns, pauses, and retires agents by hand via the
// control plane. The autonomous manager codifies the same decisions as a
// PURE function over fleet metrics so the same logic can run on a schedule
// without an operator in the chair — within strict guardrails:
//
//   - Manager can PAUSE an agent that's burning budget or repeatedly
//     failing.
//   - Manager can RETIRE an agent that's been paused for N days and
//     produced no recent value.
//   - Manager NEVER spawns can't-fail agents — those land via doctrine
//     seeds with human review.
//   - Manager NEVER pauses or retires a can't-fail agent — operator only.
//   - Manager actions are CAPPED per cycle (default 3 / tenant / cycle) so
//     a metric blip can't shut down the fleet.
//   - Every action is proposed first, then applied — same operator-review
//     queue pattern as model_feedback_proposals and
//     agent_improvement_proposals.
//
// Pure decision + sink runner. Mirrors objective.ts / improve.ts /
// critic.ts / a2a.ts / lease.ts.

export type ManagerActionKind = "pause" | "retire" | "no_op";

export interface AgentFleetSample {
  agentId: string;
  agentKey: string;
  /** Whether the agent is currently enabled. */
  enabled: boolean;
  /** Hours since the agent was last paused; null if not paused. */
  hoursSincePaused: number | null;
  /** Hours since the agent's last successful run; null if never. */
  hoursSinceLastSuccess: number | null;
  /** Trailing 24h success rate (0..1); null when sample too small. */
  trailingSuccessRate: number | null;
  /** Trailing 24h spend (USD). */
  trailingSpendUsd: number;
  /** Tenant monthly budget cap — null if uncapped. */
  tenantMonthlyBudgetUsd: number | null;
  /** Fraction of tenant monthly budget this agent consumed (0..1). */
  monthlySpendShare: number;
  /** Whether the agent is on CANT_FAIL_KEYS. Caller-passed (same
   *  convention as router/resolve.ts). */
  isCantFail: boolean;
}

export interface ManagerPolicy {
  /** Max actions proposed per cycle per tenant. */
  maxActionsPerCycle: number;
  /** Pause when trailing success rate falls below this AND sample large. */
  pauseSuccessRateFloor: number;
  /** Pause when one agent eats more than this fraction of tenant budget. */
  pauseBudgetShareCap: number;
  /** Retire when paused for at least this many hours AND no recent success. */
  retireMinHoursPaused: number;
  /** Retire only if no successful run in at least this many hours. */
  retireMinHoursSinceSuccess: number;
}

export const DEFAULT_MANAGER_POLICY: ManagerPolicy = {
  maxActionsPerCycle: 3,
  pauseSuccessRateFloor: 0.5,
  pauseBudgetShareCap: 0.4,
  retireMinHoursPaused: 24 * 14, // two weeks paused
  retireMinHoursSinceSuccess: 24 * 30, // a month with no success
};

export interface ManagerAction {
  kind: Exclude<ManagerActionKind, "no_op">;
  agentId: string;
  agentKey: string;
  rationale: string;
}

/** Per-agent decision — pure, no DB. */
export function decideManagerAction(
  sample: AgentFleetSample,
  policy: ManagerPolicy = DEFAULT_MANAGER_POLICY,
): { kind: ManagerActionKind; rationale: string } {
  // Cant-fail agents are operator-only.
  if (sample.isCantFail) {
    return { kind: "no_op", rationale: "cant-fail agent — operator only" };
  }
  // Pause path runs against ENABLED agents only.
  if (sample.enabled) {
    if (sample.trailingSuccessRate !== null && sample.trailingSuccessRate < policy.pauseSuccessRateFloor) {
      return {
        kind: "pause",
        rationale: `trailing success rate ${(sample.trailingSuccessRate * 100).toFixed(0)}% < ${(policy.pauseSuccessRateFloor * 100).toFixed(0)}% floor`,
      };
    }
    if (sample.monthlySpendShare > policy.pauseBudgetShareCap) {
      return {
        kind: "pause",
        rationale: `consumed ${(sample.monthlySpendShare * 100).toFixed(0)}% of tenant monthly budget (cap ${(policy.pauseBudgetShareCap * 100).toFixed(0)}%)`,
      };
    }
    return { kind: "no_op", rationale: "metrics within policy" };
  }
  // Retire path runs against PAUSED agents.
  if (
    sample.hoursSincePaused !== null &&
    sample.hoursSincePaused >= policy.retireMinHoursPaused &&
    (sample.hoursSinceLastSuccess === null || sample.hoursSinceLastSuccess >= policy.retireMinHoursSinceSuccess)
  ) {
    return {
      kind: "retire",
      rationale: `paused ${sample.hoursSincePaused.toFixed(0)}h, no success in ${
        sample.hoursSinceLastSuccess === null ? "ever" : `${sample.hoursSinceLastSuccess.toFixed(0)}h`
      } — retire`,
    };
  }
  return { kind: "no_op", rationale: "paused but not yet eligible for retirement" };
}

/** Fleet-level decision: per-agent + per-cycle cap. */
export function planManagerCycle(
  samples: readonly AgentFleetSample[],
  policy: ManagerPolicy = DEFAULT_MANAGER_POLICY,
): ManagerAction[] {
  const proposals: ManagerAction[] = [];
  // Prioritize pause over retire so an active threat is dealt with first
  // when the cap is binding.
  const pauseCandidates: ManagerAction[] = [];
  const retireCandidates: ManagerAction[] = [];

  for (const s of samples) {
    const d = decideManagerAction(s, policy);
    if (d.kind === "no_op") continue;
    const entry: ManagerAction = { kind: d.kind, agentId: s.agentId, agentKey: s.agentKey, rationale: d.rationale };
    if (d.kind === "pause") pauseCandidates.push(entry);
    else retireCandidates.push(entry);
  }
  for (const e of pauseCandidates) {
    if (proposals.length >= policy.maxActionsPerCycle) break;
    proposals.push(e);
  }
  for (const e of retireCandidates) {
    if (proposals.length >= policy.maxActionsPerCycle) break;
    proposals.push(e);
  }
  return proposals;
}

// --- Sink-based runner ------------------------------------------------------

export interface ManagerSink {
  /** Load the active fleet samples for one tenant. */
  loadFleet(tenantId: string): Promise<readonly AgentFleetSample[]>;
  /** Persist a manager proposal — operator reviews before apply, mirroring
   *  agent_improvement_proposals. Returns proposal id. */
  writeProposal(tenantId: string, action: ManagerAction): Promise<string>;
  /** Emit `manager.action_proposed` for the dashboard. */
  emit(input: { tenantId: string; action: ManagerAction; proposalId: string }): Promise<void>;
}

export interface ManagerRunResult {
  tenantId: string;
  proposals: Array<{ action: ManagerAction; proposalId: string }>;
}

export async function runManagerCycle(
  tenantId: string,
  sink: ManagerSink,
  policy: ManagerPolicy = DEFAULT_MANAGER_POLICY,
): Promise<ManagerRunResult> {
  const samples = await sink.loadFleet(tenantId);
  const actions = planManagerCycle(samples, policy);
  const proposals: ManagerRunResult["proposals"] = [];
  for (const a of actions) {
    const id = await sink.writeProposal(tenantId, a);
    await sink.emit({ tenantId, action: a, proposalId: id });
    proposals.push({ action: a, proposalId: id });
  }
  return { tenantId, proposals };
}
