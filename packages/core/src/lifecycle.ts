import { schema, type Db } from "@agent-os/db";
import type { ApprovalOption } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import { indexDocument, type Embedder } from "./knowledge.js";
import { emit } from "./relay/emit.js";
import { composeRunSummary, CostInvariantViolation } from "./relay/summary.js";
import { createDb } from "@agent-os/db";
import type { EventName } from "./relay/events.js";

const { approvals, autonomyEvents, documents, runs, runActivity } = schema;

// Map autonomy_events.kind → Relay event_name. Wave C: keep the legacy table
// writing under all kinds; mirror to Relay where there's a 1:1 in the closed
// namespace. 'stop' and 'session_end' are intentionally unmapped:
//   - 'session_end' is emitted as run.{completed|failed|escalated} by the
//     terminal-status handler in setRunStatus — mirroring it twice would
//     double-count run terminations.
//   - 'stop' has no semantic peer in the canonical namespace today; the
//     event-schema-guardian agent can flag this gap if it matters.
const AUTONOMY_KIND_TO_RELAY: Partial<Record<string, EventName>> = {
  allow: "autonomy.allowed",
  propose: "autonomy.escalated",
  deny: "autonomy.denied",
  escalate: "autonomy.escalated",
  budget_cap: "budget.cap_hit",
};

export const AUTONOMY_EVENT_KINDS = [
  "allow",
  "propose",
  "deny",
  "escalate",
  "stop",
  "budget_cap",
  "session_end",
] as const;
export type AutonomyEventKind = (typeof AUTONOMY_EVENT_KINDS)[number];

const TERMINAL = new Set(["done", "failed", "skipped"]);

export interface StatusUpdate {
  status: string;
  summary?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  sdkSessionId?: string | null;
}

// Map terminal runs.status → Relay terminal event_name. Wave C: the server-side
// composer is triggered from inside this handler (per AGENT-OS-PLAN §8 + the
// Wave C guardrail: server owns truth, runner is a client).
const TERMINAL_STATUS_TO_RELAY: Record<string, EventName> = {
  done: "run.completed",
  failed: "run.failed",
  // 'skipped' has no canonical run.* event today; treat as completed for the
  // Relay surface (the runs row still records status=skipped). If skipped
  // semantics diverge from done later, add the event then.
  skipped: "run.completed",
};

/** Apply a status transition posted by a runner; stamps ended_at on terminal states.
 *  Wave C: server-side composer for run_summaries fires here, inside the tx,
 *  AFTER runs.cost_usd is committed and visible. Cost invariant fails LOUD —
 *  the run_summaries write rolls back AND relay.invariant_violation is emitted
 *  on a fresh connection so ops sees the mismatch. */
