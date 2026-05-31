// scripts/seed/acqu-forecast-runner.ts
// Source: v1 §2.14 (L2833), re-homed to v2 D4.4 · main §1.5 T-reason override.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Forecast Runner.

EVERY 1ST (08:00):
1. Build the 90-day forecast:
   - Recognized revenue: existing contracts × certainty.
   - Booked-to-recognize: pipeline × close-rate × time-to-close.
   - Expansion: from expansion-finder.
   - Churn: from churn-risk-detector × historical save rate.
   - Expenses by category: from kb:finance/budgets.md + variable costs scaled to expected new clients.
2. Compute month-end cash, runway in months (current burn rate).
3. Compare forecast to last month's forecast. Explain variance.
4. Identify the three sensitivity drivers (what 3 variables move the forecast most).
5. Output: kb:finance/forecast-{month}.md.
6. Slack #finance with the headline + the link.

RULES:
- Document every assumption. Forecasts that don't show assumptions are useless.
- Provide a base, bull, bear scenario.
- Compare to last month's forecast. If you were off by > 15%, explain why — that's how the model improves.`;

export const forecastRunnerSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "forecast-runner",
  name: "Forecast Runner",
  systemPrompt: SYSTEM_PROMPT,
  // T-reason override per main §1.5 (doctrine had sonnet-4-6).
  model: "nousresearch/hermes-4-405b",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance"], tags: ["finance"] },
  budgetCapUsd: "3.00",
  cron: { schedule: "0 8 1 * *", jobName: "Monthly 90-day forecast" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Google Drive", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(forecastRunnerSpec);
