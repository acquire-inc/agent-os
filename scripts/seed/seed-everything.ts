// scripts/seed/seed-everything.ts
// "Build everything" — discovers EVERY prompt-bearing agent across both doctrines
// (v1 + v2), subtracts the agents already seeded (Phase 1 + Phases 2–5), and seeds
// the remainder (partnerships, proof, governance, treasury, infra, meta-layer, dev/
// support, etc.) through the same doctrine-driven engine. Stubs without a fenced
// prompt are auto-excluded. Idempotent. All agents on Hermes 4 405B (operator rule).

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";
import { ACQU_AGENT_MODEL } from "./_shared.js";
import { listPromptAgents, getAgentBlock } from "./_doctrine.js";
import { seedRoster, type AgentSpec, type Tier } from "./_generic.js";
import { PHASE_2, PHASE_3, PHASE_4, PHASE_5 } from "./_roster.js";
import { seedAgentArchitect } from "./acqu-agent-architect.js";

const TENANT_ID = TENANT_IDS.acqu;

// Already seeded by dedicated scripts / phase rosters — don't re-seed (preserves their
// hand-tuned knowledge scopes, the composed `ea` prompt, etc.).
const ALREADY = new Set<string>([
  "vitals", "ad-ops", "briefing", "ea", "expense-tracker", "margin-monitor",
  "dunning-manager", "connector-health-monitor", "memory-consolidator",
  ...[...PHASE_2, ...PHASE_3, ...PHASE_4, ...PHASE_5].map((s) => s.key),
]);

// Thinking-effort heuristic (model is uniform 405B; tier only sets thinkingLevel + grouping).
function classify(key: string): Tier {
  if (/compliance|security|audit|contract|risk|pricing|offer|decision|isolation|secrets|reinvest/.test(key)) return "T-critical";
  if (/monitor|watcher|guardian|tracker|reconciler|runner|concierge|health|rewarder|processor|harvester/.test(key)) return "T-cheap";
  if (/scout|finder|scanner|watchtower|forecast|economics|experimenter|planner|research|signal|evaluator|curator|librarian|memo|review/.test(key)) return "T-reason";
  return "T-work";
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  // Discover all prompt-bearing agents; pick the doc whose prompt is longer when a key
  // appears in both (e.g. forecast-runner: v1 has the real prompt, v2 is a stub).
  const best = new Map<string, { doc: "v1" | "v2"; len: number }>();
  for (const doc of ["v1", "v2"] as const) {
    for (const { key, promptLen } of listPromptAgents(doc)) {
      if (!best.has(key) || promptLen > best.get(key)!.len) best.set(key, { doc, len: promptLen });
    }
  }

  const remainder: AgentSpec[] = [...best.entries()]
    .filter(([key]) => !ALREADY.has(key))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, { doc }]) => ({ key, doc, tier: classify(key) }));

  console.log(`Discovered ${best.size} prompt-bearing agents in the doctrine.`);
  console.log(`Already seeded: ${ALREADY.size}. Remainder to seed now: ${remainder.length}.\n`);

  const reports = await seedRoster(db, remainder, "Everything-else (full doctrine remainder)");

  // Meta-layer org-design agent — DATA, but new (not discoverable from the doctrine), so
  // seeded by its dedicated script. Idempotent: safe alongside the roster pass.
  await seedAgentArchitect(db);
  console.log("  + agent-architect (org-design meta-agent) seeded.");

  const authored = reports.filter((r) => r.authoredSkill).length;
  const defaulted = reports.filter((r) => r.defaultedTriggers.length).map((r) => `${r.key}: ${r.defaultedTriggers.join("; ")}`);
  const skipped = reports.filter((r) => r.skippedMcps.length).map((r) => `${r.key}: ${r.skippedMcps.join(", ")}`);

  // Normalize the whole tenant to 405B (operator invariant) and report.
  const norm = await db.update(schema.agents).set({ model: ACQU_AGENT_MODEL }).where(eq(schema.agents.tenantId, TENANT_ID)).returning({ key: schema.agents.key });
  const all = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, TENANT_ID));
  const off = all.filter((a) => a.model !== ACQU_AGENT_MODEL).map((a) => a.key);

  console.log("\n══════════════════════════════════════════════════════════════════════════════");
  console.log(`FULL-DOCTRINE SUMMARY`);
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`  Total Acqu agents now: ${all.length}`);
  console.log(`  Seeded this run: ${remainder.length}  |  primary skills authored: ${authored}`);
  console.log(`  Normalized to ${ACQU_AGENT_MODEL}: ${norm.length} (off-model remaining: ${off.length ? off.join(", ") : "0 ✓"})`);
  if (defaulted.length) { console.log(`\n  ⚠ Trigger defaults (${defaulted.length}):`); defaulted.forEach((d) => console.log(`    - ${d}`)); }
  if (skipped.length) { console.log(`\n  ⚠ MCPs skipped (${skipped.length}):`); skipped.forEach((s) => console.log(`    - ${s}`)); }

  if (off.length) { console.error("\n✗ off-model agents remain"); process.exit(1); }
  console.log("\n✓ Full doctrine seeded and verified.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
