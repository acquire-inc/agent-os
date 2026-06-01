// Idempotent agent-seeding helpers — single source of truth used by:
//   1) scripts/seed/* (operator CLI for hand-authored Acqu agents)
//   2) the Architect (LLM-driven agent creation)
//
// Re-running with the same AgentSpec brings the DB to the same final state.
// A change to the systemPrompt creates a new versioned row in agent_prompts.

import { schema, type Db } from "@agent-os/db";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { isCantFail } from "../architect/hydrate.js";
import { resolveModel } from "../router/resolve.js";
import { emit } from "../relay/emit.js";

export interface SkillSource {
  readSkillMd(key: string): Promise<string | null>;
}

/** Default reader: pulls from {repoRoot}/external/acqu-skills/{key}/SKILL.md. */
export function diskSkillSource(repoRoot: string): SkillSource {
  return {
    async readSkillMd(key) {
      try {
        return await readFile(join(repoRoot, "external", "acqu-skills", key, "SKILL.md"), "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** Tests / in-process callers: provide content by key. */
export function inMemorySkillSource(map: Record<string, string>): SkillSource {
  return { async readSkillMd(key) { return map[key] ?? null; } };
}

// ---------- skills --------------------------------------------------------

export async function ensureSkillFromDir(
  db: Db,
  tenantId: string,
  args: { key: string; name: string },
  source: SkillSource,
) {
  const [existing] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.tenantId, tenantId), eq(schema.skills.key, args.key)))
    .limit(1);

  const content = (await source.readSkillMd(args.key)) ?? "";
  const version = content
    ? createHash("sha256").update(content).digest("hex").slice(0, 12)
    : "0.0.0";
  const descMatch = /\ndescription:\s*(.+)/.exec(content);
  const description = (descMatch?.[1] ?? "").replace(/^"|"$/g, "");

  if (!existing) {
    const [row] = await db
      .insert(schema.skills)
      .values({
        tenantId,
        projectId: null,
        key: args.key,
        name: args.name,
        description,
        version,
        source: "github",
        repoPath: `acqu-skills/${args.key}`,
        scope: "global",
        enabled: true,
      })
      .returning();
    return row!;
  }
  if (content && existing.version !== version) {
    const [row] = await db
      .update(schema.skills)
      .set({ name: args.name, description, version })
      .where(eq(schema.skills.id, existing.id))
      .returning();
    return row!;
  }
  return existing;
}

// ---------- mcps ----------------------------------------------------------

export async function findMcpByName(db: Db, tenantId: string, name: string) {
  const [row] = await db
    .select()
    .from(schema.mcps)
    .where(and(eq(schema.mcps.tenantId, tenantId), eq(schema.mcps.name, name)))
    .limit(1);
  if (!row)
    throw new Error(
      `MCP "${name}" not seeded for tenant ${tenantId} — run \`pnpm db:seed\` first.`,
    );
  return row;
}

// ---------- tools ---------------------------------------------------------

/**
 * Ensure a tools row exists for (tenantId, key); insert if absent, return the row.
 *
 * Mirrors {@link ensureSkillFromDir} but simpler — tools are pure DB rows, no disk
 * read and no version compute. Tools are DATA (CLAUDE.md non-negotiable #1): adding
 * one is a configuration insert, not new application code.
 *
 * Safety defaults mirror the 0007 DDL: `requiresApproval` defaults to `true` so a
 * tool is deny-by-default until an author explicitly opts it out (T-7-07).
 */
export async function ensureTool(
  db: Db,
  tenantId: string,
  args: {
    key: string;
    name: string;
    kind?: "custom" | "mcp";
    description?: string;
    inputSchema?: unknown;
    requiresApproval?: boolean;
    reversible?: boolean;
  },
) {
  const [existing] = await db
    .select()
    .from(schema.tools)
    .where(and(eq(schema.tools.tenantId, tenantId), eq(schema.tools.key, args.key)))
    .limit(1);

  if (!existing) {
    const [row] = await db
      .insert(schema.tools)
      .values({
        tenantId,
        key: args.key,
        name: args.name,
        description: args.description ?? "",
        kind: args.kind ?? "custom",
        inputSchema: args.inputSchema ?? {},
        requiresApproval: args.requiresApproval ?? true,
        reversible: args.reversible ?? false,
      })
      .returning();
    return row!;
  }
  return existing;
}

// ---------- agent ---------------------------------------------------------

type AgentInsert = typeof schema.agents.$inferInsert;

export async function upsertAgent(
  db: Db,
  tenantId: string,
  key: string,
  values: Partial<AgentInsert>,
) {
  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.key, key)))
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(schema.agents)
      .set(values)
      .where(eq(schema.agents.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(schema.agents)
    .values({ tenantId, key, ...values } as AgentInsert)
    .returning();
  return row!;
}

// ---------- versioned prompt ----------------------------------------------

export async function upsertCurrentPrompt(db: Db, tenantId: string, agentId: string, prompt: string) {
  const version = parseInt(createHash("sha256").update(prompt).digest("hex").slice(0, 4), 16);
  const [existing] = await db
    .select()
    .from(schema.agentPrompts)
    .where(
      and(eq(schema.agentPrompts.agentId, agentId), eq(schema.agentPrompts.version, version)),
    )
    .limit(1);
  if (existing) {
    if (!existing.isCurrent) {
      await db
        .update(schema.agentPrompts)
        .set({ isCurrent: false })
        .where(eq(schema.agentPrompts.agentId, agentId));
      await db
        .update(schema.agentPrompts)
        .set({ isCurrent: true })
        .where(eq(schema.agentPrompts.id, existing.id));
    }
    return existing;
  }
  await db
    .update(schema.agentPrompts)
    .set({ isCurrent: false })
    .where(eq(schema.agentPrompts.agentId, agentId));
  const [row] = await db
    .insert(schema.agentPrompts)
    .values({ tenantId, agentId, version, systemPrompt: prompt, isCurrent: true })
    .returning();
  return row!;
}

// ---------- triggers ------------------------------------------------------

export async function upsertCronTrigger(db: Db, tenantId: string, agentId: string, schedule: string) {
  const [existing] = await db
    .select()
    .from(schema.agentTriggers)
    .where(
      and(eq(schema.agentTriggers.agentId, agentId), eq(schema.agentTriggers.type, "cron")),
    )
    .limit(1);
  if (existing) {
    if (existing.schedule !== schedule || !existing.enabled) {
      const [row] = await db
        .update(schema.agentTriggers)
        .set({ schedule, enabled: true })
        .where(eq(schema.agentTriggers.id, existing.id))
        .returning();
      return row!;
    }
    return existing;
  }
  const [row] = await db
    .insert(schema.agentTriggers)
    .values({ tenantId, agentId, type: "cron", schedule, enabled: true })
    .returning();
  return row!;
}

/** Project a cron agent_trigger into the existing jobs table (backward compat). */
export async function projectCronTriggerToJob(
  db: Db,
  tenantId: string,
  agentId: string,
  schedule: string,
  name: string,
) {
  const [existing] = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.tenantId, tenantId),
        eq(schema.jobs.agentId, agentId),
        eq(schema.jobs.name, name),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.scheduleCron !== schedule || !existing.enabled) {
      await db
        .update(schema.jobs)
        .set({ scheduleCron: schedule, enabled: true })
        .where(eq(schema.jobs.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await db
    .insert(schema.jobs)
    .values({
      tenantId,
      agentId,
      name,
      scheduleCron: schedule,
      instructions: "",
      enabled: true,
    })
    .returning({ id: schema.jobs.id });
  return row!.id;
}

// ---------- bindings ------------------------------------------------------

export async function bindSkill(db: Db, agentId: string, skillId: string) {
  await db.execute(
    sql`insert into agent_skills (agent_id, skill_id) values (${agentId}, ${skillId}) on conflict do nothing`,
  );
}

export async function bindMcp(db: Db, agentId: string, mcpId: string) {
  await db.execute(
    sql`insert into agent_mcps (agent_id, mcp_id) values (${agentId}, ${mcpId}) on conflict do nothing`,
  );
}

/**
 * Bind a tool to an agent via the `agent_tools` join — idempotent.
 *
 * Mirrors {@link bindSkill}/{@link bindMcp} exactly: a parameterized `sql` tagged
 * template with `on conflict do nothing`, so re-running a seed never duplicates the
 * join row (T-7-06: parameterized — no string concat).
 */
export async function bindTool(db: Db, agentId: string, toolId: string) {
  await db.execute(
    sql`insert into agent_tools (agent_id, tool_id) values (${agentId}, ${toolId}) on conflict do nothing`,
  );
}

// ---------- the high-level spec -------------------------------------------

export type AgentSpec = {
  tenantId: string;
  key: string;
  name: string;
  systemPrompt: string;
  /**
   * Explicit per-agent model override. Optional under the Model Router (Step 2.5):
   * when present, wins over tier resolution (the eval-promotion lever — a
   * doctrine spec or the agent-evaluator can hand-pin a model). When absent,
   * resolveModel() picks based on modelTier + tenants.tier_overrides +
   * DEFAULT_TIER_MODELS. T-critical agents ALWAYS pin to Opus regardless of
   * this field (Open Q #1 RESOLVED).
   */
  model?: string;
  /**
   * Tier intent — the router resolves this to a model slug at seed time via
   * DEFAULT_TIER_MODELS + tenants.tier_overrides. Required for new agents;
   * legacy agents without it may rely on the explicit `model` field above.
   */
  modelTier?: import("../router/tier-models.js").ModelTier;
  thinkingLevel?: "low" | "medium" | "high";
  autonomy: "propose" | "execute_safe" | "execute_full";
  backend?: string;
  knowledgeScope: { folders: string[]; tags: string[] };
  budgetCapUsd: string;
  escalationPolicy?: string | null;
  runnerKind?: string;
  /** When false, the runner skips this agent. Architect seeds with `false` until first dry-run. */
  enabled?: boolean;
  cron?: { schedule: string; jobName: string } | null;
  skills: { key: string; name: string }[];
  mcpNames: string[];
  /**
   * Tools to ensure-and-bind for this agent. OPTIONAL by design (Pitfall 1): the
   * `?` is load-bearing — making it required would break all 26+ existing seed
   * scripts that predate the tools registry. Absent → no tool work (defaults to []).
   * Tools are DATA (CLAUDE.md non-negotiable #1): a spec adds one as config, not code.
   */
  tools?: { key: string; name: string; kind?: "custom" | "mcp"; requiresApproval?: boolean }[];
};

export type AgentSeedResult = {
  agent: typeof schema.agents.$inferSelect;
  prompt: typeof schema.agentPrompts.$inferSelect;
  trigger: typeof schema.agentTriggers.$inferSelect | null;
  jobId: string | null;
  skills: string[];
  mcps: string[];
  tools: string[];
};

/** Seed a single agent end-to-end. Idempotent: safe to re-run. */
export async function seedAgent(
  db: Db,
  spec: AgentSpec,
  options: { skillSource: SkillSource },
): Promise<AgentSeedResult> {
  const skillRows = await Promise.all(
    spec.skills.map((s) => ensureSkillFromDir(db, spec.tenantId, s, options.skillSource)),
  );
  const mcpRows = await Promise.all(spec.mcpNames.map((n) => findMcpByName(db, spec.tenantId, n)));
  // Tools are optional (Pitfall 1): `?? []` makes the no-tools path a no-op so every
  // pre-existing seed continues to pass unchanged.
  const toolRows = await Promise.all(
    (spec.tools ?? []).map((t) => ensureTool(db, spec.tenantId, t)),
  );

  // MODEL ROUTER (Step 2.5) — resolve the agent's fuel via the declarative
  // tier intent + per-tenant overrides. The router lives in packages/core/src/
  // router/. T-critical agents are EXEMPT and pin to Opus per Open Q #1 RESOLVED;
  // the runner's cantfail.model_violation assertion is the belt, this is the
  // suspenders.
  //
  // Legacy tenants.default_model_override is still read as a fallback (blunt
  // instrument — applies to all non-critical tiers when set). Operators
  // should migrate to tenants.tier_overrides for per-tier control. Deprecation
  // warning fires on first encounter.
  const [tenant] = await db
    .select({
      defaultModelOverride: schema.tenants.defaultModelOverride,
      tierOverrides: schema.tenants.tierOverrides,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, spec.tenantId))
    .limit(1);
  const cantFail = isCantFail(spec.key);

  // Compose effective tenant overrides + the legacy spec.model override path.
  //
  // New mechanism (preferred): tenants.tier_overrides jsonb. Per-tier control.
  // resolveModel() reads it after the spec.model check.
  //
  // Legacy mechanism (deprecated, kept for back-compat): tenants.default_
  // model_override rewrites spec.model directly for non-T-critical agents.
  // This is the BLUNT instrument the doctrine called out — under the router
  // we honor it but recommend migrating to tier_overrides. T-critical is
  // EXEMPT regardless of which mechanism is set.
  const hasTierOverrides =
    tenant?.tierOverrides && Object.keys(tenant.tierOverrides).length > 0;
  const effectiveTenantOverrides = hasTierOverrides
    ? (tenant!.tierOverrides as Record<string, string>)
    : null;

  // Apply legacy default_model_override to spec.model BEFORE the router sees
  // it, so the resolver's "explicit spec.model wins" branch picks up the
  // legacy override on non-T-critical agents.
  let effectiveSpecModel = spec.model ?? null;
  if (
    tenant?.defaultModelOverride &&
    !cantFail &&
    !hasTierOverrides &&
    tenant.defaultModelOverride !== spec.model
  ) {
    console.warn(
      `[seedAgent] ${spec.tenantId}: tenants.default_model_override is DEPRECATED — ` +
        `migrate to tenants.tier_overrides jsonb (per-tier control). Applying legacy ` +
        `override: ${spec.model ?? "<unset>"} -> ${tenant.defaultModelOverride}.`,
    );
    effectiveSpecModel = tenant.defaultModelOverride;
  }

  const resolution = resolveModel({
    agentKey: spec.key,
    isCantFail: cantFail,
    modelTier: spec.modelTier ?? null,
    specModel: effectiveSpecModel,
    tenantOverrides: effectiveTenantOverrides,
  });

  // Emit model.routed for the audit trail. Best-effort — if the Relay emit
  // fails, log + continue (the seed write is what matters; the audit trail
  // is observability). This is NOT inside a tx with the agent insert because
  // upsertAgent is itself idempotent and the router event is observability
  // not authorization. If a re-seed picks the same tier/model, the eventKey
  // makes the Relay write a no-op.
  await emit(db, {
    tenantId: spec.tenantId,
    eventName: "model.routed",
    actor: "system",
    payload: {
      agent_key: spec.key,
      tier: resolution.tier,
      resolved_model: resolution.model,
      reason: resolution.reason,
    },
    eventKey: `model.routed:${spec.tenantId}:${spec.key}:${resolution.model}`,
  }).catch((e) => {
    console.warn(
      `[seedAgent] model.routed emit failed for ${spec.key}: ${(e as Error).message}`,
    );
  });

  if (resolution.model !== spec.model && spec.model) {
    console.log(
      `[seedAgent] ${spec.key}: router resolved tier=${resolution.tier} → ${resolution.model} (reason: ${resolution.reason})`,
    );
  }

  const effectiveModel = resolution.model;
  const effectiveTier = resolution.tier;

  const agent = await upsertAgent(db, spec.tenantId, spec.key, {
    name: spec.name,
    persona: spec.systemPrompt,
    backend: spec.backend ?? "claude-agent-sdk",
    model: effectiveModel,
    modelTier: effectiveTier,
    thinkingLevel: spec.thinkingLevel ?? "low",
    autonomy: spec.autonomy,
    knowledgeScopeJson: spec.knowledgeScope,
    budgetCapUsd: spec.budgetCapUsd,
    escalationPolicy: spec.escalationPolicy ?? null,
    runnerKind: spec.runnerKind ?? "local",
    enabled: spec.enabled ?? true,
    templateId: null,
  });

  const prompt = await upsertCurrentPrompt(db, spec.tenantId, agent.id, spec.systemPrompt);

  let trigger: typeof schema.agentTriggers.$inferSelect | null = null;
  let jobId: string | null = null;
  if (spec.cron) {
    trigger = await upsertCronTrigger(db, spec.tenantId, agent.id, spec.cron.schedule);
    jobId = await projectCronTriggerToJob(
      db,
      spec.tenantId,
      agent.id,
      spec.cron.schedule,
      spec.cron.jobName,
    );
  }

  for (const s of skillRows) await bindSkill(db, agent.id, s.id);
  for (const m of mcpRows) await bindMcp(db, agent.id, m.id);
  for (const t of toolRows) await bindTool(db, agent.id, t.id);

  return {
    agent,
    prompt,
    trigger,
    jobId,
    skills: skillRows.map((s) => s.key),
    mcps: mcpRows.map((m) => m.name),
    tools: toolRows.map((t) => t.key),
  };
}
