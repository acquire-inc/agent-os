// scripts/seed/seed-evals.ts
// Phase 8: seed eval cases as data + compute a metrics scorecard for every agent.
// Idempotent (upsert by tenant+agent_key+name). Verifies cases land + metrics roll up.

import { computeAgentMetrics, proposeAutonomyChange } from "@agent-os/core";
import { createDb, schema } from "@agent-os/db";
import { and, eq } from "drizzle-orm";
import { TENANT_ID } from "./_shared.js";
import { EVAL_CASES } from "./_evals.js";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  // Resolve which referenced agents exist (cases are keyed by stable agent_key).
  const agents = await db.select({ id: schema.agents.id, key: schema.agents.key }).from(schema.agents).where(eq(schema.agents.tenantId, TENANT_ID));
  const idByKey = new Map(agents.map((a) => [a.key, a.id]));

  let upserted = 0;
  const missing = new Set<string>();
  for (const c of EVAL_CASES) {
    if (!idByKey.has(c.agentKey)) { missing.add(c.agentKey); continue; }
    const [existing] = await db.select({ id: schema.evalCases.id }).from(schema.evalCases)
      .where(and(eq(schema.evalCases.tenantId, TENANT_ID), eq(schema.evalCases.agentKey, c.agentKey), eq(schema.evalCases.name, c.name)));
    const values = { agentKey: c.agentKey, name: c.name, input: c.input, assertion: c.assertion, kind: c.kind, severity: c.severity ?? "normal", enabled: true };
    if (existing) await db.update(schema.evalCases).set(values).where(eq(schema.evalCases.id, existing.id));
    else await db.insert(schema.evalCases).values({ tenantId: TENANT_ID, ...values });
    upserted++;
  }

  // Compute a metrics scorecard for every agent (rolls up runs/approvals/events → agent_metrics).
  let scored = 0;
  for (const a of agents) { await computeAgentMetrics(db, a.id, { tenantId: TENANT_ID }); scored++; }

  // ── Verify ──
  const caseCount = (await db.select().from(schema.evalCases).where(eq(schema.evalCases.tenantId, TENANT_ID))).length;
  const critical = (await db.select().from(schema.evalCases).where(and(eq(schema.evalCases.tenantId, TENANT_ID), eq(schema.evalCases.severity, "critical")))).length;
  const byAgent = new Map<string, number>();
  for (const c of EVAL_CASES) byAgent.set(c.agentKey, (byAgent.get(c.agentKey) ?? 0) + 1);

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("EVAL SUITE SUMMARY");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`  Eval cases upserted: ${upserted}  (in DB: ${caseCount}, critical: ${critical})`);
  console.log(`  Agents covered:      ${byAgent.size}`);
  console.log(`  Metrics scorecards computed: ${scored}`);
  console.log(`  Agents referenced but not seeded: ${missing.size ? [...missing].join(", ") : "none ✓"}`);

  // Show the recommendation logic on a sample (no runs yet → hold on insufficient volume).
  const sample = agents.find((a) => a.key === "vitals");
  if (sample) {
    const m = await computeAgentMetrics(db, sample.id, { tenantId: TENANT_ID });
    const rec = proposeAutonomyChange(m);
    console.log(`  vitals scorecard: runs=${m.runs} success=${(m.successRate * 100).toFixed(0)}% → ${rec.action} (${rec.reason})`);
  }

  if (missing.size) { console.error("\n✗ Some eval-case agents are not seeded."); process.exit(1); }
  console.log("\n✓ Eval suites + metrics seeded and verified.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
