// scripts/seed/seed-phase-4.ts
// Batch-seed every Phase-4 agent for tenant Acqu, idempotently. Mirrors
// seed-phase-3.ts. HARD TIER LOCK: 7 T-critical agents must resolve to
// anthropic/claude-opus-4.8 (the printed eyeball table makes this auditable).

import { createDb } from "@agent-os/db";
import { seedAgent, type AgentSpec } from "@agent-os/core";
import { agentEvaluatorSpec } from "./acqu-agent-evaluator.js";
import { agentOnboarderSpec } from "./acqu-agent-onboarder.js";
import { callSummarizerSpec } from "./acqu-call-summarizer.js";
import { complianceHealthSpec } from "./acqu-compliance-health.js";
import { contractDrafterSpec } from "./acqu-contract-drafter.js";
import { contractLifecycleManagerSpec } from "./acqu-contract-lifecycle-manager.js";
import { decisionMemoDrafterSpec } from "./acqu-decision-memo-drafter.js";
import { discountGovernorSpec } from "./acqu-discount-governor.js";
import { discoveryPrepSpec } from "./acqu-discovery-prep.js";
import { expansionFinderSpec } from "./acqu-expansion-finder.js";
import { forecastRunnerSpec } from "./acqu-forecast-runner.js";
import { intelSpec } from "./acqu-intel.js";
import { knowledgeCuratorSpec } from "./acqu-knowledge-curator.js";
import { objectionCoachSpec } from "./acqu-objection-coach.js";
import { paymentCollectorSpec } from "./acqu-payment-collector.js";
import { platformChangeWatcherSpec } from "./acqu-platform-change-watcher.js";
import { pricingArchitectSpec } from "./acqu-pricing-architect.js";
import { regulatoryWatcherSpec } from "./acqu-regulatory-watcher.js";
import { reinvestmentAdvisorSpec } from "./acqu-reinvestment-advisor.js";
import { riskRegisterKeeperSpec } from "./acqu-risk-register-keeper.js";
import { savePlaySpec } from "./acqu-save-play.js";
import { skillLibrarianSpec } from "./acqu-skill-librarian.js";
import { unitEconomicsSpec } from "./acqu-unit-economics.js";
import { SKILL_SOURCE } from "./lib/runSpec.js";

const PHASE_4: AgentSpec[] = [
  complianceHealthSpec,
  intelSpec,
  decisionMemoDrafterSpec,
  savePlaySpec,
  expansionFinderSpec,
  discoveryPrepSpec,
  callSummarizerSpec,
  objectionCoachSpec,
  contractDrafterSpec,
  paymentCollectorSpec,
  unitEconomicsSpec,
  agentEvaluatorSpec,
  agentOnboarderSpec,
  platformChangeWatcherSpec,
  regulatoryWatcherSpec,
  contractLifecycleManagerSpec,
  riskRegisterKeeperSpec,
  knowledgeCuratorSpec,
  skillLibrarianSpec,
  pricingArchitectSpec,
  discountGovernorSpec,
  reinvestmentAdvisorSpec,
  forecastRunnerSpec,
];

// Sanity: 7 of these MUST resolve to claude-opus-4.8 (CLAUDE.md can't-fail list).
const T_CRITICAL_KEYS = new Set([
  "decision-memo-drafter",
  "contract-drafter",
  "contract-lifecycle-manager",
  "risk-register-keeper",
  "pricing-architect",
  "discount-governor",
  "reinvestment-advisor",
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  // Hard-fail before touching the DB if any T-critical agent's spec was tampered with.
  for (const spec of PHASE_4) {
    if (T_CRITICAL_KEYS.has(spec.key) && spec.model !== "anthropic/claude-opus-4.8") {
      throw new Error(
        `HARD FAIL: ${spec.key} is T-critical (CLAUDE.md can't-fail list) but model=${spec.model}. Must be anthropic/claude-opus-4.8.`,
      );
    }
  }

  console.log(`▸ Seeding Phase 4: ${PHASE_4.length} agents for tenant Acqu`);
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

  for (const spec of PHASE_4) {
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
  console.log("✓ Phase 4 seeded — eyeball table:");
  console.log("");
  console.log(
    "  " +
      "key".padEnd(28) +
      "model".padEnd(34) +
      "autonomy".padEnd(13) +
      "cron".padEnd(15) +
      "budget".padEnd(8),
  );
  console.log("  " + "─".repeat(98));
  for (const r of rows) {
    const tag = T_CRITICAL_KEYS.has(r.key) ? " ⚠ T-CRITICAL" : "";
    console.log(
      "  " +
        r.key.padEnd(28) +
        r.model.padEnd(34) +
        r.autonomy.padEnd(13) +
        r.cron.padEnd(15) +
        r.budget.padEnd(8) +
        tag,
    );
  }
  console.log("");
  console.log("HARD TIER LOCK CHECK: 7 T-critical agents resolved to anthropic/claude-opus-4.8.");
  console.log("");
  console.log("Bindings:");
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(28)} skills=[${r.skills}]  mcps=[${r.mcps}]`);
  }
  console.log("");
  console.log("Next: Phase 9 — tenant-isolation-tester + secrets-rotation (external launch gate).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
