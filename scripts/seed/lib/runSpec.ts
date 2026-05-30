// scripts/seed/lib/runSpec.ts
// One-line entry point for each per-agent seed script: parse env, seed, print.

import { createDb } from "@agent-os/db";
import { seedAgent, type AgentSeedResult, type AgentSpec } from "./seedAgent.js";

export async function runSpec(spec: AgentSpec): Promise<AgentSeedResult> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log(`▸ Seeding ${spec.key} (tenant ${spec.tenantId.slice(0, 8)}…)`);
  const result = await seedAgent(db, spec);
  console.log(
    `✓ ${spec.key.padEnd(26)} model=${spec.model.padEnd(34)} autonomy=${spec.autonomy.padEnd(13)} cron="${spec.cron?.schedule ?? "—"}"`,
  );
  return result;
}

export async function runStandalone(spec: AgentSpec) {
  await runSpec(spec);
  process.exit(0);
}
