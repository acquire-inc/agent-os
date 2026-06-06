// Phase 55: nightly tenant monthly spend rollup.
//
// Refreshes the materialized view tenant_monthly_spend (migration 0025)
// + emits a budget summary event per tenant for the platform dashboard.
//
// Triggers:
//   - cron "0 3 * * *" (every night at 03:00 UTC; after end-of-day spend)
//   - event "tenant-spend/refresh-now" for ad-hoc operator triggers
//
// The materialized view backs the operator dashboard and the
// scheduled budget dashboards; freshness within 24h is acceptable for
// reporting. The chat-dispatch gate uses tenant_month_to_date_usd()
// (live function) so dispatch decisions are never stale.

import { createDb, type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";
import { inngest } from "../client.js";

async function refreshView(db: Db): Promise<void> {
  // CONCURRENTLY requires a unique index; the migration creates one on
  // (tenant_id, month). Without CONCURRENTLY, the view is locked during
  // the refresh; with it, the view stays readable.
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY tenant_monthly_spend`);
}

interface TenantSummary {
  tenant_id: string;
  month: Date;
  total_usd: number;
  run_count: number;
}

async function summarize(db: Db): Promise<TenantSummary[]> {
  // Pull current-month rows for the platform's audit feed.
  const rows = await db.execute<{
    tenant_id: string;
    month: Date;
    total_usd: string;
    run_count: number;
  }>(sql`
    SELECT tenant_id, month, total_usd, run_count
    FROM tenant_monthly_spend
    WHERE month = date_trunc('month', now())
    ORDER BY total_usd DESC
  `);
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
  return (list as Record<string, unknown>[]).map((r) => ({
    tenant_id: String(r.tenant_id ?? ""),
    month: new Date(String(r.month ?? "")),
    total_usd: Number(r.total_usd ?? 0),
    run_count: Number(r.run_count ?? 0),
  }));
}

export const applyMonthlyCostRollup = inngest.createFunction(
  {
    id: "apply-monthly-cost-rollup",
    concurrency: { limit: 1 },
    triggers: [
      { cron: "0 3 * * *" },
      { event: "tenant-spend/refresh-now" },
    ],
  },
  async ({ step }) => {
    if (!process.env.DATABASE_URL) {
      return { ok: false, reason: "DATABASE_URL unset" };
    }
    const db = createDb(process.env.DATABASE_URL);

    await step.run("refresh-view", () => refreshView(db));
    const summary = await step.run("summarize-current-month", () => summarize(db));

    return {
      ok: true,
      tenants_summarized: summary.length,
      total_platform_usd: summary.reduce((s, t) => s + t.total_usd, 0),
      top_5: summary.slice(0, 5).map((s) => ({
        tenant_id: s.tenant_id,
        total_usd: s.total_usd,
        run_count: s.run_count,
      })),
    };
  },
);
