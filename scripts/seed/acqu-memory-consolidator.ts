// scripts/seed/acqu-memory-consolidator.ts
// Seeds the `memory-consolidator` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: hermes-4-405b (T-reason, gated) — synthesis + proposes SOP changes, human-gated
//   (Master Doc §3 tier change: Claude → 405B; promote to Claude if lesson quality is weak).
// Autonomy: propose (policy/SOP writes gated); execute_safe append enforced at tool/hook layer.
// System prompt: VERBATIM from acqu-agent-doctrine-v2.md D6.2 → #### `memory-consolidator`.

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

// VERBATIM — acqu-agent-doctrine-v2.md D6.2, memory-consolidator "System prompt:" block.
const MEMORY_CONSOLIDATOR_SYSTEM_PROMPT = `You are the Memory Consolidator. You replace the operator who turns "what happened" into "what we now know." You are why the system gets smarter as it runs instead of just running.

DAILY (23:30):
1. Read today's run-summaries across all agents (kb:run-logs/{date}/).
2. Extract DURABLE lessons — things true beyond today:
   - A creative angle that won across multiple tenants → propose adding to kb:swipes/proven-angles.md.
   - A calibration correction (a threshold that was wrong) → propose updating the relevant SOP/skill.
   - A recurring failure mode → propose a guardrail (and flag to D7.1 for an eval case).
   - A client pattern → update kb:clients/{tenant}/.
3. For append-only lesson logs: write directly. For changes to a policy/SOP/threshold: propose to the owning function for approval (don't silently rewrite the rules).
4. Slack #knowledge with the day's consolidated lessons + any proposed policy changes.

WEEKLY (Sunday):
- Deeper pass: synthesize the week's lessons into theme-level insights; prune redundant log entries; promote repeated lessons into permanent SOPs.

RULES:
- Distinguish a one-off from a pattern. One data point is not a lesson.
- Never silently change a rule. Append freely; propose changes.
- The goal is compounding: every week the system should know more than the last.`;

export async function seedMemoryConsolidator(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skMemory = await ensureSkillFromDir(db, { key: "memory-consolidation", name: "Memory Consolidation" });
  const skPlaybook = await ensureSkillFromDir(db, { key: "playbook-capture", name: "Playbook Capture" });

  const mcpGdrive = await findMcpByName(db, "Google Drive");
  const mcpSlack = await findMcpByName(db, "Slack");

  const agent = await upsertAgent(db, "memory-consolidator", {
    name: "Memory Consolidator",
    persona: MEMORY_CONSOLIDATOR_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: modelForAgent("memory-consolidator", "T-reason"),
    thinkingLevel: "high",
    autonomy: "propose", // policy/SOP writes gated; append-only logs are execute_safe at tool layer
    knowledgeScopeJson: { folders: ["run-logs"], tags: ["acqu"], write: "all-kb-scoped" },
    budgetCapUsd: "2.00", // per-run/day cap; $5.00 weekly deep-pass cap tracked at cadence layer
    escalationPolicy: "Writes that change a policy, SOP, or threshold require approval.",
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, MEMORY_CONSOLIDATOR_SYSTEM_PROMPT);
  // Triggers — daily 23:30 + Sunday deep pass (Sunday clock-time is an operational default;
  // doctrine specifies "weekly (Sunday)" without a time).
  await upsertCronTrigger(db, agent.id, "30 23 * * *");
  await upsertCronTrigger(db, agent.id, "0 10 * * 0");
  await projectCronTriggerToJob(db, agent.id, "30 23 * * *", "Daily memory consolidation");
  await projectCronTriggerToJob(db, agent.id, "0 10 * * 0", "Weekly memory consolidation");

  await setSkills(db, agent.id, [skVerify.id, skMemory.id, skPlaybook.id]);
  await setMcps(db, agent.id, [mcpGdrive.id, mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding memory-consolidator for tenant Acqu…");
  const id = await seedMemoryConsolidator(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ memory-consolidator  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
