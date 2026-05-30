// scripts/seed/acqu-vitals.ts
// Seeds the `vitals` agent for tenant Acqu — doctrine-clean, DATA ONLY.
// Idempotent: re-running brings the DB to the same final state.
//
// Source of truth (precedence: main wins on machinery):
//   - main-acqu-agent-doctrine.md §1.4 universal rule: start T-cheap, promote on eval failure
//   - main-acqu-agent-doctrine.md §3.2 skills pattern (verification-before-completion + one custom)
//   - acqu-os-session-runbook.md A3 (model=T-cheap, autonomy=execute_safe, cron 06:30, budget 0.40)
//   - acqu-agent-doctrine.md §2.9 (canonical system prompt + MCP list)
//
// This is the seed pattern every Phase-1 agent will follow. The shape is:
//   1. Ensure skills exist (verification-before-completion + morning-vitals)
//   2. Resolve MCPs by name (Pipeboard × Meta, Close, Slack)
//   3. Upsert the agent row (idempotent on tenant_id + key)
//   4. Upsert the agent_prompts row v1 + flip is_current; mirror to agents.persona
//   5. Upsert the agent_triggers row (type=cron, schedule="30 6 * * *")
//   6. PROJECT the cron trigger into a jobs row (backward compat)
//   7. Upsert agent_skills + agent_mcps bindings (by id, resolved from key/name)

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const TENANT_ID = TENANT_IDS.acqu;

// Canonical vitals system prompt — verbatim from acqu-agent-doctrine.md §2.9.
const VITALS_SYSTEM_PROMPT = `You are the Vitals agent. You replace the founder's morning dashboard scroll.

EVERY MORNING (06:30):
1. Pull the canonical metrics defined in kb:metrics/definitions.md for yesterday + WTD + MTD.
2. Compare each to kb:metrics/targets.md (the targets the founder set this quarter).
3. Produce a one-screen Slack snapshot:
   - HEADLINE: are we on track this week/month? One sentence.
   - The 6 numbers that matter today (spend, leads, CPL, calls, deals, MRR).
   - The 2 things to watch (anomalies, trend reversals).
   - The 1 thing to celebrate (a record, a milestone, a save).
4. Post to Slack #vitals.

RULES:
- One screen. The founder reads this in 60 seconds.
- Numbers in context. "$X spent" alone is useless; "$X spent, 12% over target" is useful.
- Never editorialize ("we should..."). That's briefing's job.
- If a number is broken or stale, say so. Don't hide it.`;

// --- helpers ----------------------------------------------------------------

type Db = ReturnType<typeof createDb>;

async function ensureSkillFromDir(db: Db, args: { key: string; name: string }) {
  const [existing] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.tenantId, TENANT_ID), eq(schema.skills.key, args.key)))
    .limit(1);
  // Always read SKILL.md to compute a content-hash version (per packages/registry pattern).
  let content = "";
  try {
    content = await readFile(join(REPO_ROOT, "external", "acqu-skills", args.key, "SKILL.md"), "utf8");
  } catch {
    /* allow seeding even if SKILL.md isn't authored yet — registry sync will fix it */
  }
  const version = content ? createHash("sha256").update(content).digest("hex").slice(0, 12) : "0.0.0";
  // Front-matter description (first description: line after ---).
  const descMatch = /\ndescription:\s*(.+)/.exec(content);
  const description = (descMatch?.[1] ?? "").replace(/^"|"$/g, "");

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

async function findMcpByName(db: Db, name: string) {
  const [row] = await db
    .select()
    .from(schema.mcps)
    .where(and(eq(schema.mcps.tenantId, TENANT_ID), eq(schema.mcps.name, name)))
    .limit(1);
  if (!row) throw new Error(`MCP "${name}" not seeded for tenant Acqu — run \`pnpm db:seed\` first.`);
  return row;
}

async function upsertAgent(db: Db, key: string, values: Partial<typeof schema.agents.$inferInsert>) {
  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, TENANT_ID), eq(schema.agents.key, key)))
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
    .values({ tenantId: TENANT_ID, key, ...values } as typeof schema.agents.$inferInsert)
    .returning();
  return row!;
}

async function upsertCurrentPrompt(db: Db, agentId: string, prompt: string) {
  // Pick a content-hash version so prompt edits bump deterministically.
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
  // New prompt version. Demote any current, insert as current.
  await db.update(schema.agentPrompts).set({ isCurrent: false }).where(eq(schema.agentPrompts.agentId, agentId));
  const [row] = await db
    .insert(schema.agentPrompts)
    .values({ tenantId: TENANT_ID, agentId, version, systemPrompt: prompt, isCurrent: true })
    .returning();
  return row!;
}

async function upsertCronTrigger(db: Db, agentId: string, schedule: string) {
  const [existing] = await db
    .select()
    .from(schema.agentTriggers)
    .where(and(eq(schema.agentTriggers.agentId, agentId), eq(schema.agentTriggers.type, "cron")))
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
    .values({ tenantId: TENANT_ID, agentId, type: "cron", schedule, enabled: true })
    .returning();
  return row!;
}