export async function setRunStatus(db: Db, runId: string, update: StatusUpdate, embedder?: Embedder) {
  const patch: Record<string, unknown> = { status: update.status };
  if (update.summary !== undefined) patch.summary = update.summary;
  if (update.tokensIn !== undefined) patch.tokensIn = update.tokensIn;
  if (update.tokensOut !== undefined) patch.tokensOut = update.tokensOut;
  if (update.costUsd !== undefined) patch.costUsd = String(update.costUsd);
  if (update.sdkSessionId !== undefined) patch.sdkSessionId = update.sdkSessionId;
  if (TERMINAL.has(update.status)) patch.endedAt = new Date();

  let row: typeof schema.runs.$inferSelect | undefined;
  try {
    row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(runs).set(patch).where(eq(runs.id, runId)).returning();
      if (!updated) return undefined;

      if (TERMINAL.has(update.status)) {
        // Mirror terminal status to Relay. This is the canonical run.completed/
        // run.failed/run.escalated event. Inside the tx — if emit throws, the
        // status update rolls back too (Wave C guardrail #1).
        const relayName = TERMINAL_STATUS_TO_RELAY[update.status];
        if (relayName) {
          await emit(tx, {
            tenantId: updated.tenantId,
            eventName: relayName,
            actor: "system",
            agentId: updated.agentId,
            runId: updated.id,
            payload: {
              status: update.status,
              summary: update.summary ?? null,
              cost_usd: updated.costUsd ?? "0",
              tokens_in: updated.tokensIn ?? 0,
              tokens_out: updated.tokensOut ?? 0,
            },
            // Idempotent: a duplicate terminal-status post (network retry) is
            // a no-op on the Relay side too.
            eventKey: `run.terminal:${updated.id}`,
          });
        }

        // Exactly one session_end autonomy_event per terminal transition — the
        // SessionEnd hook target on the live path, the same event in dry-run.
        // Legacy table only; the Relay-side mirror is the run.* event above.
        await recordAutonomyEventInTx(tx, {
          tenantId: updated.tenantId,
          runId: updated.id,
          agentId: updated.agentId,
          kind: "session_end",
          rationale: update.status,
        });

        // Server-side composer. Reads runs.cost_usd post-commit in the same tx,
        // so the cost is committed-and-visible to the read. If the cost
        // invariant fails, composeRunSummary throws CostInvariantViolation and
        // the entire tx rolls back — no half-baked summary, no stale row.
        // The catch below emits relay.invariant_violation on a fresh
        // connection (the tx is rolled back; we need a separate write path
        // to record the violation for ops).
        await composeRunSummary(tx, {
          runId: updated.id,
          status: update.status as "done" | "failed" | "escalated" | "skipped" | "quarantined",
          summaryText: update.summary ?? updated.summary ?? null,
        });
      }
      return updated;
    });
  } catch (err) {
    if (err instanceof CostInvariantViolation) {
      // Fail-loud (Wave C guardrail #2). The tx is rolled back — the
      // run_summaries row never landed. Surface the violation on a fresh
      // connection so the forensic record exists.
      await emitInvariantViolationFreshConn(err).catch((e) => {
        console.error(
          `[lifecycle] BOTH compose-and-rollback AND invariant-emit failed for run ${err.runId}: ${(e as Error).message}`,
        );
      });
    }
    throw err;
  }

  if (row && update.status === "done") await writeRunMemory(db, row, embedder);
  return row ?? null;
}

/** Emit relay.invariant_violation to a brand-new db connection — the tx the
 *  violation tripped is rolled back, so we cannot use it. */
async function emitInvariantViolationFreshConn(err: CostInvariantViolation): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      `[lifecycle] CostInvariantViolation: cannot emit relay.invariant_violation — DATABASE_URL unset. violation=${err.message}`,
    );
    return;
  }
  const fresh = createDb(url);
  await emit(fresh, {
    tenantId: err.tenantId,
    eventName: "relay.invariant_violation",
    actor: "system",
    runId: err.runId,
    payload: {
      invariant: "run_summaries.cost_actual_usd === runs.cost_usd",
      summary_usd: err.summaryUsd,
      run_usd: err.runUsd,
    },
  });
}

export async function appendActivity(db: Db, runId: string, tenantId: string, kind: string, message: string) {
  // Wave C: appendActivity is NOT mirrored to Relay automatically. The `kind`
  // surface is freeform (assistant text, tool, error, summary, decision, …)
  // with no clean 1:1 to the closed canonical namespace. Wave D adds emit()
  // calls at the runner-hook call sites where the semantic event IS known
  // (tool.result, approval.requested, etc.). The legacy run_activity table
  // stays as the freeform activity log.
  const [row] = await db
    .insert(runActivity)
    .values({ runId, tenantId, kind, message })
    .returning();
  return row;
}

/** Clone a failed/old run into a fresh scheduled run (manual retry). */
export async function retryRun(db: Db, runId: string) {
  const [orig] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!orig) return null;
  const [row] = await db
    .insert(runs)
    .values({
      tenantId: orig.tenantId,
      agentId: orig.agentId,
      jobId: orig.jobId,
      status: "scheduled",
      triggerSource: "manual",
      scheduledFor: new Date(),
    })
    .returning();
  return row;
}

export async function raiseApproval(
  db: Db,
  args: { runId: string; tenantId: string; agentId: string; context: string; proposedAction: string; options: ApprovalOption[]; sdkSessionId?: string | null },
) {
  return await db.transaction(async (tx) => {
    const [approval] = await tx
      .insert(approvals)
      .values({
        runId: args.runId,
        tenantId: args.tenantId,
        agentId: args.agentId,
        context: args.context,
        proposedAction: args.proposedAction,
        optionsJson: args.options as unknown as object,
        status: "open",
      })
      .returning();
    if (!approval) throw new Error("raiseApproval: insert returned no row");

    // The run now waits on a human. Persist the session id so the runner can
    // resume the exact Agent SDK conversation once the human decides.
    const patch: Record<string, unknown> = { status: "waiting" };
    if (args.sdkSessionId) patch.sdkSessionId = args.sdkSessionId;
    await tx.update(runs).set(patch).where(eq(runs.id, args.runId));

    // Mirror to Relay. Same-tx — atomic with the approval row + run patch.
    await emit(tx, {
      tenantId: args.tenantId,
      eventName: "approval.requested",
      actor: "system",
      agentId: args.agentId,
      runId: args.runId,
      payload: {
        approval_id: approval.id,
        context: args.context,
        proposed_action: args.proposedAction,
        options: args.options.map((o) => ({ key: o.key, label: o.label })),
      },
    });

    return approval;
  });
}

