// scripts/seed/seed-phase-3.ts
// Batch-seed every Phase-3 agent for tenant Acqu, idempotently.
//
// HARD GATE: launcher is post-compliance-gated — verify ad-claim-compliance
// (Phase 5) is enabled before flipping launcher.enabled true.

import { createDb } from "@agent-os/db";
import { seedAgent, type AgentSpec } from "@agent-os/core";
import { arAgingMonitorSpec } from "./acqu-ar-aging-monitor.js";
import { bookingConciergeSpec } from "./acqu-booking-concierge.js";
import { cashPositionMonitorSpec } from "./acqu-cash-position-monitor.js";
import { churnRiskDetectorSpec } from "./acqu-churn-risk-detector.js";
import { clientCommsSpec } from "./acqu-client-comms.js";
import { clientHealthSpec } from "./acqu-client-health.js";
import { funnelMonitorSpec } from "./acqu-funnel-monitor.js";
import { launcherSpec } from "./acqu-launcher.js";
import { leadTriageSpec } from "./acqu-lead-triage.js";
import { onboardingRunnerSpec } from "./acqu-onboarding-runner.js";
import { revenueRecognizerSpec } from "./acqu-revenue-recognizer.js";
import { runwayWatcherSpec } from "./acqu-runway-watcher.js";
import { SKILL_SOURCE } from "./lib/runSpec.js";

const PHASE_3: AgentSpec[] = [
  launcherSpec,
  leadTriageSpec,
  bookingConciergeSpec,
  funnelMonitorSpec,
  onboardingRunnerSpec,
  clientCommsSpec,
  clientHealthSpec,
  churnRiskDetectorSpec,
  arAgingMonitorSpec,
  revenueRecognizerSpec,
  cashPositionMonitorSpec,
  runwayWatcherSpec,
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  console.log(`▸ Seeding Phase 3: ${PHASE_3.length} agents for tenant Acqu`);
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

  for (const spec of PHASE_3) {
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
  console.log("✓ Phase 3 seeded — eyeball table:");
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
  console.log("HARD GATE: launcher is post-compliance-gated — verify ad-claim-compliance is enabled before flipping launcher.enabled true.");
  console.log("Next: verify dispatch each, then Phase 7 (tools registry + Inngest + Browserbase).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
