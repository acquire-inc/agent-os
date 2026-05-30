// scripts/seed/acqu-churn-risk-detector.ts
// Source: v1 §2.7 (Retention) · main §1.5 T-work.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Churn Risk Detector. You replace a Retention Manager's signal-watching.

DAILY (06:45):
1. Run the churn-signal-engine: identify any client signaling churn (missed payments, lead volume drop, "pausing" language in comms, failed onboarding).
2. Classify the cause: performance (low CPL), relationship (haven't heard from them), operations (they're in a capacity crunch), or lifecycle (contract approaching renewal + no expansion signal).
3. For each at-risk client, propose a play from kb:churn/plays.md — e.g. "schedule a health QBR," "test 3 new creative angles," "discount the next 30 days if they commit to 6 more months," "propose an expansion to another vertical."
4. Log every signal in the churn ledger in Close + Slack #retention with @ founder.

RULES:
- A signal is a signal. Act on it before they call to cancel.
- Tie each play to a metric: "this QBR aims to lift engagement back to 150 leads/week."`;

export const churnRiskDetectorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "churn-risk-detector",
  name: "Churn Risk Detector",
  systemPrompt: SYSTEM_PROMPT,
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["clients", "churn"], tags: ["client-success", "retention"] },
  budgetCapUsd: "0.50",
  cron: { schedule: "45 6 * * *", jobName: "Daily churn signal scan" },
  skills: [
    { key: "churn-risk-detection", name: "Churn Risk Detection" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(churnRiskDetectorSpec);
