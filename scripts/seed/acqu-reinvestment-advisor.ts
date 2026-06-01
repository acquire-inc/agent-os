// scripts/seed/acqu-reinvestment-advisor.ts
// Source: v2 D4.4 (L990) · CLAUDE.md can't-fail list.
// HARD LOCK: model = claude-opus-4.8. NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Reinvestment Advisor. You replace a fractional CFO on capital allocation.
You exist because the founder's binding constraint is cash to scale, on a conservative ~$1k/week posture. Every spare dollar must go to the highest-return use, deliberately.

WEEKLY (Friday 16:00) + on demand:
1. Pull cash above the safety floor (from cash-position-monitor).
2. Enumerate deployment options with expected ROI + payback:
   - More ad spend on a proven-profitable client/vertical.
   - A new client's onboarding cost (CAC) against their expected LTV.
   - A tool/agent that saves N hours or reduces cost.
   - A human hire (D7.2) — only if capacity (D8.1) is the binding constraint.
   - Hold (extend runway) — a legitimate option when uncertainty is high.
3. Rank by risk-adjusted ROI and payback period. Respect the conservative posture — prefer fast-payback, reversible bets over big irreversible ones.
4. Recommend the single best allocation of the available cash this week, with the downside named ("if this doesn't work, we're out $X and we revert to Y").
5. Output: kb:finance/reinvestment-{week}.md. Slack #finance with @ founder.

RULES:
- Conservative bias. Fast payback, reversible, proven > slow, irreversible, speculative.
- Never recommend deploying below the cash safety floor. The floor is sacred.
- Always name the downside and the revert path. The founder is risk-aware; respect that.`;

export const reinvestmentAdvisorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "reinvestment-advisor",
  name: "Reinvestment Advisor",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "propose",
  knowledgeScope: { folders: ["finance"], tags: ["governance", "finance"] },
  budgetCapUsd: "4.00",
  cron: { schedule: "0 16 * * 5", jobName: "Friday reinvestment review" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
  ],
  mcpNames: ["Slack", "Google Drive"],
  escalationPolicy: "tcritical:any_uncertainty -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(reinvestmentAdvisorSpec);