/** Human decided: record the choice and flip the run to `pending` for resume. */
export async function resolveApproval(db: Db, approvalId: string, optionKey: string, decidedBy: string | null) {
  return await db.transaction(async (tx) => {
    const [approval] = await tx
      .update(approvals)
      .set({ status: "decided", decidedBy, decidedAt: new Date() })
      .where(eq(approvals.id, approvalId))
      .returning();
    if (!approval) return undefined;

    await tx.update(runs).set({ status: "pending" }).where(eq(runs.id, approval.runId));
    await tx.insert(runActivity).values({
      runId: approval.runId,
      tenantId: approval.tenantId,
      kind: "decision",
      message: `Human chose: ${optionKey}`,
    });

    // Mirror to Relay.
    await emit(tx, {
      tenantId: approval.tenantId,
      eventName: "approval.resolved",
      actor: "human",
      actorId: decidedBy ?? null,
      agentId: approval.agentId,
      runId: approval.runId,
      payload: {
        approval_id: approval.id,
        choice: optionKey,
        decided_by: decidedBy,
      },
    });

    return approval;
  });
}

/** Used by setRunStatus's tx to write a session_end autonomy event without
 *  the Relay mirror (the terminal status path already emits run.* and
 *  composes the summary; mirroring session_end too would double-count). */
async function recordAutonomyEventInTx(
  tx: Db,
  args: {
    tenantId: string;
    runId?: string | null;
    agentId: string;
    kind: AutonomyEventKind;
    toolName?: string | null;
    rationale?: string | null;
  },
) {
  const [row] = await tx
    .insert(autonomyEvents)
    .values({
      tenantId: args.tenantId,
      runId: args.runId ?? null,
      agentId: args.agentId,
      kind: args.kind,
      toolName: args.toolName ?? null,
      rationale: args.rationale ?? null,
    })
    .returning();
  return row;
}

/**
 * Record a single decision from the autonomy gate. Fires per PreToolUse /
 * PostToolUse / Stop / SessionEnd outcome. Cheap, append-only, indexed by
 * (tenant, run, kind) — these are the rows that prove what the gate did.
 *
 * Wave C: mirrors to relay_events in the same transaction. Mapping table is
 * AUTONOMY_KIND_TO_RELAY at the top of the file. Kinds with no Relay peer
 * ('stop', 'session_end') only write to the legacy autonomy_events table.
 * If the kind has no mapping, no Relay emit fires — the legacy write is still
 * atomic on its own.
 */
export async function recordAutonomyEvent(
  db: Db,
  args: {
    tenantId: string;
    runId?: string | null;
    agentId: string;
    kind: AutonomyEventKind;
    toolName?: string | null;
    rationale?: string | null;
  },
) {
  return await db.transaction(async (tx) => {
    const row = await recordAutonomyEventInTx(tx, args);
    if (!row) throw new Error("recordAutonomyEvent: insert returned no row");

    const relayName = AUTONOMY_KIND_TO_RELAY[args.kind];
    if (relayName) {
      await emit(tx, {
        tenantId: args.tenantId,
        eventName: relayName,
        actor: "system",
        agentId: args.agentId,
        runId: args.runId ?? null,
        payload: {
          tool_name: args.toolName ?? null,
          rationale: args.rationale ?? null,
        },
      });
    }
    return row;
  });
}

/**
 * Phase 21: setAutonomy — update an agent's autonomy ladder position.
 *
 * Called by the scorecard scheduled job after computeNextAutonomy() returns
 * a decision with changed=true. Atomic update + lifecycle.changed Relay
 * event emission in the same transaction. No-op if nextAutonomy === current
 * autonomy (defensive — the controller already guards this).
 *
 * Note: this is the autonomy-ladder mutation. It is orthogonal to
 * lifecycleState (active/paused/archived/draft). An agent's autonomy can
 * move while its lifecycleState stays "active"; ditto vice versa.
 *
 * Returns the updated agent row, or null if the agent does not exist on
 * this tenant (cross-tenant or missing).
 */
