// Persist/read architect blueprints.

import { schema, type Db } from "@agent-os/db";
import { and, desc, eq } from "drizzle-orm";
import type { HydratedBlueprint } from "./types.js";

const { architectBlueprints } = schema;

export interface PersistArgs {
  tenantId: string;
  userId: string | null;
  prompt: string;
  teamName: string;
  rationale: string;
  llmModel: string;
  llmCostUsd: number;
  warnings: string[];
  agents: HydratedBlueprint["agents"];
  proposedSkills: HydratedBlueprint["proposedSkills"];
  proposedMcps: HydratedBlueprint["proposedMcps"];
}

export async function persistBlueprint(db: Db, args: PersistArgs): Promise<HydratedBlueprint> {
  const [row] = await db
    .insert(architectBlueprints)
    .values({
      tenantId: args.tenantId,
      createdByUserId: args.userId,
      prompt: args.prompt,
      teamName: args.teamName,
      rationale: args.rationale,
      llmModel: args.llmModel,
      llmCostUsd: args.llmCostUsd.toFixed(4),
      status: "proposed",
      warningsJson: args.warnings,
      agentsJson: args.agents,
      proposedSkillsJson: args.proposedSkills,
      proposedMcpsJson: args.proposedMcps,
      seededAgentIds: [],
    })
    .returning();
  return rowToBlueprint(row!);
}

export async function loadBlueprint(
  db: Db,
  tenantId: string,
  id: string,
): Promise<HydratedBlueprint | null> {
  const [row] = await db
    .select()
    .from(architectBlueprints)
    .where(and(eq(architectBlueprints.id, id), eq(architectBlueprints.tenantId, tenantId)))
    .limit(1);
  return row ? rowToBlueprint(row) : null;
}

export async function listBlueprints(
  db: Db,
  tenantId: string,
  limit = 20,
): Promise<HydratedBlueprint[]> {
  const rows = await db
    .select()
    .from(architectBlueprints)
    .where(eq(architectBlueprints.tenantId, tenantId))
    .orderBy(desc(architectBlueprints.createdAt))
    .limit(limit);
  return rows.map(rowToBlueprint);
}

export async function markBlueprintSeeded(
  db: Db,
  tenantId: string,
  id: string,
  seededAgentIds: string[],
): Promise<void> {
  await db
    .update(architectBlueprints)
    .set({ status: "seeded", seededAgentIds })
    .where(and(eq(architectBlueprints.id, id), eq(architectBlueprints.tenantId, tenantId)));
}

function rowToBlueprint(r: typeof architectBlueprints.$inferSelect): HydratedBlueprint {
  return {
    id: r.id,
    tenantId: r.tenantId,
    prompt: r.prompt,
    teamName: r.teamName,
    rationale: r.rationale,
    agents: r.agentsJson as HydratedBlueprint["agents"],
    warnings: r.warningsJson as string[],
    proposedSkills: r.proposedSkillsJson as HydratedBlueprint["proposedSkills"],
    proposedMcps: r.proposedMcpsJson as HydratedBlueprint["proposedMcps"],
    llmModel: r.llmModel,
    llmCostUsd: Number(r.llmCostUsd),
    status: r.status as HydratedBlueprint["status"],
    createdAt: r.createdAt,
  };
}
