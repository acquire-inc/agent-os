import { schema, type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

export interface CostSummary {
  total: number;
  byDay: { day: string; costUsd: number; tokensIn: number; tokensOut: number }[];
  byAgent: { agentId: string; costUsd: number }[];
}

/** Aggregate spend for a tenant over the last `sinceDays` days. */
export async function costSummary(db: Db, tenantId: string, sinceDays = 14): Promise<CostSummary> {
  const byDayRes = await db.execute(sql`
    select to_char(date_trunc('day', coalesce(started_at, scheduled_for, created_at)), 'YYYY-MM-DD') as day,
           coalesce(sum(cost_usd), 0)::float8 as cost_usd,
           coalesce(sum(tokens_in), 0)::bigint as tokens_in,
           coalesce(sum(tokens_out), 0)::bigint as tokens_out
    from runs
    where tenant_id = ${tenantId}
      and coalesce(started_at, scheduled_for, created_at) >= now() - (${sinceDays} || ' days')::interval
    group by 1 order by 1
  `);
  const byAgentRes = await db.execute(sql`
    select agent_id, coalesce(sum(cost_usd), 0)::float8 as cost_usd
    from runs where tenant_id = ${tenantId}
      and coalesce(started_at, scheduled_for, created_at) >= now() - (${sinceDays} || ' days')::interval
    group by agent_id order by cost_usd desc
  `);
  const byDay = (byDayRes as unknown as Record<string, unknown>[]).map((r) => ({
    day: r.day as string,
    costUsd: Number(r.cost_usd),
    tokensIn: Number(r.tokens_in),
    tokensOut: Number(r.tokens_out),
  }));
  const byAgent = (byAgentRes as unknown as Record<string, unknown>[]).map((r) => ({ agentId: r.agent_id as string, costUsd: Number(r.cost_usd) }));
  return { total: byDay.reduce((s, d) => s + d.costUsd, 0), byDay, byAgent };
}

export interface BudgetStatus {
  monthlyBudgetUsd: number | null;
  monthSpendUsd: number;
  pct: number;
  level: "ok" | "warn" | "over";
}

/** Compare current-month spend against the tenant's monthly budget cap. */
export async function checkBudget(db: Db, tenantId: string): Promise<BudgetStatus> {
  const [tenant] = await db.select().from(schema.tenants).where(sql`id = ${tenantId}`).limit(1);
  const budget = tenant?.monthlyBudgetUsd ? Number(tenant.monthlyBudgetUsd) : null;
  const spendRes = await db.execute(sql`
    select coalesce(sum(cost_usd), 0)::float8 as spend
    from runs where tenant_id = ${tenantId}
      and coalesce(started_at, scheduled_for, created_at) >= date_trunc('month', now())
  `);
  const monthSpend = Number((spendRes as unknown as Record<string, unknown>[])[0]?.spend ?? 0);
  const pct = budget && budget > 0 ? (monthSpend / budget) * 100 : 0;
  const level: BudgetStatus["level"] = pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok";
  return { monthlyBudgetUsd: budget, monthSpendUsd: monthSpend, pct, level };
}

/** Append an immutable audit-log entry (the PostToolUse hook target). */
export async function writeAudit(
  db: Db,
  args: { tenantId: string; runId?: string | null; toolName: string; inputHash?: string | null; result?: string | null },
) {
  const [row] = await db
    .insert(schema.auditLog)
    .values({ tenantId: args.tenantId, runId: args.runId ?? null, toolName: args.toolName, inputHash: args.inputHash ?? null, result: args.result ?? null })
    .returning();
  return row;
}
