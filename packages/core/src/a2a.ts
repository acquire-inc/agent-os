// Async A2A handoff chains (V2 P7).
//
// Today an agent can DELEGATE a sub-task to a model via `tool.delegate`
// (sub-agent runner) — but it can't HAND OFF a multi-step objective to
// another agent on the fleet. Handoff is the difference between "I'll do
// this little query" and "I'm done with the lead-triage step; the
// outreach-writer takes it from here." Without it, the operator routes by
// hand and the objective loses continuity at every transition.
//
// This module ships the pure handoff decision + the correlation/causation
// tracking the operator needs. A handoff is an event ("agent X completed
// step S of objective O and hands off to agent Y on step S+1") that
// preserves:
//   - causation_run_id  — the run that produced the trigger
//   - correlation_id    — the objective or workflow id everything ties to
// so the dashboard can show the chain and the next run carries the prior
// step's artifacts forward.
//
// Compliance + safety:
//   - Handoff TARGETS must be on the same tenant. Cross-tenant handoff
//     is REFUSED (defense-in-depth on tenant isolation).
//   - Handoff to a can't-fail agent is allowed (cant-fail can be a step in
//     a chain), but the receiving cant-fail agent's autonomy rules still
//     apply at dispatch — handoff is queue-level, not bypass.
//   - Handoff to a PAUSED agent is REFUSED (it would silently park
//     the chain).
//   - Self-handoff (agent X hands to agent X) is allowed for retry but
//     emits a warning event since it usually indicates a loop bug.
//   - Lease arbitration still applies to the next-step run. Handoff
//     doesn't override the runtime sequencing layer.
//
// Pure decision + sink runner. Mirrors objective.ts / improve.ts / critic.ts
// / lease.ts — DB-bound writes injected via sink so the whole flow is
// offline-testable.

export interface HandoffRequest {
  /** Run that just finished and is requesting the handoff. */
  fromRunId: string;
  fromAgentId: string;
  fromAgentKey: string;
  tenantId: string;
  /** The receiving agent's key (operator-friendly) — caller resolves to id. */
  toAgentKey: string;
  /** Optional objective the chain ties to; null for ad-hoc handoffs. */
  objectiveId: string | null;
  /** Short summary of what was done; carried into the receiving bundle as
   *  a priorLearnings-equivalent so the next agent doesn't redo it. */
  summary: string;
  /** Optional artifact paths or ids the next agent should pick up. */
  artifactRefs: readonly string[];
}

export interface HandoffTargetAgent {
  id: string;
  key: string;
  tenantId: string;
  /** Whether the receiving agent is paused / disabled. */
  enabled: boolean;
  isCantFail: boolean;
}

export type HandoffAction = "queue" | "refuse_paused" | "refuse_cross_tenant" | "refuse_unknown";

export interface HandoffDecision {
  action: HandoffAction;
  rationale: string;
  /** When action === "queue", the operator-readable warning if any
   *  (e.g. self-handoff). null when no warning. */
  warning: string | null;
}

/**
 * Decide what to do with a handoff request given the (resolved) target.
 * Pure: no DB, no clock. Caller resolves the target by key first.
 */
export function decideHandoff(
  request: HandoffRequest,
  target: HandoffTargetAgent | null,
): HandoffDecision {
  if (!target) {
    return {
      action: "refuse_unknown",
      rationale: `target agent key '${request.toAgentKey}' not found on tenant ${request.tenantId}`,
      warning: null,
    };
  }
  if (target.tenantId !== request.tenantId) {
    return {
      action: "refuse_cross_tenant",
      rationale: `target agent belongs to tenant ${target.tenantId}; refusing cross-tenant handoff`,
      warning: null,
    };
  }
  if (!target.enabled) {
    return {
      action: "refuse_paused",
      rationale: `target agent '${target.key}' is paused; would silently park the chain`,
      warning: null,
    };
  }
  const selfHandoff = target.id === request.fromAgentId;
  return {
    action: "queue",
    rationale: `queue handoff from ${request.fromAgentKey} to ${target.key}` +
      (selfHandoff ? " (self-handoff — usually a loop bug; verify intent)" : ""),
    warning: selfHandoff ? "self-handoff detected — investigate if unintentional" : null,
  };
}

/** Carryover context the receiving agent's bundle should include. Same wire
 *  as P2's prior-learnings + P3's reflexion context — the next bundle gets
 *  a clear "what just happened before you" block. */
export function composeHandoffContext(request: HandoffRequest): string {
  const lines = [
    `# Handoff from ${request.fromAgentKey}`,
    ``,
    `## What was just done`,
    request.summary.trim(),
  ];
  if (request.artifactRefs.length > 0) {
    lines.push(``, `## Artifacts produced`);
    for (const ref of request.artifactRefs) lines.push(`- ${ref}`);
  }
  lines.push(
    ``,
    `## Your part`,
    `Pick up where ${request.fromAgentKey} left off. Do not redo the work above.`,
    `If the handoff doesn't make sense given your role, write a clear refusal back to the objective.`,
  );
  return lines.join("\n");
}

// --- Sink-based runner ------------------------------------------------------

export interface HandoffSink {
  /** Resolve (tenantId, toAgentKey) → agent record. Null when not found. */
  resolveTarget(tenantId: string, agentKey: string): Promise<HandoffTargetAgent | null>;
  /** Persist the handoff row + queue the next run. Returns the new run id. */
  queueHandoff(input: {
    request: HandoffRequest;
    target: HandoffTargetAgent;
    handoffContext: string;
  }): Promise<{ handoffId: string; nextRunId: string }>;
  /** Emit `agent.handoff_initiated` to the relay so the chain is visible
   *  in the operator dashboard. */
  emit(input: {
    request: HandoffRequest;
    decision: HandoffDecision;
    handoffId: string | null;
    nextRunId: string | null;
  }): Promise<void>;
}

export interface HandoffRunResult {
  decision: HandoffDecision;
  handoffId: string | null;
  nextRunId: string | null;
}

export async function runHandoff(
  request: HandoffRequest,
  sink: HandoffSink,
): Promise<HandoffRunResult> {
  const target = await sink.resolveTarget(request.tenantId, request.toAgentKey);
  const decision = decideHandoff(request, target);

  let handoffId: string | null = null;
  let nextRunId: string | null = null;
  if (decision.action === "queue") {
    const handoffContext = composeHandoffContext(request);
    const queued = await sink.queueHandoff({ request, target: target!, handoffContext });
    handoffId = queued.handoffId;
    nextRunId = queued.nextRunId;
  }
  await sink.emit({ request, decision, handoffId, nextRunId });
  return { decision, handoffId, nextRunId };
}
