// scripts/seed/acqu-vitals.ts
// Seeds the `vitals` agent for tenant Acqu — doctrine-clean, DATA ONLY.
//
// Source of truth (precedence: main wins on machinery):
//   - main-acqu-agent-doctrine.md §1.5: vitals → T-cheap (Hermes 70B)
//   - main-acqu-agent-doctrine.md §3.2 skills pattern (verification-before-completion + one custom)
//   - acqu-os-session-runbook.md A3 (model=T-cheap, autonomy=execute_safe, cron 06:30, budget 0.40)
//   - acqu-agent-doctrine.md §2.9 (canonical system prompt + MCP list)

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";
import { seedAgent, type AgentSpec } from "./lib/seedAgent.js";

const TENANT_ID = TENANT_IDS.acqu;

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

export const vitalsSpec: AgentSpec = {
  tenantId: TENANT_ID,
  key: "vitals",
  name: "Vitals",
  systemPrompt: VITALS_SYSTEM_PROMPT,
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["metrics"], tags: [] },
  budgetCapUsd: "0.40",
  cron: { schedule: "30 6 * * *", jobName: "Morning vitals" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "morning-vitals", name: "Morning Vitals" },
  ],
  mcpNames: ["Pipeboard × Meta", "Close", "Slack"],
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  console.log("▸ Seeding vitals for tenant Acqu…");
  const result = await seedAgent(db, vitalsSpec);

  const [a] = await db.select().from(schema.agents).where(eq(schema.agents.id, result.agent.id));
  const prompts = await db
    .select()
    .from(schema.agentPrompts)
    .where(eq(schema.agentPrompts.agentId, result.agent.id));
  const triggers = await db
    .select()
    .from(schema.agentTriggers)
    .where(eq(schema.agentTriggers.agentId, result.agent.id));

  console.log("");
  console.log("✓ vitals seeded for tenant Acqu");
  console.log(`  agent_id           ${a!.id}`);
  console.log(`  key                ${a!.key}`);
  console.log(`  model              ${a!.model}`);
  console.log(`  autonomy           ${a!.autonomy}`);
  console.log(`  budget_cap_usd     $${a!.budgetCapUsd}`);
  console.log(`  knowledge_scope    ${JSON.stringify(a!.knowledgeScopeJson)}`);
  console.log(
    `  agent_prompts      v${result.prompt.version} (is_current=${result.prompt.isCurrent}) — ${prompts.length} row(s) total`,
  );
  console.log(
    `  agent_triggers     ${triggers.length} (cron schedule="${result.trigger?.schedule}")`,
  );
  console.log(`  jobs (projection)  ${result.jobId} (cron="${vitalsSpec.cron?.schedule}", enabled=true)`);
  console.log(`  skills             ${result.skills.join(", ")}`);
  console.log(`  mcps               ${result.mcps.join(", ")}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
