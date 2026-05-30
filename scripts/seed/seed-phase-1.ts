// scripts/seed/seed-phase-1.ts
// Orchestrates the Phase-1 agent seed for tenant Acqu (Session B / B1).
// Seeds the 8 Phase-1 agents from the Session B Master Doc §3 by calling each
// agent's exported seed function (shared helpers in _shared.ts). Idempotent:
// re-running brings the DB to the same final state. `vitals` is already proven
// (scripts/seed/acqu-vitals.ts) and is included read-only in the final table.

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { and, eq, inArray } from "drizzle-orm";
import { seedAdOps } from "./acqu-ad-ops.js";
import { seedBriefing } from "./acqu-briefing.js";
import { seedEa } from "./acqu-ea.js";
import { seedExpenseTracker } from "./acqu-expense-tracker.js";
import { seedMarginMonitor } from "./acqu-margin-monitor.js";
import { seedDunningManager } from "./acqu-dunning-manager.js";
import { seedConnectorHealthMonitor } from "./acqu-connector-health-monitor.js";
import { seedMemoryConsolidator } from "./acqu-memory-consolidator.js";

const TENANT_ID = TENANT_IDS.acqu;

// Phase-1 roster + the manifest's expected tier, for an inline assertion.
const PHASE_1 = ["ad-ops", "briefing", "ea", "expense-tracker", "margin-monitor", "dunning-manager", "connector-health-monitor", "memory-consolidator"];
const EXPECTED_MODEL: Record<string, string> = {
  vitals: "nousresearch/hermes-4-70b",
  "ad-ops": "anthropic/claude-sonnet-4.6",
  briefing: "nousresearch/hermes-4-405b",
  ea: "anthropic/claude-sonnet-4.6",
  "expense-tracker": "nousresearch/hermes-4-70b",
  "margin-monitor": "nousresearch/hermes-4-70b",
  "dunning-manager": "anthropic/claude-sonnet-4.6",
  "connector-health-monitor": "nousresearch/hermes-4-70b",
  "memory-consolidator": "nousresearch/hermes-4-405b",
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  console.log("▸ Seeding Phase-1 agents for tenant Acqu…\n");
  await seedAdOps(db);                  console.log("  ✓ ad-ops");
  await seedBriefing(db);               console.log("  ✓ briefing");
  await seedEa(db);                     console.log("  ✓ ea");
  await seedExpenseTracker(db);         console.log("  ✓ expense-tracker");
  await seedMarginMonitor(db);          console.log("  ✓ margin-monitor");
  await seedDunningManager(db);         console.log("  ✓ dunning-manager");
  await seedConnectorHealthMonitor(db); console.log("  ✓ connector-health-monitor");
  await seedMemoryConsolidator(db);     console.log("  ✓ memory-consolidator");

  // --- Verification table (vitals + the 8) -----------------------------------
  const keys = ["vitals", ...PHASE_1];
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, TENANT_ID), inArray(schema.agents.key, keys)));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  console.log("\n──────────────────────────────────────────────────────────────────────────────────────────");
  console.log("AGENT                       MODEL                          AUTONOMY      BUDGET  TRIGGERS");
  console.log("──────────────────────────────────────────────────────────────────────────────────────────");
  for (const key of keys) {
    const a = byKey.get(key);
    if (!a) { console.log(`${key.padEnd(27)} MISSING`); continue; }
    const trg = await db.select().from(schema.agentTriggers).where(eq(schema.agentTriggers.agentId, a.id));
    const trgStr = trg.map((t) => (t.type === "cron" ? `cron(${t.schedule})` : t.eventKey ? `${t.type}(${t.eventKey})` : t.type)).join(", ");
    const flag = a.model === EXPECTED_MODEL[key] ? "" : `  ⚠ expected ${EXPECTED_MODEL[key]}`;
    console.log(`${key.padEnd(27)} ${(a.model ?? "").padEnd(30)} ${(a.autonomy ?? "").padEnd(13)} $${String(a.budgetCapUsd).padEnd(5)} ${trgStr}${flag}`);
  }
  console.log("──────────────────────────────────────────────────────────────────────────────────────────");

  // Explicit tier assertions called out by B1.
  const assertModel = (key: string, want: string) => {
    const got = byKey.get(key)?.model;
    console.log(`  ${got === want ? "✓" : "✗"} ${key} = ${got} ${got === want ? "" : `(expected ${want})`}`);
  };
  console.log("\nTier confirmations (B1):");
  assertModel("briefing", "nousresearch/hermes-4-405b");
  assertModel("memory-consolidator", "nousresearch/hermes-4-405b");
  assertModel("ad-ops", "anthropic/claude-sonnet-4.6");
  assertModel("ea", "anthropic/claude-sonnet-4.6");
  assertModel("dunning-manager", "anthropic/claude-sonnet-4.6");

  // Count totals (rows already fetched via inArray above).
  console.log(`\n✓ Phase-1 seed complete — ${rows.length}/9 agents present (vitals + 8 Phase-1).`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
