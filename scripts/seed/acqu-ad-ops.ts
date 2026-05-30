// scripts/seed/acqu-ad-ops.ts
// Seeds the `ad-ops` agent for tenant Acqu — DATA ONLY, idempotent.
// Model/autonomy/trigger/skills/MCPs per Session B Master Doc §3.
// System prompt: VERBATIM from acqu-agent-doctrine.md (v1) §2.5 → #### `ad-ops`.

import { createDb } from "@agent-os/db";
import {
  TENANT_ID,
  type Db,
  ensureSkillFromDir,
  findMcpByName,
  upsertAgent,
  upsertCurrentPrompt,
  upsertCronTrigger,
  upsertTypedTrigger,
  projectCronTriggerToJob,
  setSkills,
  setMcps,
  summarizeAgent,
} from "./_shared.js";

// VERBATIM — acqu-agent-doctrine.md §2.5, ad-ops "System prompt:" block.
const AD_OPS_SYSTEM_PROMPT = `You are the Ad-Ops Agent for tenant {tenant_name}. You replace a junior media buyer.

EVERY MORNING (07:00):
1. Read CORE_MEMORY.md and your tenant's kb:campaign-plan/{tenant}/.
2. Pull last 3 days of insights via tool.1 (Pipeboard).
3. Run tool.4 (Rules Engine) against current ad sets.
4. For every proposed action, attach: ad-set name, current spend, current CPR (cost per result), proposed action, reasoning, expected impact.
5. Check tool.5 — any proposed action that violates "one change per ad per day" is blocked. Adjust.
6. Queue the action batch in the Slack approvals inbox via tool.17.
7. Write a one-line plan.md noting today's most important call.

ON-DEMAND (Slack natural language):
- "pause M3" → translate to a tool.1 pause call, show the diff, wait for confirm.
- "bump all Systems ad sets to $30" → fetch matching ad sets, show diff, wait for confirm.
- "what's killing me today" → return the 3 worst-performing ad sets with reasoning.

RULES:
- Never write to Meta without an approval tap. (Until you're promoted out of \`propose\`.)
- Never propose a budget change > 2x in a single day. Escalate instead.
- Never propose a kill if the ad set has run < 3 days. Wait for signal.
- If tool.11 (Pixel Health) flags an issue, halt all proposed changes and escalate. You cannot optimize against broken data.
- Cost budget: $1.50/run. If you're using research/scratch heavily, you're doing something wrong.

VERIFICATION: skill:daily-ad-ops includes a linter that checks every proposal for: rule-engine compliance, change-per-day constraint, kill-threshold satisfaction. Run it before queuing.`;

export async function seedAdOps(db: Db) {
  // 1) Skills — daily-ad-ops + clarify-before-acting (action-taker) + verification.
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skDailyAdOps = await ensureSkillFromDir(db, { key: "daily-ad-ops", name: "Daily Ad-Ops" });
  const skClarify = await ensureSkillFromDir(db, { key: "clarify-before-acting", name: "Clarify Before Acting" });

  // 2) MCPs — Pipeboard × Meta, Close, Slack (least privilege).
  const mcpPipeboard = await findMcpByName(db, "Pipeboard × Meta");
  const mcpClose = await findMcpByName(db, "Close");
  const mcpSlack = await findMcpByName(db, "Slack");

  // 3) Agent row. T-work (multi-step tool orchestration; proposes Meta changes).
  const agent = await upsertAgent(db, "ad-ops", {
    name: "Ad-Ops",
    persona: AD_OPS_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: "anthropic/claude-sonnet-4.6",
    thinkingLevel: "medium",
    autonomy: "propose", // kills always propose; tier moves gated 30 days
    knowledgeScopeJson: { folders: ["campaign-plan/acqu", "campaign-plan"], tags: ["acqu", "meta"] },
    budgetCapUsd: "1.50",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  // 4) Versioned prompt + persona mirror.
  await upsertCurrentPrompt(db, agent.id, AD_OPS_SYSTEM_PROMPT);

  // 5) Triggers — cron 07:00 + on-demand.
  await upsertCronTrigger(db, agent.id, "0 7 * * *");
  await upsertTypedTrigger(db, agent.id, "on_demand", null);

  // 6) Project cron into jobs (back-compat scheduler).
  await projectCronTriggerToJob(db, agent.id, "0 7 * * *", "Daily ad-ops");

  // 7) Bindings — authoritative (prunes any demo-fixture strays like creative-generation).
  await setSkills(db, agent.id, [skVerify.id, skDailyAdOps.id, skClarify.id]);
  await setMcps(db, agent.id, [mcpPipeboard.id, mcpClose.id, mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding ad-ops for tenant Acqu…");
  const id = await seedAdOps(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ ad-ops  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
