// scripts/seed/icp-acqu-starter.ts
//
// Seed a STARTER active ICP for the Acqu tenant so the lead pipeline (P3+P4)
// has something to run against without the operator having to hand-write
// SQL. Defaults are sensible for the Acqu doctrine (mid-market B2B); the
// operator should edit the row from the control plane Settings → ICP tab
// (or update via SQL) once their actual ICP is defined.
//
// Idempotent: if an active ICP already exists for the tenant, the script
// reports it and exits 0 without changes. To replace, deactivate the
// existing one first or pass --force.
//
// Usage:
//   DATABASE_URL=... pnpm seed:icp-acqu
//   DATABASE_URL=... pnpm seed:icp-acqu --force

import { exit, argv } from "node:process";
import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;
const FORCE = argv.includes("--force");

// Starter ICP for Acqu — mid-market B2B SaaS. Operator-editable from day one.
const STARTER_ICP = {
  tenantId: TENANT_ID,
  name: "Acqu Starter — mid-market B2B SaaS",
  active: true,
  targetType: "mid_market" as const,
  positiveSignals: {
    hiring: 15,
    ad_spend_growth: 20,
    multi_location: 5,
    recent_funding: 10,
    review_velocity: 5,
  },
  minRevenueUsd: "1000000",
  minHeadcount: 50,
  maxHeadcount: 500,
  titles: [
    "VP of Marketing",
    "Head of Growth",
    "Director of Demand Generation",
    "Marketing Operations Manager",
    "Head of Performance Marketing",
  ],
  verticals: ["SaaS", "B2B Software", "MarTech", "FinTech"],
  geo: ["United States", "Canada", "United Kingdom"],
  countries: ["US", "CA", "GB"],
  dailyDiscoveryLimit: 200,
  enrichmentBatchSize: 25,
  scoreThreshold: 65,
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required. Run after `pnpm db:migrate`.");
    exit(2);
  }
  const db = createDb(url);

  console.log(`▸ Checking for existing active ICP on tenant ${TENANT_ID.slice(0, 8)}…`);
  const existing = await db
    .select({ id: schema.icps.id, name: schema.icps.name })
    .from(schema.icps)
    .where(and(eq(schema.icps.tenantId, TENANT_ID), eq(schema.icps.active, true)))
    .limit(1);

  if (existing.length > 0 && !FORCE) {
    console.log(`✓ Active ICP already exists: "${existing[0]!.name}" (${existing[0]!.id})`);
    console.log("  Pass --force to deactivate it and seed the starter, or edit it from Settings → ICP.");
    exit(0);
  }

  if (existing.length > 0 && FORCE) {
    console.log(`▸ --force: deactivating ${existing.length} existing active ICP(s)`);
    await db
      .update(schema.icps)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(schema.icps.tenantId, TENANT_ID), eq(schema.icps.active, true)));
  }

  console.log("▸ Inserting starter ICP…");
  const [inserted] = await db
    .insert(schema.icps)
    .values(STARTER_ICP)
    .returning({ id: schema.icps.id, name: schema.icps.name, targetType: schema.icps.targetType });

  console.log(`✓ Seeded ICP: "${inserted!.name}" (${inserted!.id})`);
  console.log("");
  console.log("  Tier:           mid_market");
  console.log("  Titles:         VP Marketing, Head of Growth, etc.");
  console.log("  Headcount:      50–500");
  console.log("  Geo:            US / CA / GB");
  console.log("  Discovery cap:  200 leads/day");
  console.log("  Enrichment:     25 leads/batch");
  console.log("  Score threshold: 65 (qualified ≥ 65)");
  console.log("");
  console.log("Next:");
  console.log("  pnpm seed:lead-pipeline   # seed Discovery + Enrichment+Scoring agents");
  console.log("  # Or edit this ICP in the control plane → Settings → ICP tab.");
  console.log("  # Then enable the discovery-agent + enrichment-scoring agents in /agents.");
  exit(0);
}

main().catch((e) => {
  console.error("seed:icp-acqu failed:", e?.message ?? e);
  exit(1);
});
