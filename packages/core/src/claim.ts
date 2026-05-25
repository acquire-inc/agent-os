import { schema, type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

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
 */
export async function claimNextRun(
  db: Db,
  agentId: string,
  tenantId: string,
  runner: string,
): Promise<ClaimedRun | null> {
  const result = await db.execute(sql`
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
  return mapRun(rows[0]);
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
