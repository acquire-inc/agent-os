import { schema, type Db } from "@agent-os/db";
import type { ApprovalOption } from "@agent-os/shared";
import { eq } from "drizzle-orm";
import { indexDocument, type Embedder } from "./knowledge.js";
import { recordRunUsage } from "./metering.js";

const { approvals, autonomyEvents, documents, runs, runActivity } = schema;

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

/** Apply a status transition posted by a runner; stamps ended_at on terminal states. */
export async function setRunStatus(db: Db, runId: string, update: StatusUpdate, embedder?: Embedder) {
  const patch: Record<string, unknown> = { status: update.status };
  if (update.summary !== undefined) patch.summary = update.summary;
  if (update.tokensIn !== undefined) patch.tokensIn = update.tokensIn;
  if (update.tokensOut !== undefined) patch.tokensOut = update.tokensOut;
  if (update.costUsd !== undefined) patch.costUsd = String(update.costUsd);
  if (update.sdkSessionId !== undefined) patch.sdkSessionId = update.sdkSessionId;
  if (TERMINAL.has(update.status)) patch.endedAt = new Date();

  const [row] = await db.update(runs).set(patch).where(eq(runs.id, runId)).returning();
  if (row && TERMINAL.has(update.status)) {
    // Exactly one session_end event per terminal transition — the SessionEnd
    // hook target on the live path, the same event in dry-run.
    await recordAutonomyEvent(db, {
      tenantId: row.tenantId,
      runId: row.id,
      agentId: row.agentId,
      kind: "session_end",
      rationale: update.status,
    });
  }
  if (row && update.status === "done") await writeRunMemory(db, row, embedder);
  // Metering: a completed run becomes one billable usage event + credit burn (idempotent per
  // run). Best-effort — billing must never block the run's terminal transition. Only `done`
  // runs bill (a failed/skipped run produced no deliverable). The agent's model is resolved for
  // the usage record; if unavailable we fall back to the run's reported figures.
  if (row && update.status === "done") {
    try {
      const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, row.agentId)).limit(1);
      await recordRunUsage(db, {
        tenantId: row.tenantId,
        runId: row.id,
        agentId: row.agentId,
        model: agent?.model ?? "unknown",
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        rawCostUsd: Number(row.costUsd),
      });
    } catch {
      /* metering is derived/best-effort; the run is the system-of-record and is already saved */
    }
  }
  return row ?? null;
}

export async function appendActivity(db: Db, runId: string, tenantId: string, kind: string, message: string) {
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
  const [approval] = await db
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
  // The run now waits on a human. Persist the session id so the runner can
  // resume the exact Agent SDK conversation once the human decides.
  const patch: Record<string, unknown> = { status: "waiting" };
  if (args.sdkSessionId) patch.sdkSessionId = args.sdkSessionId;
  await db.update(runs).set(patch).where(eq(runs.id, args.runId));
  return approval;
}

/** Human decided: record the choice and flip the run to `pending` for resume. */
export async function resolveApproval(db: Db, approvalId: string, optionKey: string, decidedBy: string | null) {
  const [approval] = await db
    .update(approvals)
    .set({ status: "decided", decidedBy, decidedAt: new Date() })
    .where(eq(approvals.id, approvalId))
    .returning();
  if (approval) {
    await db.update(runs).set({ status: "pending" }).where(eq(runs.id, approval.runId));
    await appendActivity(db, approval.runId, approval.tenantId, "decision", `Human chose: ${optionKey}`);
  }
  return approval;
}

/**
 * Record a single decision from the autonomy gate. Fires per PreToolUse /
 * PostToolUse / Stop / SessionEnd outcome. Cheap, append-only, indexed by
 * (tenant, run, kind) — these are the rows that prove what the gate did.
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
  const [row] = await db
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
