// Architect entry points — wired by apps/api routes.

import { schema, type Db } from "@agent-os/db";
import { and, eq } from "drizzle-orm";
import { seedAgent, type SkillSource } from "../seed/seedAgent.js";
import { hydrate, type ResolverContext } from "./hydrate.js";
import type { LlmClient } from "./llm.js";
import {
  listBlueprints,
  loadBlueprint,
  markBlueprintSeeded,
  persistBlueprint,
} from "./persist.js";
import { ParseError, parseTeamProposal } from "./parse.js";
import { buildSystemPrompt, buildUserPrompt, type BaseAgentSummary, type TenantContext } from "./prompt.js";
import type { ArchitectInput, HydratedBlueprint, SeedFromBlueprintResult } from "./types.js";

export * from "./types.js";
export * from "./llm.js";
export * from "./openrouterLlm.js";
export { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
export { parseTeamProposal, ParseError } from "./parse.js";
export { hydrate, isCantFail } from "./hydrate.js";
export {
  CRA_CATEGORIES,
  CRA_KEYWORDS,
  CraProhibitionError,
  assertNotCraProhibited,
  checkCraProhibition,
  type CraCategory,
  type CraCheckResult,
} from "./cra-blocklist.js";
export { loadBlueprint, listBlueprints } from "./persist.js";

const DEFAULT_LLM_BUDGET_USD = 0.2;
const REPAIR_ATTEMPTS = 1;

export interface ArchitectDeps {
  db: Db;
  llm: LlmClient;
  /** Optional override of the architect's chat model — defaults to T-reason. */
  modelHint?: string;
}

/** Read the tenant context the LLM needs (existing agents, MCPs, skills). */
export async function loadTenantContext(db: Db, tenantId: string): Promise<TenantContext> {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error(`tenant ${tenantId} not found`);

  const agents = await db
    .select({
      key: schema.agents.key,
      name: schema.agents.name,
      persona: schema.agents.persona,
    })
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, tenantId));

  const mcps = await db
    .select({ name: schema.mcps.name, status: schema.mcps.status })
    .from(schema.mcps)
    .where(eq(schema.mcps.tenantId, tenantId));

  const skills = await db
    .select({ key: schema.skills.key, name: schema.skills.name })
    .from(schema.skills)
    .where(eq(schema.skills.tenantId, tenantId));

  return {
    tenantName: tenant.name,
    existingAgents: agents.map((a) => ({
      key: a.key,
      name: a.name,
      role: (a.persona ?? "").slice(0, 120),
    })),
    connectedMcps: mcps.map((m) => ({ name: m.name, status: m.status })),
    availableSkills: skills,
  };
}

/** Load the base agent's full row + current prompt + cron, for remix prompt context. */
async function loadBaseAgent(
  db: Db,
  tenantId: string,
  key: string,
): Promise<BaseAgentSummary | null> {
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.key, key)))
    .limit(1);
  if (!agent) return null;
  const [prompt] = await db
    .select()
    .from(schema.agentPrompts)
    .where(
      and(
        eq(schema.agentPrompts.agentId, agent.id),
        eq(schema.agentPrompts.isCurrent, true),
      ),
    )
    .limit(1);
  const [trigger] = await db
    .select()
    .from(schema.agentTriggers)
    .where(
      and(
        eq(schema.agentTriggers.agentId, agent.id),
        eq(schema.agentTriggers.type, "cron"),
      ),
    )
    .limit(1);
  return {
    key: agent.key,
    name: agent.name,
    model: agent.model,
    autonomy: agent.autonomy,
    systemPrompt: prompt?.systemPrompt ?? agent.persona ?? "",
    budgetCapUsd: agent.budgetCapUsd,
    cronSchedule: trigger?.schedule ?? null,
  };
}

/** Build a ResolverContext from the tenant context — for hydrate(). */
export function resolverFromContext(ctx: TenantContext): ResolverContext {
  return {
    knownSkillKeys: new Set(ctx.availableSkills.map((s) => s.key)),
    // Only "connected" MCPs are bindable. Disconnected ones surface as warnings
    // via the hydrate() unknown-name path.
    knownMcpNames: new Set(ctx.connectedMcps.filter((m) => m.status === "connected").map((m) => m.name)),
  };
}

