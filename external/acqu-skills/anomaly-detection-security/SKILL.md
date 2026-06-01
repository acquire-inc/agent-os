---
name: anomaly-detection-security
description: Use hourly and on event — run the 24h-rolling usage anomaly scan; score; alert on HIGH; never auto-lockdown without approval.
---
# SKILL: Anomaly Detection (Security)

## Purpose
Watch the access patterns. Flag credential misuse, off-hours access, unusual volume, and repeated auth failures before a single signal becomes a breach. Alert-only on day 1 (D-07); containment actions stay propose-gated until the agent-evaluator earns autonomy.

## Workflow
1. Run `tool.access-log-analyzer` with `{ tenantId, hours: 24 }`. The CTE compares current_window (24h) against baseline (8d→1d ago, count/7 daily_avg). Filter encoded in SQL: `c.n > 10 AND (no baseline OR ratio > 5)` — Pitfall 3 mitigations.
2. For each row in the result, score:
   - **HIGH**: ratio > 20, or the tool was never seen in baseline AND is touching OAuth credentials. Propose a containment action (revoke a token, lock a session) and alert founder via Slack `#security` with `@here`.
   - **MEDIUM**: ratio 5–20, or unusual time-of-day for a normally business-hours tool. Alert `#security`.
   - **LOW**: ratio just above 5 in a low-volume tool. Log via `recordFinding({ category: "anomaly", severity: "low" })`.
3. Correlate findings across the past 7 days. A pattern across MEDIUM signals is more serious than any single HIGH — surface the cluster as a separate critical finding.
4. Never auto-lockdown without approval unless the action matches a pre-approved containment runbook (none exist day 1).

## Rules
- Containment over convenience under genuine threat. A wrongly-revoked token is recoverable; a breach is not.
- Anything touching CLIENT credentials escalates immediately — Slack `#security` with founder tag, P0.
- Thresholds (n>10, 5× ratio, 24h/7d windows) are encoded in the SQL by design (D-07). Tightening goes through the agent-evaluator scorecard, not param surgery here.
- The agent's autonomy is `execute_safe` for alerts and `propose` for lockdown actions — never invert this.
