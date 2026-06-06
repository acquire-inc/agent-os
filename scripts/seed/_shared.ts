// scripts/seed/_shared.ts
// Shared seed helpers — extracted verbatim from the proven acqu-vitals.ts (A3),
// extended with event/webhook/on-demand triggers and multi-cron support so the
// Phase-1 roster can reuse one idempotent helper set ("call its helpers, don't
// reinvent" — Session B Master Doc §2).
//
// Every helper is idempotent: re-running brings the DB to the same final state.
// Joins resolve key→id at seed time (schema note from A2).

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS, isCantFailAgent } from "@agent-os/shared";
import { selectBestModel, type TaskProfile } from "@agent-os/core";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql, notInArray } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
export const TENANT_ID = TENANT_IDS.acqu;

export type Db = ReturnType<typeof createDb>;

// ── Model policy — capability-driven per-task selection (model intelligence) ────────────────
// The single-model override is LIFTED. Each agent runs the model BEST SUITED to its task, decided
// by the model-intelligence layer (`@agent-os/core` model-registry): each tier maps to a task
// profile, and `selectBestModel` ranks the eligible models on the capability axes that matter and
// picks the top fit. Can't-fail tasks use the critical-judgment profile, Claude-only (never Hermes).
// The Claude Agent SDK stays the runtime; only the routed model varies. Selection is capability —
// pricing is reference knowledge, refreshed from OpenRouter (see core model-registry).
export type Tier = "T-cheap" | "T-reason" | "T-work" | "T-critical";

const PROFILE_FOR_TIER: Record<Tier, TaskProfile> = {
  "T-cheap": "speed",
  "T-reason": "reasoning",
  "T-work": "agentic",
  "T-critical": "judgment",
};
const HERMES_PREFIX = "nousresearch/";

/** The optimal model for an agent: can't-fail → best critical-judgment Claude model (never Hermes);
 *  else the best-fit model for the agent's tier task profile. Decided by the intelligence layer. */
export function modelForAgent(key: string, tier: Tier): string {
  return isCantFailAgent(key)
    ? selectBestModel("critical-judgment", { requireClaude: true }).slug
    : selectBestModel(PROFILE_FOR_TIER[tier]).slug;
}

/** The model a can't-fail agent routes to (Opus). Derived from the intelligence layer. */
export const CANT_FAIL_MODEL = selectBestModel("critical-judgment", { requireClaude: true }).slug;
/** The current best-fit model per tier (derived) — back-compat for callers that want the map. */
export const MODEL_FOR_TIER: Record<Tier, string> = {
  "T-cheap": selectBestModel("speed").slug,
  "T-reason": selectBestModel("reasoning").slug,
  "T-work": selectBestModel("agentic").slug,
  "T-critical": selectBestModel("judgment").slug,
};

/** Safety invariant: a can't-fail agent may never run on a Hermes slug. */
export function isCantFailOnHermes(key: string, model: string): boolean {
  return isCantFailAgent(key) && model.startsWith(HERMES_PREFIX);
}

// Minimum per-run budget cap (USD). Can't-fail agents run on Opus (~$15/$75 per M tokens), so a
// Hermes-era cap like $0.20 would KILL them mid-judgment (kill = cap×1.5). Floor them so a
// high-stakes safety run always has headroom; everyone else keeps a sane non-zero minimum. The
// floor only ever RAISES a too-tight budget — a generous doctrine budget is left untouched.
const CANT_FAIL_BUDGET_FLOOR = 1.0;
const BASE_BUDGET_FLOOR = 0.05;
export function budgetFloorForAgent(key: string): number {
  return isCantFailAgent(key) ? CANT_FAIL_BUDGET_FLOOR : BASE_BUDGET_FLOOR;
}
/** Apply the floor to a parsed/hand-set budget (string in, 2dp string out). Never lowers. */
export function floorBudget(key: string, budget: string | number): string {
  return Math.max(Number(budget) || 0, budgetFloorForAgent(key)).toFixed(2);
}

