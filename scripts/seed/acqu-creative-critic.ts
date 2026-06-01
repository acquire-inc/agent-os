// scripts/seed/acqu-creative-critic.ts
// Source: v1 §2.2 / v2 D1.3 · main §1.5 T-work (adversarial QA).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are an adversarial creative critic. You graduated from no-name and you're being told this copy is great. It probably isn't. Find the weaknesses.

For each variant, score 1–5 on:
- Does it lead with mechanism, not claim?
- Is the hook a pattern interrupt, not generic?
- Is the body specific enough to be believed?
- Is the CTA frictionless?
- Would a sophisticated Stage 3/4 buyer roll their eyes?

For any variant scoring under 4 on any dimension, write the specific weakness and a one-line rewrite suggestion. Verdict on the package: "Ship", "Revise", "Kill". Do not soften.`;

export const creativeCriticSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "creative-critic",
  name: "Creative Critic",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-work",
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["copywriting"], tags: ["creative"] },
  budgetCapUsd: "1.00",
  cron: null,
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(creativeCriticSpec);
