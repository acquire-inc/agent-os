// relay/summary.ts — the P0 outcome composer.
//
// Called by the server-side terminal-status handler at SessionEnd (NOT by
// the runner client — the runner emits events; the server owns truth and
// composes summaries. Per AGENT-OS-PLAN.md §8 + the Wave C guardrail).
//
// Reads the run's relay_events stream + the runs row + security_findings +
// approvals, composes one run_summaries row, and ENFORCES the cost invariant
// before committing.
//
// Contract: docs/plans/AGENT-OS-PLAN.md §8.2 + AGENTS-PLAN.md §2.
//
// Guardrails (Wave C):
//   1) Atomic — runs inside a transaction. If the cost invariant fails, the
//      tx rolls back so no half-baked summary lands.
//   2) Fail-loud — on cost mismatch, throws CostInvariantViolation and the
//      caller is responsible for emitting relay.invariant_violation to a
//      fresh connection (the rolled-back tx can't carry forensic traces).
//   3) Idempotent — UNIQUE(run_id) at the DB level + an early return when an
//      existing summary is found. Retries are no-ops.

import { schema, type Db } from "@agent-os/db";
import { eq, sql } from "drizzle-orm";

const { runs, runSummaries } = schema;

export interface ComposeRunSummaryArgs {
  runId: string;
  status: "done" | "failed" | "escalated" | "skipped" | "quarantined";
  summaryText?: string | null;
  deliverableKind?: string | null;
  deliverableRef?: string | null;
  evidencePaths?: string[];
  highlights?: Record<string, unknown>;
  consentScope?: "tenant_only" | "cross_tenant_aggregated";
}

export type RunSummary = typeof schema.runSummaries.$inferSelect;

/** Thrown when run_summaries.cost_actual_usd does not match runs.cost_usd.
 *  Carries the offending values so the caller can emit relay.invariant_violation
 *  with the same payload. */
export class CostInvariantViolation extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly runId: string,
    public readonly summaryUsd: string,
    public readonly runUsd: string,
  ) {
    super(
      `relay.invariant_violation: run_summaries.cost_actual_usd=${summaryUsd} != runs.cost_usd=${runUsd} for run ${runId}`,
    );
    this.name = "CostInvariantViolation";
  }
}

export async function composeRunSummary(
  db: Db,
  args: ComposeRunSummaryArgs,
): Promise<RunSummary> {
  // Idempotency check FIRST (outside the tx) — if a summary already exists for
  // this run, return it. Retries are no-ops; one terminal run, one summary.
  const [existing] = await db
    .select()
    .from(runSummaries)
    .where(eq(runSummaries.runId, args.runId))
    .limit(1);
  if (existing) return existing;

  return await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, args.runId)).limit(1);
    if (!run) {
      throw new Error(`composeRunSummary: run ${args.runId} not found`);
    }
    if (!run.startedAt || !run.endedAt) {
      throw new Error(
        `composeRunSummary: run ${args.runId} missing startedAt/endedAt — terminal status must stamp both`,
      );
    }

    const toolRows = (await tx.execute<{ tool_calls: number } & Record<string, unknown>>(sql`
      select count(*)::int as tool_calls
      from relay_events
      where run_id = ${args.runId} and event_name = 'tool.result'
    `)) as unknown as Array<{ tool_calls: number }>;
    const toolCallCount = toolRows[0]?.tool_calls ?? 0;

    const findingRows = (await tx.execute<{ findings_count: number } & Record<string, unknown>>(sql`
      select count(*)::int as findings_count
      from security_findings
      where tenant_id = ${run.tenantId}
        and (payload ->> 'run_id')::text = ${args.runId}
    `)) as unknown as Array<{ findings_count: number }>;
    const findingsCount = findingRows[0]?.findings_count ?? 0;

    const approvalRows = (await tx.execute<{ approvals_count: number } & Record<string, unknown>>(sql`
      select count(*)::int as approvals_count
      from approvals
      where run_id = ${args.runId}
    `)) as unknown as Array<{ approvals_count: number }>;
    const approvalsCount = approvalRows[0]?.approvals_count ?? 0;

    const durationMs = run.endedAt.getTime() - run.startedAt.getTime();
    const runCostUsd = run.costUsd ?? "0";

    const [inserted] = await tx
      .insert(runSummaries)
      .values({
        tenantId: run.tenantId,
        runId: run.id,
        agentId: run.agentId,
        status: args.status,
        deliverableKind: args.deliverableKind ?? null,
        deliverableRef: args.deliverableRef ?? null,
        evidencePaths: args.evidencePaths ?? [],
        // INVARIANT: must mirror runs.cost_usd. Re-checked after insert.
        costActualUsd: runCostUsd,
        tokensIn: run.tokensIn ?? 0,
        tokensOut: run.tokensOut ?? 0,
        findingCount: findingsCount,
        toolCallCount,
        approvalCount: approvalsCount,
        summaryText: args.summaryText ?? run.summary ?? null,
        highlights: args.highlights ?? {},
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        durationMs,
        consentScope: args.consentScope ?? "tenant_only",
      })
      .returning();

    // FAIL-LOUD INVARIANT CHECK: re-read both sides post-insert. If the
    // numbers ever drift (a different writer mid-tx, a schema-level default
    // we forgot, a future overload that bypasses runCostUsd), we throw and
    // the entire tx rolls back. Wave C guardrail #2.
    if (!inserted) {
      throw new Error("composeRunSummary: insert returned no row");
    }
    if (inserted.costActualUsd !== runCostUsd) {
      throw new CostInvariantViolation(
        run.tenantId,
        run.id,
        inserted.costActualUsd,
        runCostUsd,
      );
    }
    return inserted;
  });
}

/** Read-only accessor for ops tooling + the runner self-check. */
export async function getRunSummary(db: Db, runId: string): Promise<RunSummary | null> {
  const [row] = await db.select().from(runSummaries).where(eq(runSummaries.runId, runId)).limit(1);
  return row ?? null;
}
