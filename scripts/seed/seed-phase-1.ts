// scripts/seed/seed-phase-1.ts
// Batch-seed every Phase-1 agent for tenant Acqu, idempotently. Imports each
// per-agent spec (data) and routes them through the shared seedAgent helper.
// Prints a verification table the operator can eyeball against the manifest.

import { createDb } from "@agent-os/db";
import { seedAgent, type AgentSpec } from "@agent-os/core";
import { adOpsSpec } from "./acqu-ad-ops.js";
import { briefingSpec } from "./acqu-briefing.js";
import { connectorHealthMonitorSpec } from "./acqu-connector-health-monitor.js";
import { dunningManagerSpec } from "./acqu-dunning-manager.js";
import { eaSpec } from "./acqu-ea.js";
import { expenseTrackerSpec } from "./acqu-expense-tracker.js";
import { marginMonitorSpec } from "./acqu-margin-monitor.js";
import { memoryConsolidatorSpec } from "./acqu-memory-consolidator.js";
import { vitalsSpec } from "./acqu-vitals.js";
import { SKILL_SOURCE } from "./lib/runSpec.js";

const PHASE_1: AgentSpec[] = [
  vitalsSpec,
  adOpsSpec,
  briefingSpec,
  eaSpec,
  expenseTrackerSpec,
  marginMonitorSpec,
  dunningManagerSpec,
  connectorHealthMonitorSpec,
  memoryConsolidatorSpec,
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  console.log(`▸ Seeding Phase 1: ${PHASE_1.length} agents for tenant Acqu`);
  console.log("");

  const rows: {
    key: string;
    model: string;
    autonomy: string;
    cron: string;
    budget: string;
    skills: string;
    mcps: string;
  }[] = [];

  for (const spec of PHASE_1) {
    const r = await seedAgent(db, spec, { skillSource: SKILL_SOURCE });
    rows.push({
      key: r.agent.key,
      model: r.agent.model,
      autonomy: r.agent.autonomy,
      cron: r.trigger?.schedule ?? "—",
      budget: `$${r.agent.budgetCapUsd}`,
      skills: r.skills.join("+"),
      mcps: r.mcps.join("+"),
    });
  }

  console.log("");
  console.log("✓ Phase 1 seeded — eyeball table:");
  console.log("");
  console.log(
    "  " +
      "key".padEnd(26) +
      "model".padEnd(34) +
      "autonomy".padEnd(13) +
      "cron".padEnd(15) +
      "budget".padEnd(8),
  );
  console.log(
    "  " +
      "─".repeat(26) +
      " ".repeat(0) +
      "─".repeat(34) +
      "─".repeat(13) +
      "─".repeat(15) +
      "─".repeat(8),
  );
  for (const r of rows) {
    console.log(
      "  " +
        r.key.padEnd(26) +
        r.model.padEnd(34) +
        r.autonomy.padEnd(13) +
        r.cron.padEnd(15) +
        r.budget.padEnd(8),
    );
  }
  console.log("");
  console.log("Bindings:");
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(26)} skills=[${r.skills}]  mcps=[${r.mcps}]`);
  }
  console.log("");
  console.log("Next: B2 — manually dispatch each, check approval gating on ad-ops + dunning-manager.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
