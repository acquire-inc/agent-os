// Phase 53: live tenant month-to-date spend reader.
//
// Wraps the SQL helper function created by migration 0025:
//   tenant_month_to_date_usd(p_tenant_id UUID) RETURNS NUMERIC
//
// Use this from the chat-dispatch budget gate where stale view data
// could let a run through after the cap was already breached. Use the
// materialized view (tenant_monthly_spend) for dashboards and other
// non-gating reads where freshness matters less.

import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

export async function readTenantMonthToDateUsd(db: Db, tenantId: string): Promise<number> {
  const rows = await db.execute<{ tenant_month_to_date_usd: string }>(sql`
    SELECT tenant_month_to_date_usd(${tenantId}::uuid)
  `);
  const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] }).rows?.[0];
  if (!row) return 0;
  const val = (row as Record<string, unknown>).tenant_month_to_date_usd;
  return Number(val ?? 0);
}
