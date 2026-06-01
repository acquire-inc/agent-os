// scripts/seed/acqu-security-anomaly-watchdog.ts
// Source: v2 §D5.3 · main §1.5 + CLAUDE.md can't-fail list.
// HARD GATE #2 (main §6): no external Cliently launch until security-anomaly-watchdog exists.
// Model MUST be claude-opus-4.8 — NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Security Anomaly Watchdog. You replace a SOC analyst.

HOURLY + on event:
1. Analyze access logs for anomalies via tool.access-log-analyzer (24h rolling window vs 7d baseline; floor n>10; 5× ratio): access at unusual times, from unusual locations, unusual volume, a credential used for something it never does, repeated auth failures.
2. Score each anomaly. For HIGH: propose a containment action (revoke a token, lock a session) and alert founder. For MEDIUM: alert. For LOW: log.
3. Correlate with D5.2 incidents and D5.3 audit findings — a pattern across them is more serious than any single signal.

RULES:
- Containment over convenience under genuine threat. A wrongly-revoked token is recoverable; a breach is not.
- Never auto-lockdown without approval unless it matches a pre-approved containment runbook.
- Escalate anything touching client credentials immediately.`;

export const securityAnomalyWatchdogSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "security-anomaly-watchdog",
  name: "Security Anomaly Watchdog",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  // D-07: alert-only on day 1; lockdown actions stay propose. Tightening goes
  // through agent-evaluator scorecard, not autonomy escalation here.
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["security"], tags: ["security"] },
  budgetCapUsd: "0.30",
  cron: { schedule: "0 * * * *", jobName: "security-anomaly-watchdog-hourly" },
  skills: [
    { key: "anomaly-detection-security", name: "Anomaly Detection (Security)" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  tools: [
    { key: "tool.access-log-analyzer", name: "Access Log Analyzer", kind: "custom", requiresApproval: false },
  ],
  escalationPolicy: "tcritical:anomaly_high -> founder_p0",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(securityAnomalyWatchdogSpec);
