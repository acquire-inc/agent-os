// scripts/seed/seed-chains.ts
// Wires the v2 Part E handoff chains as data: for every chain step with an inbound event,
// ensures the handling agent has a typed (state/webhook) trigger on that event key — the
// subscriber side the event executor routes on. Idempotent; additive (never prunes the
// agents' existing cron/event triggers). Verifies every referenced agent is seeded.

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import { upsertTypedTrigger } from "./_shared.js";
import { CHAINS } from "./_chains.js";

const TENANT_ID = TENANT_IDS.acqu;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  // Resolve agent keys → ids.
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, TENANT_ID));
  const idByKey = new Map(agents.map((a) => [a.key, a.id]));

  let wired = 0;
  const missingAgents = new Set<string>();
  const eventSubscribers = new Map<string, string[]>(); // eventKey → [agent]

  for (const chain of CHAINS) {
    console.log(`\n▸ ${chain.id} — ${chain.name}`);
    for (const step of chain.steps) {
      const id = idByKey.get(step.agent);
      const arrow = `${step.on ? step.on : "(scheduled/manual)"} ─► ${step.agent}${step.emits ? ` ─► ${step.emits}` : ""}`;
      if (!id) { missingAgents.add(step.agent); console.log(`    ✗ ${arrow}  [agent not seeded]`); continue; }
      if (step.on) {
        const via = step.via ?? "state";
        await upsertTypedTrigger(db, id, via, step.on);
        wired++;
        const subs = eventSubscribers.get(step.on) ?? [];
        subs.push(step.agent);
        eventSubscribers.set(step.on, subs);
      }
      console.log(`    ✓ ${arrow}${step.note ? `   — ${step.note}` : ""}`);
    }
  }

  // ── Verify ──
  console.log("\n══════════════════════════════════════════════════════════════════════════════");
  console.log("HANDOFF-CHAIN SUMMARY");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`  Chains wired: ${CHAINS.length}  |  subscriber triggers ensured: ${wired}`);
  console.log(`  Distinct events in the vocabulary: ${eventSubscribers.size}`);
  console.log(`  Agents referenced but not seeded: ${missingAgents.size ? [...missingAgents].join(", ") : "none ✓"}`);

  // Confirm the DB reflects the subscriptions.
  const stateTriggers = await db
    .select({ key: schema.agents.key, type: schema.agentTriggers.type, eventKey: schema.agentTriggers.eventKey })
    .from(schema.agentTriggers)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.agentTriggers.agentId))
    .where(and(eq(schema.agentTriggers.tenantId, TENANT_ID)));
  const eventTriggerCount = stateTriggers.filter((t) => t.type === "state" || t.type === "webhook").length;
  console.log(`  Total event (state/webhook) triggers in DB now: ${eventTriggerCount}`);

  if (missingAgents.size) { console.error("\n✗ Some chain agents are not seeded."); process.exit(1); }
  console.log("\n✓ Handoff chains wired and verified.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
