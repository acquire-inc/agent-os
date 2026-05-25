import { schema, type Db } from "@agent-os/db";
import type { ApprovalOption } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const { approvals, documents, runs, runActivity } = schema;

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
export async function setRunStatus(db: Db, runId: string, update: StatusUpdate) {
  const patch: Record<string, unknown> = { status: update.status };
  if (update.summary !== undefined) patch.summary = update.summary;
  if (update.tokensIn !== undefined) patch.tokensIn = update.tokensIn;
  if (update.tokensOut !== undefined) patch.tokensOut = update.tokensOut;
  if (update.costUsd !== undefined) patch.costUsd = String(update.costUsd);
  if (update.sdkSessionId !== undefined) patch.sdkSessionId = update.sdkSessionId;
  if (TERMINAL.has(update.status)) patch.endedAt = new Date();

  const [row] = await db.update(runs).set(patch).where(eq(runs.id, runId)).returning();
  if (row && update.status === "done") await writeRunMemory(db, row);
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
  args: { runId: string; tenantId: string; agentId: string; context: string; proposedAction: string; options: ApprovalOption[] },
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
  // The run now waits on a human.
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, args.runId));
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

/** Autonomous memory: persist a run summary as an agent-generated document. */
export async function writeRunMemory(db: Db, run: typeof schema.runs.$inferSelect) {
  if (!run.summary) return;
  const day = new Date().toISOString().slice(0, 10);
  await db.insert(documents).values({
    tenantId: run.tenantId,
    name: `run-summary_${run.agentId.slice(0, 8)}_${day}`,
    type: "markdown",
    source: "agent-generated",
    vectorNamespace: `tenant/${run.tenantId}/memory`,
    vectorIndexed: false,
  });
}
