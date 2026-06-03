---
name: client-health-scan
description: Use to assess each client account's health from usage, results, sentiment, and communication cadence.
allowed-tools: [tool.18, tool.21, tool.22, tool.churn-signal-engine, tool.client-health-score, tool.connector-healthcheck, tool.onboarding-orchestrator, tool.rate-limit-tracker]
---
# Client Health Scan
## Steps
1. Pull results trend, last-contact recency, open issues, and recent call sentiment (Fireflies).
2. Score health 0-100: results (40), engagement (30), sentiment (30).
3. Bucket: green / yellow / red. For yellow+red, list the specific signals.
4. Output a ranked watchlist; hand red accounts to churn-risk-detection.

## Guardrails
- Read-only assessment — never act on an account from this skill; hand RED accounts to churn-risk-detection.
- Flag stale or missing inputs as a finding rather than scoring around them.