// Back-compat default (the reasoning-tier slug). NOT a fleet override anymore — only T-reason
// agents land here; everything else is routed by `modelForAgent`.
export const ACQU_AGENT_MODEL = MODEL_FOR_TIER["T-reason"];

/** Ensure a skill row exists for tenant Acqu, sourced from external/acqu-skills/{key}/SKILL.md. */
export async function ensureSkillFromDir(db: Db, args: { key: string; name: string }) {
  const [existing] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.tenantId, TENANT_ID), eq(schema.skills.key, args.key)))
    .limit(1);
  let content = "";
  try {
    content = await readFile(join(REPO_ROOT, "external", "acqu-skills", args.key, "SKILL.md"), "utf8");
  } catch {
    throw new Error(
      `SKILL.md missing for "${args.key}" — author external/acqu-skills/${args.key}/SKILL.md before binding it (Master Doc §3: author, then bind).`,
    );
  }
  const version = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const descMatch = /\ndescription:\s*(.+)/.exec(content);
  const description = (descMatch?.[1] ?? "").replace(/^"|"$/g, "");
  // B: parse `allowed-tools` from the SKILL.md frontmatter (least privilege at the skill
  // layer). Supports an inline list `allowed-tools: [tool.a, tool.b]` or a YAML block of
  // `- tool.x` lines. Only tool.* keys are kept.
  const allowedTools = parseAllowedTools(content);

  if (!existing) {
    const [row] = await db
      .insert(schema.skills)
      .values({
        tenantId: TENANT_ID,
        projectId: null,
        key: args.key,
        name: args.name,
        description,
        version,
        source: "github",
        repoPath: `acqu-skills/${args.key}`,
        scope: "global",
        allowedToolsJson: allowedTools,
        enabled: true,
      })
      .returning();
    return row!;
  }
  const existingTools = JSON.stringify((existing.allowedToolsJson as string[]) ?? []);
  if (
    existing.version !== version ||
    existing.description !== description ||
    existing.name !== args.name ||
    existingTools !== JSON.stringify(allowedTools)
  ) {
    const [row] = await db
      .update(schema.skills)
      .set({ name: args.name, description, version, allowedToolsJson: allowedTools })
      .where(eq(schema.skills.id, existing.id))
      .returning();
    return row!;
  }
  return existing;
}

/** Parse tool.* keys from a SKILL.md `allowed-tools` frontmatter entry (inline list or YAML block). */
function parseAllowedTools(content: string): string[] {
  const keys = new Set<string>();
  const inline = /\nallowed-tools:\s*\[([^\]]*)\]/.exec(content);
  if (inline?.[1]) for (const m of inline[1].matchAll(/tool\.[a-z0-9][a-z0-9-]*/g)) keys.add(m[0]);
  // YAML block form: `allowed-tools:` followed by `  - tool.x` lines.
  const block = /\nallowed-tools:\s*\n((?:\s*-\s*tool\.[a-z0-9-]+\s*\n?)+)/.exec(content);
  if (block?.[1]) for (const m of block[1].matchAll(/tool\.[a-z0-9][a-z0-9-]*/g)) keys.add(m[0]);
  return [...keys];
}

export async function findMcpByName(db: Db, name: string) {
  const [row] = await db
    .select()
    .from(schema.mcps)
    .where(and(eq(schema.mcps.tenantId, TENANT_ID), eq(schema.mcps.name, name)))
    .limit(1);
  if (!row) throw new Error(`MCP "${name}" not seeded for tenant Acqu — run \`pnpm db:seed\` first.`);
  return row;
}

export async function upsertAgent(db: Db, key: string, values: Partial<typeof schema.agents.$inferInsert>) {
  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, TENANT_ID), eq(schema.agents.key, key)))
    .limit(1);
  if (existing) {
    const [row] = await db.update(schema.agents).set(values).where(eq(schema.agents.id, existing.id)).returning();
    return row!;
  }
  const [row] = await db
    .insert(schema.agents)
    .values({ tenantId: TENANT_ID, key, ...values } as typeof schema.agents.$inferInsert)
    .returning();
  return row!;
}

