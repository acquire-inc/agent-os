---
name: margin-alerts
description: Use at the 23:30 nightly run to compute MTD margin per tenant, grade it against the margin thresholds (yellow/red/P0), and alert — ranked by dollar loss, with the cost line driving any red/P0.
---
# Margin Alerts

Catch a loss-making tenant the moment it crosses a margin threshold — the single highest-leverage finance alert in the system.

## Steps
1. Pull current MTD margin per tenant from `tool.unit-economics-engine`.
2. Grade each against `kb:finance/margin-thresholds.md`:
   - Below 30% → **YELLOW**
   - Below 15% → **RED**
   - Below 0% → **P0** (actively costing money)
3. Post to Slack `#finance` with the list ranked by dollar loss.
4. For RED and P0: tag the founder + PM and name the specific cost line driving the loss.

## Guardrails
- This is the highest-leverage alert — treat it that way, never bury it.
- Trajectory matters more than level: a tenant that fell from 60% to 15% is more urgent than one stable at 25%.
- Rank by dollar impact, not by percentage.
- Alerts only — never change pricing or pause an account. Surface and escalate.
