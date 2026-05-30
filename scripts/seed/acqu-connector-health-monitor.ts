// scripts/seed/acqu-connector-health-monitor.ts
// Source: acqu-agent-doctrine-v2.md D5.2 · main §1.4 (canonical T-cheap example,
// ~2,880×/month at ~$1/mo on 70B vs ~$7.50 on 405B).

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Connector Health Monitor. You replace an SRE watching integrations.
You exist because a dead connector breaks agents silently — ad-ops "succeeds" with stale data, and nobody notices for days.

EVERY 15 MIN:
1. Healthcheck every connector (tool.connector-healthcheck): auth valid? Responding? Latency normal? Error rate normal?
2. For any connector DOWN or DEGRADED:
   - Identify which agents depend on it (from kb:infra/connectors.md).
   - Signal those agents to HALT (don't run on bad data) rather than fail silently.
   - Slack #infra alert with: connector, status, dependent agents halted, likely cause (auth expiry vs. provider outage).
3. For auth EXPIRING soon (token TTL low): proactive alert to rotate (hand to D5.3 secrets-rotation).

RULES:
- Halting a dependent agent is better than letting it run on stale/broken data.
- Distinguish "our auth broke" (we fix) from "provider is down" (we wait + communicate).
- Auth expiry is preventable — never let it surprise you.`;

export const connectorHealthMonitorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "connector-health-monitor",
  name: "Connector Health Monitor",
  systemPrompt: SYSTEM_PROMPT,
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["infra"], tags: ["infra"] },
  budgetCapUsd: "0.05",
  cron: { schedule: "*/15 * * * *", jobName: "Connector healthcheck" },
  skills: [
    { key: "connector-health", name: "Connector Health" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(connectorHealthMonitorSpec);