export async function setAutonomy(
  db: Db,
  args: {
    tenantId: string;
    agentId: string;
    nextAutonomy: "propose" | "execute_safe" | "execute_full";
    reason: string;
  },
): Promise<{ id: string; key: string; autonomy: string } | null> {
  return await db.transaction(async (tx) => {
    // CR-05 fix: single WHERE clause combining id + tenant gate. Previously
    // two separate SELECTs leaked another tenant's agent row into the
    // application layer before the gate fired.
    const [current] = await tx
      .select({
        id: schema.agents.id,
        key: schema.agents.key,
        autonomy: schema.agents.autonomy,
      })
      .from(schema.agents)
      .where(
        and(eq(schema.agents.id, args.agentId), eq(schema.agents.tenantId, args.tenantId)),
      );
    if (!current) return null;

    if (current.autonomy === args.nextAutonomy) {
      // WR-10 fix: when current already equals target, return current AND
      // do NOT emit lifecycle.changed (no real change happened). Callers
      // inspect the returned autonomy; they should also accept that no
      // event was emitted. The controller guards this at the job layer
      // (only invokes when changed=true), so this branch is defense-only.
      return current;
    }

    const [updated] = await tx
      .update(schema.agents)
      .set({ autonomy: args.nextAutonomy })
      .where(
        and(eq(schema.agents.id, args.agentId), eq(schema.agents.tenantId, args.tenantId)),
      )
      .returning({
        id: schema.agents.id,
        key: schema.agents.key,
        autonomy: schema.agents.autonomy,
      });
    if (!updated) throw new Error("setAutonomy: update returned no row");

    await emit(tx, {
      tenantId: args.tenantId,
      eventName: "lifecycle.changed",
      actor: "system",
      agentId: args.agentId,
      runId: null,
      payload: {
        kind: "autonomy",
        previous: current.autonomy,
        next: args.nextAutonomy,
        reason: args.reason,
      },
    });

    return updated;
  });
}

/**
 * Phase 23: raise a cap-breach Approval per the cost-ceiling-discipline SKILL
 * workflow step 5. Wraps raiseApproval with the standard cap-breach option set
 * (raise / truncated / abort). The caller (runner) emits budget.cap_breached
 * separately — this surfaces the breach to the operator.
 */
export async function raiseCapBreachApproval(
  db: Db,
  args: {
    runId: string;
    tenantId: string;
    agentId: string;
    requestedUsd: number;
    committedUsd: number;
    capUsd: number;
    sdkSessionId?: string | null;
  },
) {
  const overUsd = args.committedUsd + args.requestedUsd - args.capUsd;
  return await raiseApproval(db, {
    runId: args.runId,
    tenantId: args.tenantId,
    agentId: args.agentId,
    context: `Cap breach: run committed $${args.committedUsd.toFixed(4)} + requested $${args.requestedUsd.toFixed(4)} would exceed cap $${args.capUsd.toFixed(2)} by $${overUsd.toFixed(4)}.`,
    proposedAction: "cap.breach",
    options: [
      { key: "raise", label: "Raise the cap for this run only (one-shot, does not persist)" },
      { key: "truncated", label: "Accept the partial output and close as status=truncated" },
      { key: "abort", label: "Abort the run" },
    ],
    sdkSessionId: args.sdkSessionId,
  });
}

/** Autonomous memory: persist a run summary as an agent-generated document and,
 *  when an embedder is supplied, vector-index it so future runs can retrieve it. */
export async function writeRunMemory(db: Db, run: typeof schema.runs.$inferSelect, embedder?: Embedder) {
  if (!run.summary) return;
  const day = new Date().toISOString().slice(0, 10);
  const namespace = `tenant/${run.tenantId}/memory`;
  const [doc] = await db
    .insert(documents)
    .values({
      tenantId: run.tenantId,
      name: `run-summary_${run.agentId.slice(0, 8)}_${day}`,
      type: "markdown",
      source: "agent-generated",
      vectorNamespace: namespace,
      vectorIndexed: false,
    })
    .returning();
  if (doc && embedder) {
    await indexDocument(db, embedder, { documentId: doc.id, tenantId: run.tenantId, content: run.summary, vectorNamespace: namespace });
  }
}
