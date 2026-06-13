// Lifecycle sink IMPLEMENTATIONS — DB-bound concrete sinks for the V2 modules.
//
// `lifecycle-hooks.ts` defines the contract; this file ships the actual
// Drizzle-backed sinks the operator wires into lifecycle.ts on db-up. Each
// sink is a thin adapter: load the row(s) the pure module needs, persist the
// decision, emit the relay event.
//
// The kill switches (feature-flags.ts) are honored at the PURE-module level
// (each runReflexion / runSelfImprovement / runCriticReview already
// short-circuits on its flag), so sinks here can be plain Drizzle code.
//
// Operator wiring (in lifecycle.ts, after `supabase db push`):
//
//   import {
//     buildReflexionSink,
//     buildCriticReviewSink,
//     buildLeaseSink,
//     buildHandoffSink,
//     buildImprovementSink,
//     buildManagerSink,
//   } from "./lifecycle-sinks.js";
//
//   const sinks = {
//     reflexion:      buildReflexionSink(db, emit),
//     criticReview:   buildCriticReviewSink(db, emit),
//     lease:          buildLeaseSink(db, emit),
//     handoff:        buildHandoffSink(db, emit),
//     improvement:    buildImprovementSink(db, emit),
//     manager:        buildManagerSink(db, emit),
//   };
//
//   // Call from setRunStatus terminal branch:
//   await runReflexion(run.objectiveId, sinks.reflexion);
//   // ... etc per the lifecycle-hooks.ts contract.

import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@agent-os/db";
import type {
  CriticReviewSink,
  CriticVote,
  ProposalForReview,
  QuorumDecision,
} from "./critic.js";
import type {
  HandoffRequest,
  HandoffSink,
  HandoffTargetAgent,
  HandoffDecision,
} from "./a2a.js";
import type { ImprovementSink, ImprovementProposal } from "./improve.js";
import type {
  ActiveLease,
  LeaseDecision,
  LeaseHolder,
  LeaseSink,
  LeaseTarget,
} from "./lease.js";
import type { AgentFleetSample, ManagerAction, ManagerSink } from "./manager.js";
import type {
  AttemptOutcome,
  Objective,
  ReflexionDecision,
  ReflexionSink,
} from "./objective.js";

/** Relay emit fn the sinks share. Operator passes the project's existing
 *  emit fn (packages/core/src/relay/emit.ts) — keeps event-name typing
 *  and the wave-buffered write through one channel. */
export type RelayEmitter = (input: {
  tenantId: string;
  agentId: string | null;
  runId: string | null;
  eventName: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

// --- Reflexion sink ---------------------------------------------------------

export function buildReflexionSink(db: Db, emit: RelayEmitter): ReflexionSink {
  return {
    async loadObjective(objectiveId) {
      const [row] = await db
        .select()
        .from(schema.objectives)
        .where(eq(schema.objectives.id, objectiveId));
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        agentId: row.agentId,
        title: row.title,
        description: row.description,
        status: row.status as Objective["status"],
        maxAttempts: row.maxAttempts,
      };
    },
    async loadAttempts(objectiveId) {
      const rows = await db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.objectiveId, objectiveId))
        .orderBy(schema.runs.attemptNumber);
      return rows.map((r): AttemptOutcome => ({
        attemptNumber: r.attemptNumber,
        status: r.status as AttemptOutcome["status"],
        verificationPassed: null, // operator: pull from runs.verification_passed if column added later
        summary: "", // operator: pull from run_summaries.summary
      }));
    },
    async setObjectiveStatus(objectiveId, status) {
      const set: Partial<typeof schema.objectives.$inferInsert> = { status };
      if (status === "completed") set.completedAt = new Date();
      if (status === "abandoned") set.abandonedAt = new Date();
      await db.update(schema.objectives).set(set).where(eq(schema.objectives.id, objectiveId));
    },
    async queueFollowupRun(input) {
      // Operator: replace with the real next-run insert + objective_id + attempt_number.
      const [row] = await db
        .insert(schema.runs)
        .values({
          tenantId: input.objective.tenantId,
          agentId: input.objective.agentId,
          status: "scheduled",
          triggerSource: "routine",
          scheduledFor: new Date(),
          objectiveId: input.objective.id,
          attemptNumber: input.nextAttemptNumber,
        })
        .returning({ id: schema.runs.id });
      return row!.id;
    },
    async emitDecision(input) {
      await emit({
        tenantId: input.objective.tenantId,
        agentId: input.objective.agentId,
        runId: input.followupRunId,
        eventName: "objective.reflexion_decided",
        payload: {
          objective_id: input.objective.id,
          action: input.decision.action,
          attempt_number: input.decision.nextAttemptNumber,
          followup_run_id: input.followupRunId,
          rationale: input.decision.rationale,
        },
      });
    },
  };
}