/** Project a cron agent_trigger into the existing jobs table (backward compat). */
async function projectCronTriggerToJob(db: Db, agentId: string, schedule: string, name: string) {
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
    .values({
      tenantId: TENANT_ID,
      agentId,
      name,
      scheduleCron: schedule,
      instructions: "", // empty: agent_prompts.current carries the prompt
      enabled: true,
    })
    .returning({ id: schema.jobs.id });
  return row!.id;
}

async function bindSkill(db: Db, agentId: string, skillId: string) {
  await db.execute(sql`insert into agent_skills (agent_id, skill_id) values (${agentId}, ${skillId}) on conflict do nothing`);
}
async function bindMcp(db: Db, agentId: string, mcpId: string) {
  await db.execute(sql`insert into agent_mcps (agent_id, mcp_id) values (${agentId}, ${mcpId}) on conflict do nothing`);
}

// --- main -------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  console.log("▸ Seeding vitals for tenant Acqu…");

  // 1) Skills — verification-before-completion + morning-vitals.
  const skillVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skillMorningVitals = await ensureSkillFromDir(db, { key: "morning-vitals", name: "Morning Vitals" });

  // 2) MCPs — Pipeboard × Meta, Close, Slack.
  const mcpPipeboard = await findMcpByName(db, "Pipeboard × Meta");
  const mcpClose = await findMcpByName(db, "Close");
  const mcpSlack = await findMcpByName(db, "Slack");

  // 3) Agent row. Model from main §1.4 universal rule + runbook A3 (T-cheap).
  //    Per-doctrine field mapping:
  //      doctrine.autonomy    → agents.autonomy     = execute_safe
  //      doctrine.model       → agents.model        = nousresearch/hermes-4-70b
  //      doctrine.budget      → agents.budgetCapUsd = 0.40
  //      knowledge_scope      → knowledgeScopeJson  = { folders: ["metrics"], tags: [] }
  //      persona              → mirror of current agent_prompts row (set below)
  const agent = await upsertAgent(db, "vitals", {
    name: "Vitals",
    persona: VITALS_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: "nousresearch/hermes-4-70b",
    thinkingLevel: "low",
    autonomy: "execute_safe",
    knowledgeScopeJson: { folders: ["metrics"], tags: [] },
    budgetCapUsd: "0.40",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  // 4) Versioned prompt — store in agent_prompts (doctrine shape) and keep
  //    agents.persona as the cached mirror so the existing runner path works.
  const prompt = await upsertCurrentPrompt(db, agent.id, VITALS_SYSTEM_PROMPT);

  // 5) Typed trigger — cron 06:30.
  const trigger = await upsertCronTrigger(db, agent.id, "30 6 * * *");

  // 6) Project cron trigger into jobs (backward compat with the existing scheduler).
  const jobId = await projectCronTriggerToJob(db, agent.id, "30 6 * * *", "Morning vitals");

  // 7) Bindings — skills + MCPs.
  await bindSkill(db, agent.id, skillVerify.id);
  await bindSkill(db, agent.id, skillMorningVitals.id);
  await bindMcp(db, agent.id, mcpPipeboard.id);
  await bindMcp(db, agent.id, mcpClose.id);
  await bindMcp(db, agent.id, mcpSlack.id);

  // Final verification.
  const [verifyAgent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id));
  const skills = await db.execute(sql`
    select s.key from agent_skills l join skills s on s.id = l.skill_id where l.agent_id = ${agent.id} order by s.key
  `);
  const mcps = await db.execute(sql`
    select m.name from agent_mcps l join mcps m on m.id = l.mcp_id where l.agent_id = ${agent.id} order by m.name
  `);
  const triggers = await db.select().from(schema.agentTriggers).where(eq(schema.agentTriggers.agentId, agent.id));
  const prompts = await db.select().from(schema.agentPrompts).where(eq(schema.agentPrompts.agentId, agent.id));

  console.log("");
  console.log("✓ vitals seeded for tenant Acqu");
  console.log(`  agent_id           ${verifyAgent!.id}`);
  console.log(`  key                ${verifyAgent!.key}`);
  console.log(`  model              ${verifyAgent!.model}`);
  console.log(`  autonomy           ${verifyAgent!.autonomy}`);
  console.log(`  budget_cap_usd     $${verifyAgent!.budgetCapUsd}`);
  console.log(`  knowledge_scope    ${JSON.stringify(verifyAgent!.knowledgeScopeJson)}`);
  console.log(`  agent_prompts      v${prompt.version} (is_current=${prompt.isCurrent}) — ${prompts.length} row(s) total`);
  console.log(`  agent_triggers     ${triggers.length} (cron schedule="${trigger.schedule}")`);
  console.log(`  jobs (projection)  ${jobId} (cron="30 6 * * *", enabled=true)`);
  console.log(`  skills             ${(skills as unknown as { key: string }[]).map((r) => r.key).join(", ")}`);
  console.log(`  mcps               ${(mcps as unknown as { name: string }[]).map((r) => r.name).join(", ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
