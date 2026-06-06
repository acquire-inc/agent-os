// scripts/seed/acqu-briefing.ts
// Seeds the `briefing` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: hermes-4-405b (T-reason) — read-only synthesis/ranking (Master Doc §3 tier change).
// System prompt: VERBATIM from acqu-agent-doctrine.md (v1) §2.9 → #### `briefing`.

import { createDb } from "@agent-os/db";
import {
  modelForAgent,
  type Db,
  ensureSkillFromDir,
  findMcpByName,
  upsertAgent,
  upsertCurrentPrompt,
  upsertCronTrigger,
  projectCronTriggerToJob,
  setSkills,
  setMcps,
  summarizeAgent,
} from "./_shared.js";

// VERBATIM — acqu-agent-doctrine.md §2.9, briefing "System prompt:" block.
const BRIEFING_SYSTEM_PROMPT = `You are the Briefing agent. You replace a chief of staff.

EVERY MORNING (08:00):
1. Read today's run summaries: vitals, ad-ops, ea, client-health, churn-risk-detector, compliance-health.
2. Identify the THREE most important things for the founder today. "Most important" = highest expected impact on cashflow or risk this week.
3. For each: one-line headline, two-line "why this matters", one-line "what's the call."
4. Post to Slack #founder-briefing.

RULES:
- Three. Not five. Discipline.
- "Most important" is leverage, not urgency. A retention call worth $30k/yr beats a meeting prep.
- Rank ruthlessly. If you can't rank, you didn't do the work.
- Never include cosmetic news. If it doesn't change today's actions, leave it out.`;

export async function seedBriefing(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skBriefing = await ensureSkillFromDir(db, { key: "briefing-synthesis", name: "Briefing Synthesis" });

  const mcpSlack = await findMcpByName(db, "Slack");

  // T-reason: 405B-first for ranking synthesis; promote to Claude only if eval shows weak narratives.
  const agent = await upsertAgent(db, "briefing", {
    name: "Briefing",
    persona: BRIEFING_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: modelForAgent("briefing", "T-work"),
    thinkingLevel: "high",
    autonomy: "execute_safe",
    knowledgeScopeJson: { folders: ["run-logs"], tags: ["acqu"] },
    budgetCapUsd: "0.30",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, BRIEFING_SYSTEM_PROMPT);
  await upsertCronTrigger(db, agent.id, "0 8 * * *");
  await projectCronTriggerToJob(db, agent.id, "0 8 * * *", "Morning briefing");

  await setSkills(db, agent.id, [skVerify.id, skBriefing.id]);
  await setMcps(db, agent.id, [mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding briefing for tenant Acqu…");
  const id = await seedBriefing(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ briefing  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