/** Propose a blueprint: LLM call → parse → hydrate → persist (status="proposed"). */
export async function proposeBlueprint(
  deps: ArchitectDeps,
  input: ArchitectInput,
): Promise<HydratedBlueprint> {
  const tenantCtx = await loadTenantContext(deps.db, input.tenantId);
  const system = buildSystemPrompt(tenantCtx);
  let baseAgent: BaseAgentSummary | undefined;
  if (input.mode === "remix" && input.baseAgentKey) {
    baseAgent = (await loadBaseAgent(deps.db, input.tenantId, input.baseAgentKey)) ?? undefined;
  }
  const user = buildUserPrompt(input, baseAgent);
  const budget = input.llmBudgetUsd ?? DEFAULT_LLM_BUDGET_USD;

  let totalCost = 0;
  let lastError: ParseError | null = null;
  let completionContent = "";
  let completionModel = deps.modelHint ?? "architect/unknown";

  for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt++) {
    const reply = await deps.llm.complete({
      system,
      user: attempt === 0
        ? user
        : `${user}\n\nPRIOR ATTEMPT FAILED: ${lastError?.message ?? "invalid output"}\nReturn corrected JSON only — no prose.`,
      jsonHint: true,
    });
    totalCost += reply.costUsd;
    if (totalCost > budget) {
      throw new ArchitectError(
        `architect LLM cost $${totalCost.toFixed(4)} exceeded budget $${budget.toFixed(4)}`,
        "budget_exceeded",
      );
    }
    completionContent = reply.content;
    completionModel = reply.model;
    try {
      const proposal = parseTeamProposal(completionContent);
      const resolver = resolverFromContext(tenantCtx);
      const { agents, warnings } = hydrate(input.tenantId, proposal, resolver);

      return await persistBlueprint(deps.db, {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        prompt: input.prompt,
        teamName: proposal.teamName,
        rationale: proposal.rationale,
        llmModel: completionModel,
        llmCostUsd: totalCost,
        warnings,
        agents,
        proposedSkills: proposal.proposedSkills,
        proposedMcps: proposal.proposedMcps,
      });
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      lastError = e;
    }
  }
  throw new ArchitectError(
    `architect failed to produce valid JSON after ${REPAIR_ATTEMPTS + 1} attempts: ${lastError?.message ?? "unknown"}`,
    "parse_failed",
  );
}

/** Apply an approved blueprint: seed each agent via seedAgent. Idempotent. */
export async function seedFromBlueprint(
  db: Db,
  args: { tenantId: string; blueprintId: string; skillSource: SkillSource },
): Promise<SeedFromBlueprintResult> {
  const blueprint = await loadBlueprint(db, args.tenantId, args.blueprintId);
  if (!blueprint) throw new ArchitectError(`blueprint ${args.blueprintId} not found`, "not_found");
  if (blueprint.status === "seeded") {
    // Re-read agent rows from DB so the result is deterministic.
    const keys = blueprint.agents.map((a) => a.key);
    const rows = keys.length
      ? await db
          .select({
            key: schema.agents.key,
            id: schema.agents.id,
            autonomy: schema.agents.autonomy,
            enabled: schema.agents.enabled,
          })
          .from(schema.agents)
          .where(and(eq(schema.agents.tenantId, args.tenantId)))
      : [];
    return {
      blueprintId: blueprint.id,
      seeded: rows
        .filter((r) => keys.includes(r.key))
        .map((r) => ({ key: r.key, agentId: r.id, autonomy: r.autonomy, enabled: r.enabled })),
    };
  }

  const seeded: SeedFromBlueprintResult["seeded"] = [];
  for (const spec of blueprint.agents) {
    const r = await seedAgent(db, spec, { skillSource: args.skillSource });
    seeded.push({
      key: r.agent.key,
      agentId: r.agent.id,
      autonomy: r.agent.autonomy,
      enabled: r.agent.enabled,
    });
  }
  await markBlueprintSeeded(
    db,
    args.tenantId,
    blueprint.id,
    seeded.map((s) => s.agentId),
  );
  return { blueprintId: blueprint.id, seeded };
}

export class ArchitectError extends Error {
  constructor(message: string, public readonly code: "budget_exceeded" | "parse_failed" | "not_found") {
    super(message);
  }
}
