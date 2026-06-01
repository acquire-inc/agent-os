import { schema, type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";
import { emit } from "./relay/emit.js";

export type ClaimedRun = typeof schema.runs.$inferSelect;

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Raw db.execute returns snake_case DB columns; map them to the camelCase row shape. */
function mapRun(row: Record<string, unknown> | undefined): ClaimedRun | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as ClaimedRun;
}

/**
 * Transactionally claim the next runnable run for an agent — the runs table is
 * the queue. Claims `scheduled` runs and `pending` ones (approved, awaiting
 * resume), preferring pending so human-unblocked work continues first. Uses FOR
 * UPDATE SKIP LOCKED so concurrent runners never collide. Returns null if idle.
 *
 * Wave D: emits run.started to the Relay in the SAME transaction as the claim.
 * Atomic — if the emit fails, the claim rolls back and the run returns to the
 * queue for re-claim (no lost run, no phantom run.started).
 */
export async function claimNextRun(
  db: Db,
  agentId: string,
  tenantId: string,
  runner: string,
): Promise<ClaimedRun | null> {
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      update runs set status = 'running', claimed_by = ${runner}, started_at = now()
      where id = (
        select id from runs
        where agent_id = ${agentId} and tenant_id = ${tenantId} and status in ('scheduled', 'pending')
        order by (status = 'pending') desc, scheduled_for asc nulls last
        for update skip locked
        limit 1
      )
      returning *
    `);
    const rows = result as unknown as Record<string, unknown>[];
    const claimed = mapRun(rows[0]);
    if (!claimed) return null;

    await emit(tx, {
      tenantId,
      eventName: "run.started",
      actor: "system",
      agentId,
      runId: claimed.id,
      payload: {
        trigger_source: claimed.triggerSource ?? null,
        scheduled_for: claimed.scheduledFor ? new Date(claimed.scheduledFor).toISOString() : null,
        claimed_by: runner,
        resumed: claimed.sdkSessionId != null,
      },
      // Idempotent: a run can only be claimed once (status flips out of
      // scheduled/pending), but the event_key makes a retry a hard no-op too.
      eventKey: `run.started:${claimed.id}`,
    });

    return claimed;
  });
}

/** Look at the next available run without claiming it (Harbour's ?peek pattern). */
export async function peekNextRun(
  db: Db,
  agentId: string,
  tenantId: string,
): Promise<ClaimedRun | null> {
  const result = await db.execute(sql`
    select * from runs
    where agent_id = ${agentId} and tenant_id = ${tenantId} and status in ('scheduled', 'pending')
    order by (status = 'pending') desc, scheduled_for asc nulls last
    limit 1
  `);
  const rows = result as unknown as Record<string, unknown>[];
  return mapRun(rows[0]);
}