// --- Critic-review sink -----------------------------------------------------

export function buildCriticReviewSink(db: Db, emit: RelayEmitter): CriticReviewSink {
  return {
    async loadProposal(approvalId) {
      const [row] = await db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, approvalId));
      if (!row) return null;
      // Operator: enrich with proposerIsCantFail (caller-passed; lookup agents.key + isCantFail).
      const [agent] = await db
        .select({ key: schema.agents.key })
        .from(schema.agents)
        .where(eq(schema.agents.id, row.agentId));
      const proposerIsCantFail = agent ? await isAgentCantFail(agent.key) : false;
      // Operator: pull estimated cost from the proposal payload or default.
      return {
        approvalId: row.id,
        tenantId: row.tenantId,
        proposerAgentId: row.agentId,
        proposerIsCantFail,
        estimatedCostUsd: 0, // operator: surface from approval payload when available
      } satisfies ProposalForReview;
    },
    async loadVotes(approvalId) {
      const rows = await db
        .select()
        .from(schema.criticVotes)
        .where(eq(schema.criticVotes.approvalId, approvalId));
      return rows.map((v): CriticVote => ({
        criticAgentId: v.criticAgentId,
        verdict: v.verdict as CriticVote["verdict"],
        rationale: v.rationale,
      }));
    },
    async approveByQuorum(approvalId, decision) {
      await db
        .update(schema.approvals)
        .set({ status: "decided", decidedVia: "critic_quorum", decidedAt: new Date() })
        .where(eq(schema.approvals.id, approvalId));
      void decision;
    },
    async escalateToHuman(approvalId, decision) {
      await db.update(schema.approvals).set({ escalated: true }).where(eq(schema.approvals.id, approvalId));
      void decision;
    },
    async emitDecision(input) {
      await emit({
        tenantId: "", // operator: pull from proposal
        agentId: null,
        runId: null,
        eventName: "critic.quorum_decided",
        payload: {
          approval_id: input.approvalId,
          eligible: input.eligibility.eligible,
          outcome: input.decision?.outcome ?? "ineligible",
          approvals: input.decision?.approvals ?? 0,
          rejections: input.decision?.rejections ?? 0,
          rationale: input.decision?.rationale ?? input.eligibility.reason,
        } satisfies Record<string, unknown> & { outcome: QuorumDecision["outcome"] | "ineligible" },
      });
    },
  };
}

// Operator stub: this would import from architect/hydrate.ts which exports
// isCantFail. Keeping it inline-lazy here so this file has no circular deps
// at the top level.
async function isAgentCantFail(agentKey: string): Promise<boolean> {
  const mod = await import("./architect/hydrate.js");
  return (mod as { isCantFail?: (k: string) => boolean }).isCantFail?.(agentKey) ?? false;
}

// --- Lease sink -------------------------------------------------------------

