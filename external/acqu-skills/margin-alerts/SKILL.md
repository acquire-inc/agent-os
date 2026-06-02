---
name: margin-alerts
description: Use daily 23:30 — compute per-client gross margin (revenue - direct delivery cost - pass-through); flag any client below floor; never auto-fire.
---
# SKILL: Margin Alerts

The nightly margin monitor. Per-client, per-offer gross margin watch. Surfaces clients sliding into negative margin before they show up as "why are we not making any money?" three months later.

## Purpose

For every active client, compute the rolling 30-day gross margin and compare it to the per-offer floor set by pricing-architect (in `kb:pricing/floors-by-offer.md`). For any client below floor, raise a Slack alert with the specific causes. Never auto-fire a client — that's a propose decision, owned by the founder + AM.

## Workflow

1. **Pull the per-client revenue & cost data:**
   - Revenue: invoiced MRR + one-time fees from Stripe + Close for the last 30 days
   - Direct delivery cost: subcontractor hours + media spend pass-throughs + Browserbase usage + any client-specific tooling
   - Allocated cost: an allocation of the AM's time + the ad-ops agent's compute + tooling fees (use the agent-evaluator's run-attribution per-client if available; otherwise pro-rate by revenue)

2. **Compute gross margin per client:**
   ```
   gross_margin_30d = (revenue_30d - direct_cost_30d - allocated_cost_30d)
   margin_pct = gross_margin_30d / revenue_30d
   ```

3. **Compare against the floor for that client's offer:**
   - Pull the offer slug from Close (`custom.offer_slug`)
   - Pull the offer's floor from `kb:pricing/floors-by-offer.md` (set by pricing-architect)
   - If `margin_pct < floor`: BELOW FLOOR finding
   - If `margin_pct < (floor - 5pp)`: CRITICAL — severity=high finding

4. **For each below-floor client, diagnose:**
   - Is direct cost up vs the prior 30d? (Subcontractor rate change? Media-spend pass-through underbilled?)
   - Is revenue down vs the prior 30d? (Discount applied? Service partially paused? Refund issued?)
   - Is allocated cost up disproportionately? (AM spending extra hours? Tooling fees changed?)
   - Categorize the cause: COST-UP / REVENUE-DOWN / ALLOCATION-UP / MIXED

5. **Emit `finding.recorded`** for each below-floor client:
   - severity=medium for BELOW FLOOR
   - severity=high for CRITICAL (>5pp below)
   - title: "Margin below floor: {client} ({margin_pct}% vs floor {floor_pct}%)"
   - payload: `{ client_id, offer_slug, margin_pct, floor_pct, revenue_30d, direct_cost_30d, allocated_cost_30d, primary_cause }`

6. **Write the day's margin state to `kb:finance/margins/{date}.md`** — per-client table with margins, floors, status, primary cause.

7. **Post Slack alert to #margins** if any CRITICAL finding raised: "🚨 Margin alert: {n} clients below floor; {m} CRITICAL — see kb:finance/margins/{date}.md."

8. **For repeat offenders** (below floor for 3+ consecutive days): raise an Approval — PROPOSE one of:
   - "Renegotiate up" (option A): bump price at next renewal date
   - "Trim scope" (option B): reduce deliverables to match current price
   - "Fire" (option C): formal off-boarding (founder + AM owned)
   - "Accept" (option D): explicit decision to keep at sub-floor margin (with reason)
   - Founder decides; never auto-propose option C without options A/B/D presented as alternatives.

## Rules

- **Never auto-fire.** The agent's autonomy is execute_safe for ALERTS only; firing is a propose-tier decision owned by founder + AM. Even for severely negative margins.
- **Allocated cost is fuzzy by design.** Don't claim more precision than you have. The point is direction-of-margin, not 3 decimal places.
- **Pass-through must net to zero.** If a client's pass-through media spend isn't being billed back, that's a different finding (revenue leakage, severity=high) — surface it but don't conflate with a margin alert.
- **Discount-driven margin drops are flagged but NOT escalated.** The discount-governor agent owns those — emit a finding mentioning it, but don't raise a propose on top of theirs.
- **The 30-day window smooths noise.** Don't fire alerts off a single bad week — the rolling window handles that. If a daily run shows a one-day spike, log it but don't escalate.
- **Always link to kb:finance/margins/{date}.md from the Slack alert.** The founder + AM need the full table to make the call.

## Output contract

The margin-monitor's `run_summaries`:
- `deliverable_kind`: `margin_run`
- `deliverable_ref`: path to `kb:finance/margins/{date}.md`
- `highlights`: `{ clients_below_floor: <int>, clients_critical: <int>, repeat_offenders_escalated: <int>, top_below_floor_client: <string>, primary_cause_breakdown: { cost_up: <int>, revenue_down: <int>, allocation_up: <int>, mixed: <int> } }`
- `summary_text`: one-line — "Margin scan: {clients_below_floor} below floor ({clients_critical} CRITICAL); top: {client} at {pct}% vs floor {floor}%."
