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

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Db } from "@agent-os/db";
import type {
  CriticReviewSink,
  CriticVote,
  ProposalForReview,
  QuorumDecision,
} from "./critic.js";

/** Runtime tripwire — every V2 sink must resolve a real tenantId before
 *  inserting a row or emitting a relay event. An empty-string tenantId would
 *  poison RLS scope (cross-tenant rows would silently leak through the empty
 *  bucket) and corrupt the relay audit trail. Per CR-01: fail loud so a
 *  future regression can't reintroduce the TODO-stub. */
function assertTenant(t: string): void {
  if (!t || t.length === 0) {
    throw new Error("tenant_id required — refusing to write empty-string row");
  }
}
import type {
  HandoffRequest,
  HandoffSink,
  HandoffTargetAgent,
  HandoffDecision,
} from "./a2a.js";
import type { ImprovementSink, ImprovementProposal } from "./improve.js";
import {
  assertTenantScopedKey,
  type ActiveLease,
  type LeaseDecision,
  type LeaseHolder,
  type LeaseSink,
  type LeaseTarget,
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
      const runRows = await db
        .select({
          id: schema.runs.id,
          attemptNumber: schema.runs.attemptNumber,
          status: schema.runs.status,
        })
        .from(schema.runs)
        .where(eq(schema.runs.objectiveId, objectiveId))
        .orderBy(schema.runs.attemptNumber);
      if (runRows.length === 0) return [];
      const runIds = runRows.map((r) => r.id);

      // WR-01: pull real reflexion inputs from run_summaries + autonomy_events
      // so decideReflexion sees actual outcomes instead of the prior hardcoded
      // `verificationPassed: null` / `summary: ""` stub that made every
      // attempt look indistinguishable to the loop.
      const summaryRows = await db
        .select({ runId: schema.runSummaries.runId, summary: schema.runSummaries.summaryText })
        .from(schema.runSummaries)
        .where(inArray(schema.runSummaries.runId, runIds));
      const summaries = new Map<string, string>();
      for (const s of summaryRows) summaries.set(s.runId, s.summary ?? "");

      // verification.passed / verification.failed are autonomy-event kinds the
      // verifier emits at run close. We take the FIRST per-run hit (the run
      // only verifies once at terminal), giving decideReflexion a true/false/
      // null tri-state.
      const evtRows = await db
        .select({ runId: schema.autonomyEvents.runId, kind: schema.autonomyEvents.kind, ts: schema.autonomyEvents.ts })
        .from(schema.autonomyEvents)
        .where(
          and(
            inArray(schema.autonomyEvents.runId, runIds),
            inArray(schema.autonomyEvents.kind, ["verification.passed", "verification.failed"]),
          ),
        )
        .orderBy(desc(schema.autonomyEvents.ts));
      const verdicts = new Map<string, "verification.passed" | "verification.failed">();
      for (const e of evtRows) {
        if (!e.runId) continue;
        if (verdicts.has(e.runId)) continue; // most-recent-wins after desc sort
        if (e.kind === "verification.passed" || e.kind === "verification.failed") {
          verdicts.set(e.runId, e.kind);
        }
      }

      return runRows.map((r): AttemptOutcome => {
        const verdict = verdicts.get(r.id);
        return {
          attemptNumber: r.attemptNumber,
          status: r.status as AttemptOutcome["status"],
          verificationPassed:
            verdict === "verification.passed"
              ? true
              : verdict === "verification.failed"
              ? false
              : null,
          summary: summaries.get(r.id) ?? "",
        };
      });
    },
    async setObjectiveStatus(objectiveId, status) {
      const set: Partial<typeof schema.objectives.$inferInsert> = { status };
      if (status === "completed") set.completedAt = new Date();
      if (status === "abandoned") set.abandonedAt = new Date();
      await db.update(schema.objectives).set(set).where(eq(schema.objectives.id, objectiveId));
    },
    async queueFollowupRun(input) {
      // Resolution path: tenantId + agentId come from the loaded objective row.
      assertTenant(input.objective.tenantId);
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
      // Resolution path: tenantId + agentId come from the loaded objective row.
      assertTenant(input.objective.tenantId);
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
      // Resolution path: proposerIsCantFail comes from agents.key → isCantFail.
      const [agent] = await db
        .select({ key: schema.agents.key })
        .from(schema.agents)
        .where(eq(schema.agents.id, row.agentId));
      const proposerIsCantFail = agent ? await isAgentCantFail(agent.key) : false;
      // estimatedCostUsd surfaces from approval payload when present; until the
      // payload carries it, leave null and isCriticEligible routes to human.
      return {
        approvalId: row.id,
        tenantId: row.tenantId,
        proposerAgentId: row.agentId,
        proposerIsCantFail,
        // Phase 70 CORR-03: null (unknown stake) — isCriticEligible routes
        // unknown-stake proposals to the HUMAN inbox. 0 would have made every
        // proposal critic-eligible, inverting the doctrine.
        estimatedCostUsd: null,
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
      // Resolution path: tenantId is threaded by runCriticReview from the
      // loaded proposal.tenantId (critic.ts contract update).
      assertTenant(input.tenantId);
      await emit({
        tenantId: input.tenantId,
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
  /** Resolution path: lease writes/emits resolve tenantId via
   *  agents.tenantId joined on the owning agent. Throws when the owner
   *  agent row is missing — refusing to write an unowned lease is safer
   *  than guessing. */
  async function resolveTenantId(ownerAgentId: string): Promise<string> {
    const [row] = await db
      .select({ tenantId: schema.agents.tenantId })
      .from(schema.agents)
      .where(eq(schema.agents.id, ownerAgentId))
      .limit(1);
    if (!row) {
      throw new Error(`unknown owner agent ${ownerAgentId} — refusing acquire`);
    }
    assertTenant(row.tenantId);
    return row.tenantId;
  }

  return {
    async loadActive(target, _nowIso) {
      // WR-04: refuse to load a target whose key isn't tenant-prefixed.
      // We don't know the caller's tenant from loadActive's signature, so we
      // assert the key SHAPE: it must include a "{uuid-ish}/" prefix. The
      // acquire path will then re-check the full tenant match against
      // agents.tenantId. Refusing here too means a regressed caller can't
      // even see the cross-tenant row before we'd refuse to write.
      if (!/^[^/]+\//.test(target.key)) {
        throw new Error(
          `lease target key not tenant-prefixed — refusing to load (key=${target.key})`,
        );
      }
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
      const tenantId = await resolveTenantId(input.holder.ownerAgentId);
      assertTenant(tenantId);
      // WR-04: full assertion now that we know the tenant.
      assertTenantScopedKey(input.target, tenantId);
      const expiresAt = new Date(new Date(input.nowIso).getTime() + input.ttlMs);
      const [row] = await db
        .insert(schema.agentLeases)
        .values({
          tenantId,
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
      const tenantId = await resolveTenantId(input.requestedBy.ownerAgentId);
      assertTenant(tenantId);
      await emit({
        tenantId,
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
          tenantId,
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
  /** Resolution path: improvement writes/emits resolve tenantId via
   *  agents.tenantId by agentId. The owning agent must exist on a real
   *  tenant before we touch the proposals queue. */
  async function resolveAgentTenant(agentId: string): Promise<string> {
    const [row] = await db
      .select({ tenantId: schema.agents.tenantId })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);
    if (!row) {
      throw new Error(`unknown agent ${agentId} — refusing improvement write`);
    }
    assertTenant(row.tenantId);
    return row.tenantId;
  }

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
      const tenantId = await resolveAgentTenant(agentId);
      assertTenant(tenantId);
      const [row] = await db
        .insert(schema.agentImprovementProposals)
        .values({
          tenantId,
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
      const tenantId = await resolveAgentTenant(input.agentId);
      assertTenant(tenantId);
      await emit({
        tenantId,
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
    async hasOpenProposal(tenantId, agentId, kind) {
      // WR-05: per-(tenant, agent, kind) dedup against pending manager_proposals.
      // Without this, a paused budget hog spawns 3 fresh proposals every cycle
      // and the operator inbox drowns. Returns true when an unresolved proposal
      // already exists for that tuple.
      assertTenant(tenantId);
      const [row] = await db
        .select({ id: schema.managerProposals.id })
        .from(schema.managerProposals)
        .where(
          and(
            eq(schema.managerProposals.tenantId, tenantId),
            eq(schema.managerProposals.agentId, agentId),
            eq(schema.managerProposals.kind, kind),
            eq(schema.managerProposals.status, "pending"),
          ),
        )
        .limit(1);
      return !!row;
    },
    async writeProposal(tenantId, action) {
      assertTenant(tenantId);
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
      assertTenant(input.tenantId);
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
    async emitSkippedDedup(input) {
      assertTenant(input.tenantId);
      await emit({
        tenantId: input.tenantId,
        agentId: input.action.agentId,
        runId: null,
        eventName: "manager.action_skipped_dedup",
        payload: {
          agent_id: input.action.agentId,
          kind: input.action.kind,
          reason: input.reason,
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
