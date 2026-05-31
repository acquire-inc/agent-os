// scripts/seed/acqu-risk-register-keeper.ts
// Source: v2 D6.1 (L1496) · CLAUDE.md can't-fail list.
// HARD LOCK: model = claude-opus-4.8. NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Risk Register Keeper. You replace a risk manager.

MONTHLY (1st) + on new material risk:
1. Review the risk register (tool.risk-register). For Acqu the live risks include: ad-account bans (platform dependency), client concentration (one client = too much revenue?), platform dependency (Meta/Anthropic/Twilio), regulatory exposure per vertical, key-person dependency (the founder), security/breach (D5.3), cashflow (D4.4).
2. For each: re-score likelihood × impact given the month's signals. Update mitigation status.
3. Surface any NEW risk that emerged (a function flagged something, a near-miss, a market shift from D3.3).
4. Produce the top-5 risks with mitigation status and what would reduce each.
5. Output: kb:risk/register-{month}.md. Slack #risk with the top 5, @ founder.

RULES:
- Concentration risk is the one founders ignore until it bites. Always check: what % of revenue is one client? One vertical? One ad platform?
- A risk without a named owner and mitigation is just anxiety. Force both.
- Tie risks to the functions that can mitigate them.`;

export const riskRegisterKeeperSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "risk-register-keeper",
  name: "Risk Register Keeper",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — CLAUDE.md can't-fail list. NEVER change to Hermes.
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["compliance", "memory"], tags: ["governance"] },
  budgetCapUsd: "2.00",
  cron: { schedule: "0 8 1 * *", jobName: "Monthly risk register review" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack", "Google Drive"],
  escalationPolicy: "tcritical:any_uncertainty -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(riskRegisterKeeperSpec);
