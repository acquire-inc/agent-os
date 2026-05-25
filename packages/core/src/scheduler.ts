import { schema, type Db } from "@agent-os/db";
import { and, eq, gte } from "drizzle-orm";
import { previousTick } from "./cron.js";

const { jobs, runs } = schema;

export interface MaterializedRun {
  runId: string;
  jobId: string;
  scheduledFor: Date;
}

/**
 * Evaluate every enabled job and materialize a `scheduled` run for its most
 * recent due cron tick, unless one already exists for that tick or later.
 * Idempotent: safe to call repeatedly (the dedupe check prevents double-fire).
 */
export async function evaluateDueJobs(db: Db, now: Date = new Date()): Promise<MaterializedRun[]> {
  const enabledJobs = await db.select().from(jobs).where(eq(jobs.enabled, true));
  const created: MaterializedRun[] = [];

  for (const job of enabledJobs) {
    const tick = previousTick(job.scheduleCron, now);
    if (!tick) continue;

    const existing = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.jobId, job.id), gte(runs.scheduledFor, tick)))
      .limit(1);
    if (existing.length > 0) continue;

    const [row] = await db
      .insert(runs)
      .values({
        tenantId: job.tenantId,
        agentId: job.agentId,
        jobId: job.id,
        status: "scheduled",
        triggerSource: "schedule",
        scheduledFor: tick,
      })
      .returning({ id: runs.id });

    if (row) created.push({ runId: row.id, jobId: job.id, scheduledFor: tick });
  }

  return created;
}
