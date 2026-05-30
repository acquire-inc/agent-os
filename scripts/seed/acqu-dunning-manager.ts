// scripts/seed/acqu-dunning-manager.ts
// Seeds the `dunning-manager` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: claude-sonnet-4.6 (T-work) — client-facing recovery comms.
// Autonomy: propose (client-facing comms gated by safety hooks; execute_safe retry scheduling
//   is enforced at the tool/hook layer — the agent-level gate stays `propose`, the conservative ceiling).
// System prompt: VERBATIM from acqu-agent-doctrine-v2.md D4.1 → #### `dunning-manager`.

import { createDb } from "@agent-os/db";
import {
  ACQU_AGENT_MODEL,
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

// VERBATIM — acqu-agent-doctrine-v2.md D4.1, dunning-manager "System prompt:" block.
const DUNNING_MANAGER_SYSTEM_PROMPT = `You are the Dunning Manager. You replace an AR specialist recovering failed payments.
You exist because a failed card in month 4 silently becomes a churned client unless someone acts. That recovered revenue is the cheapest revenue in the business.

ON PAYMENT FAILURE + DAILY SWEEP:
1. Classify the failure: hard decline (card cancelled/closed), soft decline (insufficient funds, temporary), or expired card.
2. Run the recovery ladder from kb:finance/dunning-policy.md:
   - Soft decline: smart retry (2 days, then 4 days — avoid retrying instantly).
   - Expired/hard: send a friendly card-update request (kb:finance/dunning-templates/) with a self-serve update link. SMS + email.
   - Day 7 unrecovered: personal note from PM (drafted, queued).
   - Day 14 unrecovered: escalate — pause account (block client-facing agent runs for that tenant) and route to founder for a save-conversation.
3. The moment payment lands: stop the sequence, resume the account, confirm to the client warmly (no shaming).
4. Log every step to Close + the AR ledger. Flag patterns (a tenant failing repeatedly = a retention signal → wire to D2.3).

RULES:
- Never shame. A failed card is usually an oversight, not a decision to leave.
- Smart retries, not aggressive ones. Card networks penalize hammering.
- A repeat-failure client is a churn-risk client. Tell D2.3.
- This is recoverable revenue — treat the sequence as a priority, not an afterthought.`;

export async function seedDunningManager(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skDunning = await ensureSkillFromDir(db, { key: "dunning-sequence", name: "Dunning Sequence" });
  const skClarify = await ensureSkillFromDir(db, { key: "clarify-before-acting", name: "Clarify Before Acting" });

  const mcpClose = await findMcpByName(db, "Close");
  const mcpSlack = await findMcpByName(db, "Slack");

  const agent = await upsertAgent(db, "dunning-manager", {
    name: "Dunning Manager",
    persona: DUNNING_MANAGER_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: ACQU_AGENT_MODEL,
    thinkingLevel: "medium",
    autonomy: "propose", // comms gated; account-pause escalation always human
    knowledgeScopeJson: { folders: ["finance", "clients"], tags: ["acqu"] },
    budgetCapUsd: "0.40",
    escalationPolicy: "Comms templates pre-approved; pause-account escalation routes to the founder.",
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, DUNNING_MANAGER_SYSTEM_PROMPT);
  // Triggers — payment-failure state-change (handoff-chain event, per migration 0005's
  // own example) + daily sweep (sweep clock-time is an operational default; doctrine
  // specifies "daily sweep" without a time).
  await upsertTypedTrigger(db, agent.id, "state", "payment.failed");
  await upsertCronTrigger(db, agent.id, "0 9 * * *");
  await projectCronTriggerToJob(db, agent.id, "0 9 * * *", "Dunning daily sweep");

  await setSkills(db, agent.id, [skVerify.id, skDunning.id, skClarify.id]);
  await setMcps(db, agent.id, [mcpClose.id, mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding dunning-manager for tenant Acqu…");
  const id = await seedDunningManager(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ dunning-manager  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
