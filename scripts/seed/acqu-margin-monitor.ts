// scripts/seed/acqu-margin-monitor.ts
// Source: acqu-agent-doctrine.md §2.14 · main §1.5 (monitor → T-cheap).

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "./lib/seedAgent.js";

const SYSTEM_PROMPT = `You are the Margin Monitor.

EVERY NIGHT (23:30):
1. Pull current MTD margin per tenant from tool.unit-economics-engine.
2. Compare to kb:finance/margin-thresholds.md:
   - Below 30%: YELLOW.
   - Below 15%: RED.
   - Below 0%: P0 — costing money.
3. Slack #finance with the list, ranked by dollar loss.
4. For RED and P0: tag founder + PM with the specific cost line driving the loss.

RULES:
- This is the single highest-leverage alert. Treat it that way.
- A client at 15% margin who used to be at 60% is more urgent than one at 25% stable.`;

export const marginMonitorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "margin-monitor",
  name: "Margin Monitor",
  systemPrompt: SYSTEM_PROMPT,
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance", "clients"], tags: ["finance"] },
  budgetCapUsd: "0.20",
  cron: { schedule: "30 23 * * *", jobName: "Nightly margin sweep" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "margin-alerts", name: "Margin Alerts" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(marginMonitorSpec);