export function buildLeaseSink(db: Db, emit: RelayEmitter): LeaseSink {
  return {
    async loadActive(target, _nowIso) {
      const [row] = await db
        .select()
        .from(schema.agentLeases)
        .where(
          and(
            eq(schema.agentLeases.targetKind, target.kind),
            eq(schema.agentLeases.targetKey, target.key),
            isNull(schema.agentLeases.releasedAt),
          ),
        )
        .limit(1);
      if (!row) return null;
      return toActiveLease(row);
    },
    async acquire(input) {
      const expiresAt = new Date(new Date(input.nowIso).getTime() + input.ttlMs);
      const [row] = await db
        .insert(schema.agentLeases)
        .values({
          tenantId: "", // operator: pull from holder context
          targetKind: input.target.kind,
          targetKey: input.target.key,
          ownerAgentId: input.holder.ownerAgentId,
          ownerRunId: input.holder.ownerRunId,
          ownerIsCantFail: input.holder.ownerIsCantFail,
          expiresAt,
        })
        .returning();
      return toActiveLease(row!);
    },
    async release(leaseId, nowIso) {
      await db
        .update(schema.agentLeases)
        .set({ releasedAt: new Date(nowIso) })
        .where(eq(schema.agentLeases.id, leaseId));
    },
    async renew(leaseId, newExpiresAt) {
      const [row] = await db
        .update(schema.agentLeases)
        .set({ expiresAt: new Date(newExpiresAt) })
        .where(eq(schema.agentLeases.id, leaseId))
        .returning();
      return toActiveLease(row!);
    },
    async emit(input) {
      await emit({
        tenantId: "", // operator: enrich
        agentId: input.requestedBy.ownerAgentId,
        runId: input.requestedBy.ownerRunId,
        eventName: "agent.lease_decided",
        payload: {
          target_kind: input.target.kind,
          target_key: input.target.key,
          decision_kind: input.decision.kind,
          rationale: input.decision.rationale,
        } satisfies Record<string, unknown> & { decision_kind: LeaseDecision["kind"] },
      });
      // Safety-tier secondary emit on cant-fail preempt.
      if (input.decision.kind === "preempt" && input.requestedBy.ownerIsCantFail) {
        await emit({
          tenantId: "",
          agentId: input.requestedBy.ownerAgentId,
          runId: input.requestedBy.ownerRunId,
          eventName: "cantfail.lease_preempt",
          payload: {
            target_kind: input.target.kind,
            target_key: input.target.key,
            preempted_run_id: input.decision.heldBy?.ownerRunId,
            holder_agent_id: input.decision.heldBy?.ownerAgentId,
          },
        });
      }
    },
  };

  function toActiveLease(row: typeof schema.agentLeases.$inferSelect): ActiveLease {
    return {
      id: row.id,
      target: { kind: row.targetKind, key: row.targetKey },
      ownerAgentId: row.ownerAgentId,
      ownerRunId: row.ownerRunId,
      ownerIsCantFail: row.ownerIsCantFail,
      acquiredAt: row.acquiredAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    } satisfies ActiveLease;
  }
}

// --- Handoff sink -----------------------------------------------------------

export function buildHandoffSink(db: Db, emit: RelayEmitter): HandoffSink {
  return {
    async resolveTarget(tenantId, agentKey) {
      const [row] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.key, agentKey)))
        .limit(1);
      if (!row) return null;
      const isCantFail = await isAgentCantFail(row.key);
      return {
        id: row.id,
        key: row.key,
        tenantId: row.tenantId,
        enabled: row.enabled,
        isCantFail,
      } satisfies HandoffTargetAgent;
    },
    async queueHandoff(input) {
      const [nextRun] = await db
        .insert(schema.runs)
        .values({
          tenantId: input.target.tenantId,
          agentId: input.target.id,
          status: "scheduled",
          triggerSource: "routine",
          scheduledFor: new Date(),
          objectiveId: input.request.objectiveId,
        })
        .returning({ id: schema.runs.id });
      const [ho] = await db
        .insert(schema.agentHandoffs)
        .values({
          tenantId: input.request.tenantId,
          fromRunId: input.request.fromRunId,
          fromAgentId: input.request.fromAgentId,
          toAgentId: input.target.id,
          nextRunId: nextRun!.id,
          objectiveId: input.request.objectiveId,
          summary: input.request.summary,
          artifactRefs: [...input.request.artifactRefs],
        })
        .returning({ id: schema.agentHandoffs.id });
      return { handoffId: ho!.id, nextRunId: nextRun!.id };
    },
    async emit(input) {
      await emit({
        tenantId: input.request.tenantId,
        agentId: input.request.fromAgentId,
        runId: input.request.fromRunId,
        eventName: "agent.handoff_decided",
        payload: {
          to_agent_key: input.request.toAgentKey,
          action: input.decision.action,
          handoff_id: input.handoffId,
          next_run_id: input.nextRunId,
          objective_id: input.request.objectiveId,
          warning: input.decision.warning,
        } satisfies Record<string, unknown> & { action: HandoffDecision["action"] },
      });
    },
  };
}

