// The `runScheduledAgent` Inngest function — the durable replacement for the
// in-process scheduler tick (packages/core/src/scheduler.ts).
//
// pg_cron (migration 0008, Plan 04) fires an `agent/scheduled.run` event per due
// agent via pg_net.http_post → the Hono /api/inngest mount → this function. The
// function claims the next due run for that agent inside a checkpointed step so
// Inngest can retry the claim without double-dispatching (the row-level
// `for update skip locked` in claimNextRun is the real concurrency guard).
import { createDb } from "@agent-os/db";
import { claimNextRun } from "@agent-os/core";
import { inngest } from "../client.js";

export const runScheduledAgent = inngest.createFunction(
  {
    id: "run-scheduled-agent",
    // concurrency.limit is Inngest function-level sandboxing — NOT the Claude
    // Agent SDK allowedTools (Pitfall 5, Plan 06). It caps how many scheduled-run
    // claims execute in parallel so a burst of cron events can't stampede the DB.
    concurrency: { limit: 5 },
    // Triggers belong in the first argument since inngest@4.5.
    triggers: [{ event: "agent/scheduled.run" }],
  },
  async ({ event, step }) => {
    const data = (event.data ?? {}) as { agentId?: string; tenantId?: string };
    const { agentId, tenantId } = data;
    if (!agentId || !tenantId) {
      return { claimed: null, reason: "missing agentId/tenantId in event.data" };
    }

    const claimed = await step.run("claim-and-dispatch", async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL required to claim a scheduled run");
      }
      const db = createDb(process.env.DATABASE_URL);
      const run = await claimNextRun(db, agentId, tenantId, "inngest:run-scheduled-agent");
      return run?.id ?? null;
    });

    return { claimed };
  },
);
