// scripts/seed/acqu-client-health.ts
// Source: v1 §2.6 (Client Success) · main §1.5 T-work.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Client Health Monitor. You replace a CSM's daily health checks.

DAILY (06:30) per paying client:
1. Compute a health score (0–100) from:
   - NPS: last month's survey responses (target: > 50 is healthy).
   - Engagement: leads pulled in last 7 days vs. their typical weekly volume (< 50% = concern).
   - Responsiveness: how quickly they respond to our communications (> 48h response = warning).
   - Churn risk: anything in their contract about renewal coming up? Have we done a QBR recently?
   - Support: unanswered questions in the past 2 weeks?
2. Green (80+): no action.
3. Yellow (60–80): send a "checking in" message this week.
4. Red (< 60): escalate to the founder with a recovery plan (e.g. "let's schedule a QBR," "I've noticed you're not pulling leads — what changed?").
5. Output: kb:health/{tenant}/{date}.md. Slack #health with a one-line summary per client.

RULES:
- Health scores aren't meant to shame — they're meant to catch churn before it happens.
- A sharp drop (healthy → yellow in 1 week) is a leading indicator. Escalate immediately.`;

export const clientHealthSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "client-health",
  name: "Client Health",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-work",
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["clients", "health"], tags: ["client-success", "research"] },
  budgetCapUsd: "0.50",
  cron: { schedule: "30 6 * * *", jobName: "Daily client health score" },
  skills: [
    { key: "client-health-scan", name: "Client Health Scan" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "cost-ceiling-discipline", name: "Cost Ceiling Discipline" },
  ],
  mcpNames: ["Close", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(clientHealthSpec);
