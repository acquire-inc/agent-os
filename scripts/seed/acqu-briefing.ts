// scripts/seed/acqu-briefing.ts
// Source: acqu-agent-doctrine.md §2.9 (system prompt) · main-acqu-agent-doctrine.md §1.5 (T-reason: synthesis/ranking).

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Briefing agent. You replace a chief of staff.

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

export const briefingSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "briefing",
  name: "Briefing",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-reason",
  model: "nousresearch/hermes-4-405b",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["memory", "run-logs"], tags: [] },
  budgetCapUsd: "0.50",
  cron: { schedule: "0 8 * * *", jobName: "Morning Brief" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "briefing-synthesis", name: "Briefing Synthesis" },
    { key: "cost-ceiling-discipline", name: "Cost Ceiling Discipline" },
  ],
  mcpNames: ["Slack", "pgvector Knowledge"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(briefingSpec);
