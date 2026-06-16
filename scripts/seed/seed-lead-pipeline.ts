// scripts/seed/seed-lead-pipeline.ts (P3 + P4)
// Idempotent batch: seeds both the Discovery and Enrichment+Scoring agents.
// Operators run: pnpm seed:lead-pipeline (after pnpm db:migrate).
import { runSpec } from "./lib/runSpec.js";
import { discoveryAgentSpec } from "./acqu-discovery-agent.js";
import { enrichmentScoringSpec } from "./acqu-enrichment-scoring.js";

async function main() {
  console.log("▸ Seeding lead pipeline agents (P3 Discovery + P4 Enrichment+Scoring)…");
  await runSpec(discoveryAgentSpec);
  await runSpec(enrichmentScoringSpec);
  console.log("✓ Both agents seeded. Next: create the active ICP row via the control plane Settings → ICP tab, or insert one directly:");
  console.log("    INSERT INTO icps (tenant_id, name, active, target_type, ...) VALUES (...);");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ seed failed:", err);
  process.exit(1);
});
