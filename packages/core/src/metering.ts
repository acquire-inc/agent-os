// Metering + credits — turn a completed run's raw inference cost into per-tenant BILLABLE usage
// and a credit balance (DECISION-inference-metering-hosting.md §2). The pure functions hold the
// pricing/credit math (unit-tested, no DB); the DB functions record a usage event idempotently
// per run and move the credit ledger + balance in one transaction.
//
// `runs` stays the system-of-record (the runner writes cost there); this is the derived billing
// ledger that OpenMeter (self-hosted, our chosen aggregator) ingests, and that the prepaid
// balance check can gate on. Internal Acqu runs at markup 1.0 (at-cost); client tenants resell
// at markup > 1.0.

import { schema, type Db } from "@agent-os/db";
import { and, eq, sql } from "drizzle-orm";

const { tenantCredits, usageEvents, creditLedger } = schema;

// The transaction handle Drizzle passes to db.transaction(cb) — narrower than Db (no $client).
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface BillingConfig {
  /** Resale markup over raw inference cost. 1.0 = at-cost; 1.5 = +50% resale margin. */
  markupMultiple: number;
  /** Credit→USD peg. 1.0 = 1 credit is $1.00. */
  usdPerCredit: number;
}

export const DEFAULT_BILLING: BillingConfig = { markupMultiple: 1.0, usdPerCredit: 1.0 };

export interface UsageComputation {
  rawCostUsd: number;
  billableUsd: number;
  credits: number;
}

/**
 * Pure: given a run's raw inference cost and the tenant's billing config, compute the billable
 * dollars and the credits to burn. Rounds money to 4dp and credits to 4dp (matches the numeric
 * column scales) so the stored value and the math agree. Negative/NaN raw cost clamps to 0.
 */