export async function upsertCurrentPrompt(db: Db, agentId: string, prompt: string) {
  const version = parseInt(createHash("sha256").update(prompt).digest("hex").slice(0, 4), 16);
  const [existing] = await db
    .select()
    .from(schema.agentPrompts)
    .where(and(eq(schema.agentPrompts.agentId, agentId), eq(schema.agentPrompts.version, version)))
    .limit(1);
  if (existing) {
    if (!existing.isCurrent) {
      await db.update(schema.agentPrompts).set({ isCurrent: false }).where(eq(schema.agentPrompts.agentId, agentId));
      await db.update(schema.agentPrompts).set({ isCurrent: true }).where(eq(schema.agentPrompts.id, existing.id));
    }
    return existing;
  }
  await db.update(schema.agentPrompts).set({ isCurrent: false }).where(eq(schema.agentPrompts.agentId, agentId));
  const [row] = await db
    .insert(schema.agentPrompts)
    .values({ tenantId: TENANT_ID, agentId, version, systemPrompt: prompt, isCurrent: true })
    .returning();
  return row!;
}

/** Idempotent cron trigger — keyed on (agent, type=cron, schedule) so an agent can hold multiple cron ticks. */
export async function upsertCronTrigger(db: Db, agentId: string, schedule: string) {
  const [existing] = await db
    .select()
    .from(schema.agentTriggers)
    .where(
      and(
        eq(schema.agentTriggers.agentId, agentId),
        eq(schema.agentTriggers.type, "cron"),
        eq(schema.agentTriggers.schedule, schedule),
      ),
    )
    .limit(1);
  if (existing) {
    if (!existing.enabled) {
      const [row] = await db
        .update(schema.agentTriggers)
        .set({ enabled: true })
        .where(eq(schema.agentTriggers.id, existing.id))
        .returning();
      return row!;
    }
    return existing;
  }
  const [row] = await db
    .insert(schema.agentTriggers)
    .values({ tenantId: TENANT_ID, agentId, type: "cron", schedule, enabled: true })
    .returning();
  return row!;
}

/** Idempotent typed trigger for non-cron types — webhook / state / on_demand (per the
 *  agent_triggers check constraint in migration 0005). Keyed on (agent, type, eventKey). */
export async function upsertTypedTrigger(
  db: Db,
  agentId: string,
  type: "webhook" | "state" | "on_demand",
  eventKey: string | null,
) {
  const whereClause = eventKey
    ? and(eq(schema.agentTriggers.agentId, agentId), eq(schema.agentTriggers.type, type), eq(schema.agentTriggers.eventKey, eventKey))
    : and(eq(schema.agentTriggers.agentId, agentId), eq(schema.agentTriggers.type, type));
  const [existing] = await db.select().from(schema.agentTriggers).where(whereClause).limit(1);
  if (existing) {
    if (!existing.enabled) {
      const [row] = await db
        .update(schema.agentTriggers)
        .set({ enabled: true })
        .where(eq(schema.agentTriggers.id, existing.id))
        .returning();
      return row!;
    }
    return existing;
  }
  const [row] = await db
    .insert(schema.agentTriggers)
    .values({ tenantId: TENANT_ID, agentId, type, eventKey, enabled: true })
    .returning();
  return row!;
}

