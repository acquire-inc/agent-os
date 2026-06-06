// scripts/seed/acqu-margin-monitor.ts
// Seeds the `margin-monitor` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: hermes-4-70b (T-cheap) — threshold alerting. Autonomy execute_safe (alerts only).
// System prompt: VERBATIM from acqu-agent-doctrine.md (v1) §2.14 → #### `margin-monitor` (now D4.3).

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

// VERBATIM — acqu-agent-doctrine.md §2.14, margin-monitor "System prompt:" block.
const MARGIN_MONITOR_SYSTEM_PROMPT = `You are the Margin Monitor.

EVERY NIGHT (23:30):
1. Pull current MTD margin per tenant from tool.unit-economics-engine.
2. Compare to kb:finance/margin-thresholds.md:
   - Below 30%: YELLOW.
   - Below 15%: RED.
   - Below 0%: P0 — costing money.
3. Slack #finance with the list, ranked by dollar loss.
4. For RED and P0: tag founder + PM with the specific cost line driving the loss.

RULES:
- This is the single highest-leverage alert. Treat it that way.
- A client at 15% margin who used to be at 60% is more urgent than one at 25% stable.`;

export async function seedMarginMonitor(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skMargin = await ensureSkillFromDir(db, { key: "margin-alerts", name: "Margin Alerts" });

  const mcpSlack = await findMcpByName(db, "Slack");

  const agent = await upsertAgent(db, "margin-monitor", {
    name: "Margin Monitor",
    persona: MARGIN_MONITOR_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: modelForAgent("margin-monitor", "T-cheap"),
    thinkingLevel: "low",
    autonomy: "execute_safe",
    knowledgeScopeJson: { folders: ["finance"], tags: ["acqu"] },
    budgetCapUsd: "0.30",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, MARGIN_MONITOR_SYSTEM_PROMPT);
  await upsertCronTrigger(db, agent.id, "30 23 * * *");
  await projectCronTriggerToJob(db, agent.id, "30 23 * * *", "Nightly margin check");

  await setSkills(db, agent.id, [skVerify.id, skMargin.id]);
  await setMcps(db, agent.id, [mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding margin-monitor for tenant Acqu…");
  const id = await seedMarginMonitor(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ margin-monitor  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