export function computeUsage(rawCostUsd: number, cfg: BillingConfig = DEFAULT_BILLING): UsageComputation {
  const raw = Number.isFinite(rawCostUsd) && rawCostUsd > 0 ? rawCostUsd : 0;
  const markup = cfg.markupMultiple > 0 ? cfg.markupMultiple : 1.0;
  const usdPerCredit = cfg.usdPerCredit > 0 ? cfg.usdPerCredit : 1.0;
  const billableUsd = round(raw * markup, 4);
  const credits = round(billableUsd / usdPerCredit, 4);
  return { rawCostUsd: round(raw, 4), billableUsd, credits };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export type BalanceVerdict = "ok" | "low" | "empty";

/**
 * Pure: classify a prepaid balance. `low` once it can't cover ~one more typical run (heuristic
 * threshold), `empty` at/below zero. Only meaningful when the tenant enforces balance; internal
 * tenants ignore it.
 */
export function classifyBalance(balanceCredits: number, lowThreshold = 1): BalanceVerdict {
  if (balanceCredits <= 0) return "empty";
  if (balanceCredits < lowThreshold) return "low";
  return "ok";
}

/** Read a tenant's billing config + balance, falling back to defaults if no row exists yet. */
export async function getTenantCredits(db: Db, tenantId: string) {
  const [row] = await db.select().from(tenantCredits).where(eq(tenantCredits.tenantId, tenantId)).limit(1);
  if (!row) {
    return {
      tenantId,
      balanceCredits: 0,
      markupMultiple: DEFAULT_BILLING.markupMultiple,
      usdPerCredit: DEFAULT_BILLING.usdPerCredit,
      enforceBalance: false,
      exists: false as const,
    };
  }
  return {
    tenantId,
    balanceCredits: Number(row.balanceCredits),
    markupMultiple: Number(row.markupMultiple),
    usdPerCredit: Number(row.usdPerCredit),
    enforceBalance: row.enforceBalance,
    exists: true as const,
  };
}

/** Upsert a tenant's billing config (markup / peg / enforcement). Creates the row at balance 0. */
export async function setTenantBilling(
  db: Db,
  tenantId: string,
  cfg: Partial<BillingConfig> & { enforceBalance?: boolean },
) {
  const [existing] = await db.select().from(tenantCredits).where(eq(tenantCredits.tenantId, tenantId)).limit(1);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (cfg.markupMultiple != null) patch.markupMultiple = String(cfg.markupMultiple);
  if (cfg.usdPerCredit != null) patch.usdPerCredit = String(cfg.usdPerCredit);
  if (cfg.enforceBalance != null) patch.enforceBalance = cfg.enforceBalance;
  if (existing) {
    const [row] = await db.update(tenantCredits).set(patch).where(eq(tenantCredits.tenantId, tenantId)).returning();
    return row!;
  }
  const [row] = await db
    .insert(tenantCredits)
    .values({
      tenantId,
      balanceCredits: "0",
      markupMultiple: String(cfg.markupMultiple ?? DEFAULT_BILLING.markupMultiple),
      usdPerCredit: String(cfg.usdPerCredit ?? DEFAULT_BILLING.usdPerCredit),
      enforceBalance: cfg.enforceBalance ?? false,
    })
    .returning();
  return row!;
}

/** Add credits (a prepaid topup / refund / manual adjustment) and append the ledger entry. */
export async function addCredits(
  db: Db,
  args: { tenantId: string; credits: number; kind?: "topup" | "refund" | "adjustment"; reference?: string },
) {
  return db.transaction(async (tx) => {
    await ensureCreditRow(tx, args.tenantId);
    const [row] = await tx
      .update(tenantCredits)
      .set({ balanceCredits: sql`${tenantCredits.balanceCredits} + ${String(args.credits)}`, updatedAt: new Date() })
      .where(eq(tenantCredits.tenantId, args.tenantId))
      .returning();
    const balanceAfter = Number(row!.balanceCredits);
    await tx.insert(creditLedger).values({
      tenantId: args.tenantId,
      kind: args.kind ?? "topup",
      deltaCredits: String(args.credits),
      balanceAfter: String(balanceAfter),
      reference: args.reference ?? null,
    });
    return { balanceCredits: balanceAfter };
  });
}

async function ensureCreditRow(tx: Tx, tenantId: string) {
  await tx
    .insert(tenantCredits)
    .values({ tenantId, balanceCredits: "0" })
    .onConflictDoNothing({ target: tenantCredits.tenantId });
}

export interface RecordUsageArgs {
  tenantId: string;
  runId: string;
  agentId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  rawCostUsd: number;
}

/**
 * Record one billable usage event for a completed run and burn the credits — idempotent per run.
 * If a usage_event already exists for this run, returns it unchanged (a run bills exactly once;
 * safe to call from an at-least-once completion hook). All writes are one transaction so the
 * ledger and the materialized balance never diverge.
 */
export async function recordRunUsage(db: Db, args: RecordUsageArgs) {
  return db.transaction(async (tx) => {
    const [dupe] = await tx.select().from(usageEvents).where(eq(usageEvents.runId, args.runId)).limit(1);
    if (dupe) return { usageEvent: dupe, created: false as const, balanceCredits: null };

    await ensureCreditRow(tx, args.tenantId);
    const [cfgRow] = await tx.select().from(tenantCredits).where(eq(tenantCredits.tenantId, args.tenantId)).limit(1);
    const cfg: BillingConfig = {
      markupMultiple: Number(cfgRow!.markupMultiple),
      usdPerCredit: Number(cfgRow!.usdPerCredit),
    };
    const u = computeUsage(args.rawCostUsd, cfg);

    const [event] = await tx
      .insert(usageEvents)
      .values({
        tenantId: args.tenantId,
        runId: args.runId,
        agentId: args.agentId,
        model: args.model,
        tokensIn: args.tokensIn,
        tokensOut: args.tokensOut,
        rawCostUsd: String(u.rawCostUsd),
        billableUsd: String(u.billableUsd),
        credits: String(u.credits),
      })
      .returning();

    // Burn credits (balance can go negative for post-paid / unenforced tenants — that's the bill).
    const [balRow] = await tx
      .update(tenantCredits)
      .set({ balanceCredits: sql`${tenantCredits.balanceCredits} - ${String(u.credits)}`, updatedAt: new Date() })
      .where(eq(tenantCredits.tenantId, args.tenantId))
      .returning();
    const balanceAfter = Number(balRow!.balanceCredits);

    await tx.insert(creditLedger).values({
      tenantId: args.tenantId,
      kind: "usage",
      deltaCredits: String(-u.credits),
      balanceAfter: String(balanceAfter),
      usageEventId: event!.id,
      reference: `run:${args.runId}`,
    });

    return { usageEvent: event!, created: true as const, balanceCredits: balanceAfter };
  });
}

export interface UsageStatement {
  tenantId: string;
  periodStart: string;
  events: number;
  rawCostUsd: number;
  billableUsd: number;
  credits: number;
  balanceCredits: number;
  byAgent: { agentId: string; credits: number; billableUsd: number }[];
}

/** Current-month billable statement for a tenant — what billing-runner turns into an invoice. */
export async function usageStatement(db: Db, tenantId: string): Promise<UsageStatement> {
  const totalsRes = await db.execute(sql`
    select count(*)::int as events,
           coalesce(sum(raw_cost_usd), 0)::float8 as raw_cost_usd,
           coalesce(sum(billable_usd), 0)::float8 as billable_usd,
           coalesce(sum(credits), 0)::float8 as credits
    from usage_events
    where tenant_id = ${tenantId} and created_at >= date_trunc('month', now())
  `);
  const byAgentRes = await db.execute(sql`
    select agent_id, coalesce(sum(credits),0)::float8 as credits, coalesce(sum(billable_usd),0)::float8 as billable_usd
    from usage_events
    where tenant_id = ${tenantId} and created_at >= date_trunc('month', now())
    group by agent_id order by credits desc
  `);
  const t = (totalsRes as unknown as Record<string, unknown>[])[0] ?? {};
  const credits = await getTenantCredits(db, tenantId);
  return {
    tenantId,
    periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    events: Number(t.events ?? 0),
    rawCostUsd: Number(t.raw_cost_usd ?? 0),
    billableUsd: Number(t.billable_usd ?? 0),
    credits: Number(t.credits ?? 0),
    balanceCredits: credits.balanceCredits,
    byAgent: (byAgentRes as unknown as Record<string, unknown>[]).map((r) => ({
      agentId: r.agent_id as string,
      credits: Number(r.credits),
      billableUsd: Number(r.billable_usd),
    })),
  };
}
