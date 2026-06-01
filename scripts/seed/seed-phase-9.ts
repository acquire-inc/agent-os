// scripts/seed/seed-phase-9.ts
// Batch-seed Phase 9 for tenant Acqu — 4 deterministic tools FIRST, then 4
// T-critical agents that bind to them. Per S8: tool registry rows must exist
// before agent bindings can resolve.
//
// HARD TIER LOCK: ALL 4 agents are T-critical (vs 7/22 in Phase 4). The
// pre-DB guard mirrors seed-phase-4.ts — if any T-critical spec's model
// drifts off anthropic/claude-opus-4.8, throw BEFORE we connect.
//
// Per AGENT-OS-PLAN.md Open Q #1 (RESOLVED): tier wins, override loses.
// seedAgent should already exempt T-critical agents from
// tenants.default_model_override; this guard is the defense-in-depth catch
// for any future PR that flips a spec literal away from opus.

import { createDb } from "@agent-os/db";
import { seedAgent, type AgentSpec } from "@agent-os/core";
import { tenantIsolationTesterSpec } from "./acqu-tenant-isolation-tester.js";
import { secretsRotationSpec } from "./acqu-secrets-rotation.js";
import { accessAuditorSpec } from "./acqu-access-auditor.js";
import { securityAnomalyWatchdogSpec } from "./acqu-security-anomaly-watchdog.js";
import { seedToolRlsTest } from "./acqu-tool-rls-test.js";
import { seedToolVaultRotate } from "./acqu-tool-vault-rotate.js";
import { seedToolAccessAudit } from "./acqu-tool-access-audit.js";
import { seedToolAccessLogAnalyzer } from "./acqu-tool-access-log-analyzer.js";
import { SKILL_SOURCE } from "./lib/runSpec.js";

const PHASE_9: AgentSpec[] = [
  tenantIsolationTesterSpec,
  secretsRotationSpec,
  accessAuditorSpec,
  securityAnomalyWatchdogSpec,
];

// ALL 4 are T-critical. Every Phase-9 agent is a can't-fail security gate.
const T_CRITICAL_KEYS = new Set([
  "tenant-isolation-tester",
  "secrets-rotation",
  "access-auditor",
  "security-anomaly-watchdog",
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

  // Hard-fail before touching the DB if any T-critical agent's spec was tampered with.
  // Pairs with the seedAgent-level exemption + the runtime cantfail.model_violation
  // assertion (AGENT-OS-PLAN.md Open Q #1 — RESOLVED).
  for (const spec of PHASE_9) {
    if (T_CRITICAL_KEYS.has(spec.key) && spec.model !== "anthropic/claude-opus-4.8") {
      throw new Error(
        `HARD FAIL: ${spec.key} is T-critical (CLAUDE.md can't-fail list) but model=${spec.model}. Must be anthropic/claude-opus-4.8. Tier wins, override loses — never flip the script literal.`,
      );
    }
  }

  const db = createDb(process.env.DATABASE_URL);

  console.log("▸ Seeding Phase 9 tools first (S8: bindings need tool rows to exist)…");
  console.log("");
  await seedToolRlsTest();
  await seedToolVaultRotate();
  await seedToolAccessAudit();
  await seedToolAccessLogAnalyzer();
  console.log("");

  console.log(`▸ Seeding Phase 9 agents: ${PHASE_9.length} T-critical agents for tenant Acqu`);
  console.log("");

  const rows: {
    key: string;
    model: string;
    autonomy: string;
    cron: string;
    budget: string;
    skills: string;
    mcps: string;
    tools: string;
  }[] = [];

  for (const spec of PHASE_9) {
    const r = await seedAgent(db, spec, { skillSource: SKILL_SOURCE });
    rows.push({
      key: r.agent.key,
      model: r.agent.model,
      autonomy: r.agent.autonomy,
      cron: r.trigger?.schedule ?? "—",
      budget: `$${r.agent.budgetCapUsd}`,
      skills: r.skills.join("+"),
      mcps: r.mcps.join("+"),
      tools: r.tools.join("+"),
    });
  }

  console.log("");
  console.log("✓ Phase 9 seeded — eyeball table:");
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
  console.log("HARD TIER LOCK CHECK: 4/4 T-critical agents resolved to anthropic/claude-opus-4.8.");
  console.log("");
  console.log("Bindings:");
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(28)} tools=[${r.tools}]  skills=[${r.skills}]  mcps=[${r.mcps}]`);
  }
  console.log("");
  console.log("HARD GATE #2 (main §6): RUN `pnpm verify:isolation-live` against a 2-tenant Supabase before Phase 10 (external launch).");
  console.log("If operator default_model_override is set on the tenant, T-critical agents IGNORE it per Open Q #1 (RESOLVED) — script literal claude-opus-4.8 wins. Non-critical tiers still rewrite to the override.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
