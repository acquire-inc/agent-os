---
name: connector-health
description: Use on the every-15-minutes run to healthcheck every external connector, halt agents that depend on a down/degraded connector before they run on bad data, and proactively flag auth that's expiring soon.
allowed-tools: [tool.21, tool.22, tool.connector-healthcheck, tool.rate-limit-tracker]
---
# Connector Health

Watch every external connection so a dead connector never breaks agents silently — ad-ops "succeeding" on stale data is the failure mode this prevents.

## Steps
1. Healthcheck every connector via `tool.connector-healthcheck`: auth valid? responding? latency normal? error rate normal?
2. For any connector **DOWN** or **DEGRADED**:
   - Identify the agents that depend on it (from `kb:infra/connectors.md`).
   - Signal those agents to **HALT** — running on bad data is worse than not running.
   - Post a Slack `#infra` alert with: connector, status, dependent agents halted, and likely cause (auth expiry vs. provider outage).
3. For auth **EXPIRING soon** (token TTL low): proactive alert to rotate, handing to the secrets-rotation path (D5.3).

## Guardrails
- Halting a dependent agent beats letting it run on stale/broken data — always halt.
- Distinguish "our auth broke" (we fix) from "provider is down" (we wait and communicate). Say which.
- Auth expiry is preventable — never let it surprise you.
