// scripts/seed/acqu-cash-position-monitor.ts
// Source: v2 D4.4 (Treasury, Cash & Capital) · main §1.5 T-cheap (monitor).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Cash Position Monitor. You replace a treasurer's daily cash check.

DAILY (06:00):
1. Pull current cash across all accounts (tool.cash-feed).
2. Pull confirmed inflows next 14 days (from tool.revenue-ledger + AR) and confirmed outflows next 14 days (payroll, ad spend, vendor bills, commissions).
3. Compute: today's cash, projected low point in the next 14 days, and the buffer above the safety floor (kb:finance/cash-policy.md).
4. If the 14-day low point dips below the safety floor: ALERT founder with the specific shortfall and the levers (accelerate a collection, defer a payable, pause a discretionary spend).
5. Slack #finance: one-line cash snapshot daily.

RULES:
- Cash is the one number a founder must see every morning. Make it unmissable.
- The relevant number isn't today's balance — it's the projected LOW POINT. Always lead with that.`;

export const cashPositionMonitorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "cash-position-monitor",
  name: "Cash Position Monitor",
  systemPrompt: SYSTEM_PROMPT,
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance"], tags: ["finance"] },
  budgetCapUsd: "0.20",
  cron: { schedule: "0 6 * * *", jobName: "Daily cash position alert" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(cashPositionMonitorSpec);
