// scripts/seed/seed-phase-2.ts
// Batch-seed every Phase-2 agent for tenant Acqu, idempotently.
// Hard gate: includes ad-claim-compliance (T-critical) — this is the gate
// that MUST exist before any client-facing ad launches per main §6.

import { createDb } from "@agent-os/db";
import { seedAgent, type AgentSpec } from "@agent-os/core";
import { adClaimComplianceSpec } from "./acqu-ad-claim-compliance.js";
import { caseStudyBuilderSpec } from "./acqu-case-study-builder.js";
import { contentEngineSpec } from "./acqu-content-engine.js";
import { creativeCriticSpec } from "./acqu-creative-critic.js";
import { creativeMinerSpec } from "./acqu-creative-miner.js";
import { creativeStudioSpec } from "./acqu-creative-studio.js";
import { weeklyReportSpec } from "./acqu-weekly-report.js";
import { winDetectorSpec } from "./acqu-win-detector.js";
import { SKILL_SOURCE } from "./lib/runSpec.js";

const PHASE_2: AgentSpec[] = [
  creativeMinerSpec,
  creativeStudioSpec,
  creativeCriticSpec,
  contentEngineSpec,
  weeklyReportSpec,
  adClaimComplianceSpec,
  winDetectorSpec,
  caseStudyBuilderSpec,
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  console.log(`▸ Seeding Phase 2: ${PHASE_2.length} agents for tenant Acqu`);
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

  for (const spec of PHASE_2) {
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
  console.log("✓ Phase 2 seeded — eyeball table:");
  console.log("");
  console.log(
    "  " +
      "key".padEnd(26) +
      "model".padEnd(34) +
      "autonomy".padEnd(13) +
      "cron".padEnd(15) +
      "budget".padEnd(8),
  );
  console.log("  " + "─".repeat(96));
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
  console.log("HARD GATE: ad-claim-compliance now exists — client ad launches are unblocked.");
  console.log("Next: B3 verify (dispatch each, confirm tiering), then Phase 3.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
