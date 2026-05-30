// scripts/seed/acqu-expense-tracker.ts
// Seeds the `expense-tracker` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: hermes-4-70b (T-cheap) — categorization. Autonomy execute_safe.
// System prompt: VERBATIM from acqu-agent-doctrine.md (v1) §2.13 → #### `expense-tracker`.

import { createDb } from "@agent-os/db";
import {
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

// VERBATIM — acqu-agent-doctrine.md §2.13, expense-tracker "System prompt:" block.
const EXPENSE_TRACKER_SYSTEM_PROMPT = `You are the Expense Tracker.

EVERY MORNING (04:00) + on webhook:
1. Pull new transactions from tool.expense-feed.
2. Categorize against kb:finance/chart-of-accounts.md (Ads, Tools/SaaS, Payroll, Contractors, Infra, Office, Travel, Taxes, Other).
3. Match to a vendor in tool.vendor-registry. If new vendor, flag for vendor-renewal-watcher to investigate.
4. Update the ledger.
5. Compute MTD by category. Compare to kb:finance/budgets.md.
6. If any category > 80% of monthly budget: Slack alert.

RULES:
- Conservative categorization. Unclear → "Other" + flag for human review.
- Never re-categorize a previously-tagged transaction without flagging.`;

export async function seedExpenseTracker(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skExpense = await ensureSkillFromDir(db, { key: "expense-categorization", name: "Expense Categorization" });

  const mcpSlack = await findMcpByName(db, "Slack");

  const agent = await upsertAgent(db, "expense-tracker", {
    name: "Expense Tracker",
    persona: EXPENSE_TRACKER_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: "nousresearch/hermes-4-70b",
    thinkingLevel: "low",
    autonomy: "execute_safe",
    knowledgeScopeJson: { folders: ["finance"], tags: ["acqu"] },
    budgetCapUsd: "0.20",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, EXPENSE_TRACKER_SYSTEM_PROMPT);
  // Triggers — cron 04:00 + new-transaction webhook.
  await upsertCronTrigger(db, agent.id, "0 4 * * *");
  await upsertTypedTrigger(db, agent.id, "webhook", "transaction.created");
  await projectCronTriggerToJob(db, agent.id, "0 4 * * *", "Expense sweep");

  await setSkills(db, agent.id, [skVerify.id, skExpense.id]);
  await setMcps(db, agent.id, [mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding expense-tracker for tenant Acqu…");
  const id = await seedExpenseTracker(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ expense-tracker  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
