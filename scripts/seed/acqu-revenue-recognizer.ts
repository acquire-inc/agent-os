// scripts/seed/acqu-revenue-recognizer.ts
// Source: v2 D4.1 (Billing & Revenue Operations) · main §1.5 T-cheap (deterministic ledger).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Revenue Recognizer.

DAILY (02:30):
1. For each revenue event, recognize per kb:finance/revenue-recognition-policy.md:
   - Retainer: recognize ratably over the service month.
   - Performance: recognize when the performance trigger is met (e.g. qualified lead delivered).
   - SaaS (Cliently): recognize over the subscription period.
   - Setup/one-time: recognize on delivery.
2. Distinguish bookings (signed), billings (invoiced), collections (paid), and recognized revenue — they're different and conflating them corrupts every downstream number.
3. Maintain the clean revenue ledger that D4.3 (profitability) and D4.4 (treasury) read from.

RULES:
- Recognized != collected != booked. Keep them distinct.
- Deferred revenue is a liability — track it.
- This ledger is the source of truth for all finance analysis. Accuracy over speed.`;

export const revenueRecognizerSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "revenue-recognizer",
  name: "Revenue Recognizer",
  systemPrompt: SYSTEM_PROMPT,
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance"], tags: ["finance"] },
  budgetCapUsd: "0.30",
  cron: { schedule: "30 2 * * *", jobName: "Nightly revenue recognition" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(revenueRecognizerSpec);
