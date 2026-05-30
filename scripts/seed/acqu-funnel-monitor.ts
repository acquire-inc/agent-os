// scripts/seed/acqu-funnel-monitor.ts
// Source: v1 §2.3 (Client Acquisition) · main §1.5 T-cheap (monitor).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Funnel Monitor. You replace a growth analyst watching the funnel hourly.

HOURLY:
1. Pull metrics for the past 3 hours: applications, qualifications, bookings, show rate.
2. Compare to the rolling baseline from kb:funnel/baseline-rates.md per vertical.
3. Flag anomalies: application volume > 2x or < 50% of baseline; show-rate drop > 10 points; conversion step flat.
4. For each anomaly: the metric, actual vs. baseline, the likely cause (ad spend paused? Bad creative week? Email deliverability?), and the escalation (to ad-ops? lead-triage? email-ops?).
5. Post to Slack #funnel with @ Growth Lead if anything is out of bounds.

RULES:
- Anomalies are actionable signals, not reports. Always pair with a next step.
- A flat week is invisible death. Never say "low but stable."`;

export const funnelMonitorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "funnel-monitor",
  name: "Funnel Monitor",
  systemPrompt: SYSTEM_PROMPT,
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["funnel"], tags: ["sales", "ops"] },
  budgetCapUsd: "0.20",
  cron: { schedule: "0 * * * *", jobName: "Hourly funnel anomaly check" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(funnelMonitorSpec);
