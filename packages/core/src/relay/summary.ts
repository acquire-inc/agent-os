// relay/summary.ts — the P0 outcome composer.
//
// Called by the runner at SessionEnd (terminal status: done | failed |
// escalated). Reads the run's relay_events stream + the runs row + the
// security_findings + approvals tables, composes one run_summaries row.
//
// Contract: docs/plans/AGENT-OS-PLAN.md §8.2 + AGENTS-PLAN.md §2.
// Invariant (launch-gate criterion per GENX-PLAN.md §7.1):
//   run_summaries.cost_actual_usd === runs.cost_usd
// Tested by composeRunSummary.test.ts.
//
// Idempotency: the runs.id has a UNIQUE constraint in run_summaries; calling
// composeRunSummary twice on the same run returns the existing row (the
// runner Stop hook can re-fire on retries — must be a no-op the second time).

import { schema, type Db } from "@agent-os/db";
import { and, eq, sql } from "drizzle-orm";

const { runs, runSummaries, relayEvents, securityFindings, approvals } = schema;

export interface ComposeRunSummaryArgs {
  runId: string;
  /** Terminal status; matches what the runner posted to /api/runs/:id/status. */
  status: "done" | "failed" | "escalated" | "skipped" | "quarantined";
  /** Optional human-readable summary; defaults to null. */
  summaryText?: string | null;
  /** Optional deliverable envelope; defaults to null/null/[]. */
  deliverableKind?: string | null;
  deliverableRef?: string | null;
  evidencePaths?: string[];
  /** Per-agent denormalized highlights — flat key/value lookup the SPA renders. */
  highlights?: Record<string, unknown>;
  /** Consent posture for this run. Defaults to tenant_only. */
  consentScope?: "tenant_only" | "cross_tenant_aggregated";
}

export type RunSummary = typeof schema.runSummaries.$inferSelect;

export async function composeRunSummary(
  db: Db,
  args: ComposeRunSummaryArgs,
): Promise<RunSummary> {
  // Idempotency: if a summary already exists for this run, return it.
  const [existing] = await db
    .select()
    .from(runSummaries)
    .where(eq(runSummaries.runId, args.runId))
    .limit(1);
  if (existing) return existing;

  const [run] = await db.select().from(runs).where(eq(runs.id, args.runId)).limit(1);
  if (!run) {
    throw new Error(`composeRunSummary: run ${args.runId} not found`);
  }
  if (!run.startedAt || !run.endedAt) {
    throw new Error(
      `composeRunSummary: run ${args.runId} missing startedAt/endedAt — terminal status must stamp both`,
    );
  }

  // Aggregate tool calls + approvals + findings from relay_events + sibling tables.
  // Counts come from the durable side (security_findings, approvals) where
  // they exist; tool_call_count derives from the Relay stream (no separate table).
  const toolRows = (await db.execute<{ tool_calls: number } & Record<string, unknown>>(sql`
    select count(*)::int as tool_calls
    from relay_events
    where run_id = ${args.runId} and event_name = 'tool.result'
  `)) as unknown as Array<{ tool_calls: number }>;
  const toolCallCount = toolRows[0]?.tool_calls ?? 0;

  const findingRows = (await db.execute<{ findings_count: number } & Record<string, unknown>>(sql`
    select count(*)::int as findings_count
    from security_findings
    where tenant_id = ${run.tenantId}
      and (payload ->> 'run_id')::text = ${args.runId}
  `)) as unknown as Array<{ findings_count: number }>;
  const findingsCount = findingRows[0]?.findings_count ?? 0;

  const approvalRows = (await db.execute<{ approvals_count: number } & Record<string, unknown>>(sql`
    select count(*)::int as approvals_count
    from approvals
    where run_id = ${args.runId}
  `)) as unknown as Array<{ approvals_count: number }>;
  const approvalsCount = approvalRows[0]?.approvals_count ?? 0;

  const durationMs = run.endedAt.getTime() - run.startedAt.getTime();

  const [inserted] = await db
    .insert(runSummaries)
    .values({
      tenantId: run.tenantId,
      runId: run.id,
      agentId: run.agentId,
      status: args.status,
      deliverableKind: args.deliverableKind ?? null,
      deliverableRef: args.deliverableRef ?? null,
      evidencePaths: args.evidencePaths ?? [],
      // Invariant: must mirror runs.cost_usd. Tests assert equality.
      costActualUsd: run.costUsd ?? "0",
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
  return inserted!;
}

/** Read-only accessor for ops tooling + the runner self-check. */
export async function getRunSummary(db: Db, runId: string): Promise<RunSummary | null> {
  const [row] = await db.select().from(runSummaries).where(eq(runSummaries.runId, runId)).limit(1);
  return row ?? null;
}
