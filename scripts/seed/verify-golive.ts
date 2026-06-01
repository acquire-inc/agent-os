// scripts/seed/verify-golive.ts — acceptance checks after a go-live seed.
// Confirms the fleet is present, the run_summaries table exists, and every can't-fail agent sits
// at autonomy=propose (the enforced safety ceiling). Exits non-zero on any violation.
// Usage: DATABASE_URL=... pnpm --filter @agent-os/seed exec tsx verify-golive.ts
import { createDb, schema } from "@agent-os/db";
import { CANT_FAIL_AGENTS, TENANT_IDS } from "@agent-os/shared";
import { and, eq, inArray, sql } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tenantId = TENANT_IDS.acqu;

  const agentRows = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, tenantId));
  const enabled = agentRows.filter((a) => a.enabled).length;
  const toolRows = await db.select().from(schema.tools).where(eq(schema.tools.tenantId, tenantId));
  const evalRows = await db.select().from(schema.evalCases).where(eq(schema.evalCases.tenantId, tenantId));

  // run_summaries table present?
  const reg = (await db.execute(sql`select to_regclass('public.run_summaries') as t`)) as unknown as { t: string | null }[];
  const hasRunSummaries = Boolean(reg[0]?.t);

  // can't-fail agents must all sit at propose.
  const offPropose = await db
    .select({ key: schema.agents.key, autonomy: schema.agents.autonomy })
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.tenantId, tenantId),
        inArray(schema.agents.key, CANT_FAIL_AGENTS as unknown as string[]),
      ),
    );
  const violations = offPropose.filter((a) => a.autonomy !== "propose");

  console.log(`  enabled agents:         ${enabled}`);
  console.log(`  tools in catalog:       ${toolRows.length}`);
  console.log(`  eval cases:             ${evalRows.length}`);
  console.log(`  run_summaries table:    ${hasRunSummaries ? "present ✓" : "MISSING ✗"}`);
  console.log(
    `  can't-fail off-propose: ${violations.length ? "✗ " + violations.map((v) => `${v.key}=${v.autonomy}`).join(", ") : "none ✓"}`,
  );

  if (!hasRunSummaries || violations.length || enabled === 0) {
    console.error("\n✗ Go-live verification failed.");
    process.exit(1);
  }
  console.log("\n✓ Go-live verification passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