// --- Improvement sink -------------------------------------------------------

export function buildImprovementSink(db: Db, emit: RelayEmitter): ImprovementSink {
  return {
    async loadObservations(_agentId) {
      // Operator: join run_summaries + extracted lessons. Stub returns empty.
      return [];
    },
    async loadCurrentPrompt(agentId) {
      const [row] = await db
        .select({ systemPrompt: schema.agentPrompts.systemPrompt })
        .from(schema.agentPrompts)
        .where(and(eq(schema.agentPrompts.agentId, agentId), eq(schema.agentPrompts.isCurrent, true)))
        .limit(1);
      return row?.systemPrompt ?? null;
    },
    async isCantFail(agentId) {
      const [row] = await db.select({ key: schema.agents.key }).from(schema.agents).where(eq(schema.agents.id, agentId));
      return row ? await isAgentCantFail(row.key) : false;
    },
    async writeProposal(agentId, proposal) {
      const [row] = await db
        .insert(schema.agentImprovementProposals)
        .values({
          tenantId: "", // operator: pull from agent
          agentId,
          kind: proposal.kind,
          proposedPrompt: proposal.proposedPrompt || null,
          skillKey: proposal.skillKey,
          evidence: [...proposal.evidence],
          sampleSize: proposal.sampleSize,
          rationale: proposal.rationale,
          requiresHumanApproval: proposal.requiresHumanApproval,
        })
        .returning({ id: schema.agentImprovementProposals.id });
      return row!.id;
    },
    async emitProposed(input) {
      await emit({
        tenantId: "",
        agentId: input.agentId,
        runId: null,
        eventName: "improvement.proposed",
        payload: {
          proposal_id: input.proposalId,
          kind: input.proposal.kind,
          sample_size: input.proposal.sampleSize,
          requires_human_approval: input.proposal.requiresHumanApproval,
        } satisfies Record<string, unknown> & { kind: ImprovementProposal["kind"] },
      });
    },
  };
}

// --- Manager sink -----------------------------------------------------------

export function buildManagerSink(db: Db, emit: RelayEmitter): ManagerSink {
  return {
    async loadFleet(_tenantId): Promise<readonly AgentFleetSample[]> {
      // Operator: join agents with derived metrics (success rate, spend share,
      // hours-since-paused). Stub returns empty.
      return [];
    },
    async writeProposal(tenantId, action) {
      const [row] = await db
        .insert(schema.managerProposals)
        .values({
          tenantId,
          agentId: action.agentId,
          kind: action.kind,
          rationale: action.rationale,
        })
        .returning({ id: schema.managerProposals.id });
      return row!.id;
    },
    async emit(input) {
      await emit({
        tenantId: input.tenantId,
        agentId: input.action.agentId,
        runId: null,
        eventName: "manager.action_proposed",
        payload: {
          kind: input.action.kind,
          rationale: input.action.rationale,
          proposal_id: input.proposalId,
        } satisfies Record<string, unknown> & { kind: ManagerAction["kind"] },
      });
    },
  };
}

// Operator-helpful re-exports.
export type {
  CriticVote,
  HandoffRequest,
  LeaseHolder,
  LeaseTarget,
  Objective,
  ReflexionDecision,
};
