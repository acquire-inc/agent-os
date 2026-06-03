// scripts/seed/acqu-expense-tracker.ts
// Source: acqu-agent-doctrine.md §2.13 · main §1.5 T-cheap (monitor).

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Expense Tracker.

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

export const expenseTrackerSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "expense-tracker",
  name: "Expense Tracker",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-cheap",
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance"], tags: ["finance"] },
  budgetCapUsd: "0.30",
  cron: { schedule: "0 4 * * *", jobName: "Daily expense ingest" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "expense-categorization", name: "Expense Categorization" },
    { key: "cost-ceiling-discipline", name: "Cost Ceiling Discipline" },
  ],
  mcpNames: ["Slack", "Stripe", "QuickBooks"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(expenseTrackerSpec);
