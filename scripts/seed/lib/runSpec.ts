// Thin CLI wrapper around @agent-os/core's seedAgent: wires the disk
// SkillSource (reading from {repoRoot}/external/acqu-skills) and prints a
// one-line summary suitable for operator eyeballing.

import { createDb } from "@agent-os/db";
import {
  diskSkillSource,
  seedAgent,
  type AgentSeedResult,
  type AgentSpec,
} from "@agent-os/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/seed/lib → repo root is 3 levels up.
const REPO_ROOT = join(HERE, "..", "..", "..");
const SKILL_SOURCE = diskSkillSource(REPO_ROOT);

export async function runSpec(spec: AgentSpec): Promise<AgentSeedResult> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log(`▸ Seeding ${spec.key} (tenant ${spec.tenantId.slice(0, 8)}…)`);
  const result = await seedAgent(db, spec, { skillSource: SKILL_SOURCE });
  const displayModel = result.agent.model;
  const displayTier = result.agent.modelTier ?? spec.modelTier ?? "—";
  console.log(
    `✓ ${spec.key.padEnd(26)} tier=${displayTier.padEnd(11)} model=${displayModel.padEnd(34)} autonomy=${spec.autonomy.padEnd(13)} cron="${spec.cron?.schedule ?? "—"}"`,
  );
  return result;
}

export async function runStandalone(spec: AgentSpec) {
  await runSpec(spec);
  process.exit(0);
}

export { SKILL_SOURCE };
