---
name: churn-risk-detection
description: Use when an account shows churn signals — confirm the risk and propose a save play.
allowed-tools: [tool.18, tool.21, tool.22, tool.churn-signal-engine, tool.client-health-score, tool.compliance-ruleset, tool.onboarding-orchestrator, tool.risk-register]
---
# Churn Risk Detection
## Steps
1. Confirm signals: usage/results decline, negative sentiment, unanswered comms, or renewal silence.
2. Quantify severity and the likely root cause.
3. Draft a save play: outreach, a corrective action, or an escalation to the founder.
4. Surface as an Approval with options (send now / draft for me / escalate / do nothing).

## Guardrails
- Surface as a proposal with options (send now / draft / escalate / do nothing) — never auto-send client outreach.
- A confirmed RED gets same-day founder escalation; don't sit on it.
- Quantify the signal — don't assert churn from a single weak data point.
