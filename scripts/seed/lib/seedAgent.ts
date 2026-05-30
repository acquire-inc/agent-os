// scripts/seed/lib/seedAgent.ts
// Shared, idempotent helpers for seeding an agent as DATA.
// Re-running brings the DB to the same final state.
//
// Source of truth: doctrine docs in /docs/. The seed scripts in this folder are
// thin specs (data) that resolve through `seedAgent(db, spec)` below.

import { createDb, schema } from "@agent-os/db";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

type Db = ReturnType<typeof createDb>;

// ---------- skills --------------------------------------------------------

export async function ensureSkillFromDir(
  db: Db,
  tenantId: string,
  args: { key: string; name: string },
) {
  const [existing] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.tenantId, tenantId), eq(schema.skills.key, args.key)))
    .limit(1);

  let content = "";
  try {
    content = await readFile(
      join(REPO_ROOT, "external", "acqu-skills", args.key, "SKILL.md"),
      "utf8",
    );
  } catch {
    /* allow seeding even if SKILL.md isn't authored yet */
  }
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

// ---------- the high-level spec -------------------------------------------

export type AgentSpec = {
  tenantId: string;
  key: string;
  name: string;
  systemPrompt: string;
  model: string;
  thinkingLevel?: "low" | "medium" | "high";
  autonomy: "propose" | "execute_safe" | "execute_full";
  backend?: string;
  knowledgeScope: { folders: string[]; tags: string[] };
  budgetCapUsd: string;
  escalationPolicy?: string | null;
  runnerKind?: string;
  cron?: { schedule: string; jobName: string } | null;
  skills: { key: string; name: string }[];
  mcpNames: string[];
};

export type AgentSeedResult = {
  agent: typeof schema.agents.$inferSelect;
  prompt: typeof schema.agentPrompts.$inferSelect;
  trigger: typeof schema.agentTriggers.$inferSelect | null;
  jobId: string | null;
  skills: string[];
  mcps: string[];
};

/** Seed a single agent end-to-end. Idempotent: safe to re-run. */
export async function seedAgent(db: Db, spec: AgentSpec): Promise<AgentSeedResult> {
  const skillRows = await Promise.all(
    spec.skills.map((s) => ensureSkillFromDir(db, spec.tenantId, s)),
  );
  const mcpRows = await Promise.all(spec.mcpNames.map((n) => findMcpByName(db, spec.tenantId, n)));

  const agent = await upsertAgent(db, spec.tenantId, spec.key, {
    name: spec.name,
    persona: spec.systemPrompt,
    backend: spec.backend ?? "claude-agent-sdk",
    model: spec.model,
    thinkingLevel: spec.thinkingLevel ?? "low",
    autonomy: spec.autonomy,
    knowledgeScopeJson: spec.knowledgeScope,
    budgetCapUsd: spec.budgetCapUsd,
    escalationPolicy: spec.escalationPolicy ?? null,
    runnerKind: spec.runnerKind ?? "local",
    enabled: true,
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

  return {
    agent,
    prompt,
    trigger,
    jobId,
    skills: skillRows.map((s) => s.key),
    mcps: mcpRows.map((m) => m.name),
  };
}