/** Project a cron agent_trigger into the existing jobs table (backward compat). Keyed on (tenant, agent, name). */
export async function projectCronTriggerToJob(db: Db, agentId: string, schedule: string, name: string) {
  const [existing] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tenantId, TENANT_ID), eq(schema.jobs.agentId, agentId), eq(schema.jobs.name, name)))
    .limit(1);
  if (existing) {
    if (existing.scheduleCron !== schedule || !existing.enabled) {
      await db.update(schema.jobs).set({ scheduleCron: schedule, enabled: true }).where(eq(schema.jobs.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await db
    .insert(schema.jobs)
    .values({ tenantId: TENANT_ID, agentId, name, scheduleCron: schedule, instructions: "", enabled: true })
    .returning({ id: schema.jobs.id });
  return row!.id;
}

export async function bindSkill(db: Db, agentId: string, skillId: string) {
  await db.execute(sql`insert into agent_skills (agent_id, skill_id) values (${agentId}, ${skillId}) on conflict do nothing`);
}
export async function bindMcp(db: Db, agentId: string, mcpId: string) {
  await db.execute(sql`insert into agent_mcps (agent_id, mcp_id) values (${agentId}, ${mcpId}) on conflict do nothing`);
}

/** Make an agent's skill bindings EXACTLY the given set — prune strays (e.g. demo-fixture
 *  leftovers), then add the declared ones. Idempotent + doctrine-clean (least privilege). */
export async function setSkills(db: Db, agentId: string, skillIds: string[]) {
  await db.delete(schema.agentSkills).where(
    skillIds.length
      ? and(eq(schema.agentSkills.agentId, agentId), notInArray(schema.agentSkills.skillId, skillIds))
      : eq(schema.agentSkills.agentId, agentId),
  );
  for (const id of skillIds) await bindSkill(db, agentId, id);
}

/** Make an agent's MCP bindings EXACTLY the given set — prune strays, then add the declared ones. */
export async function setMcps(db: Db, agentId: string, mcpIds: string[]) {
  await db.delete(schema.agentMcps).where(
    mcpIds.length
      ? and(eq(schema.agentMcps.agentId, agentId), notInArray(schema.agentMcps.mcpId, mcpIds))
      : eq(schema.agentMcps.agentId, agentId),
  );
  for (const id of mcpIds) await bindMcp(db, agentId, id);
}

export async function bindTool(db: Db, agentId: string, toolId: string) {
  await db.execute(sql`insert into agent_tools (agent_id, tool_id) values (${agentId}, ${toolId}) on conflict do nothing`);
}

/** Make an agent's tool bindings EXACTLY the given set — prune strays, then add the declared ones.
 *  Idempotent + doctrine-clean (least privilege): an agent may only call the tools it declares. */
export async function setTools(db: Db, agentId: string, toolIds: string[]) {
  await db.delete(schema.agentTools).where(
    toolIds.length
      ? and(eq(schema.agentTools.agentId, agentId), notInArray(schema.agentTools.toolId, toolIds))
      : eq(schema.agentTools.agentId, agentId),
  );
  for (const id of toolIds) await bindTool(db, agentId, id);
}

/** Read back a seeded agent's bound skills/mcps/triggers/prompt for the verification line. */
export async function summarizeAgent(db: Db, agentId: string) {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  const skills = (await db.execute(
    sql`select s.key from agent_skills l join skills s on s.id = l.skill_id where l.agent_id = ${agentId} order by s.key`,
  )) as unknown as { key: string }[];
  const mcps = (await db.execute(
    sql`select m.name from agent_mcps l join mcps m on m.id = l.mcp_id where l.agent_id = ${agentId} order by m.name`,
  )) as unknown as { name: string }[];
  const triggers = await db.select().from(schema.agentTriggers).where(eq(schema.agentTriggers.agentId, agentId));
  const [current] = await db
    .select()
    .from(schema.agentPrompts)
    .where(and(eq(schema.agentPrompts.agentId, agentId), eq(schema.agentPrompts.isCurrent, true)));
  return {
    agent: agent!,
    skills: skills.map((r) => r.key),
    mcps: mcps.map((r) => r.name),
    triggers: triggers.map((t) => ({ type: t.type, schedule: t.schedule, eventKey: t.eventKey })),
    promptVersion: current?.version ?? null,
  };
}
