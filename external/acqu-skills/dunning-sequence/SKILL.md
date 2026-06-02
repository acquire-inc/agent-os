---
name: dunning-sequence
description: Use daily 09:00 — find failed payments + at-risk subscriptions; run the canonical 4-touch recovery sequence; never lock a client without founder approval; track recovered revenue.
---
# SKILL: Dunning Sequence

The receivable-recovery discipline. Per CLAUDE.md hard gate #3: no recurring billing before dunning-manager exists — this skill is its core workflow. Recovers revenue without burning client relationships.

## Purpose

For every failed payment + every at-risk subscription, run a 4-touch recovery sequence over 7 days. Touches are escalating: friendly → reminder → urgent → human-handoff. Never auto-lock or auto-cancel — that's a propose decision, owned by the founder.

## Workflow

1. **Pull the daily failure list** from the Stripe connector — all `invoice.payment_failed` and `customer.subscription.past_due` events since yesterday's run. Cross-reference with the Close connector for client context (account manager, contract terms, customer tier).

2. **Classify each failure:**
   - **Card decline** (most common) — payment method needs update. Recoverable with a clean card.
   - **Insufficient funds** — payment method has funds eventually. Re-attempt timing matters.
   - **Card expired** — needs new card on file.
   - **Chargeback** — DO NOT auto-dun. Route to founder + AM immediately (this is a relationship issue, not a billing issue).
   - **Voluntary cancellation in payment portal** — DO NOT dun. Acknowledge + route to save-play agent.
   - **Bank-side fraud flag** — pause sequence; flag to AM; needs human verification.

3. **Determine the touch position** for each non-chargeback failure:
   - **Touch 1 (day 0)** — Card-decline friendly. "Hi {name}, looks like the card we have on file just bounced. Most likely a temporary issue — could you update it here: {portal-link}? Happy to help if you want to jump on a call."
   - **Touch 2 (day 2)** — Reminder + escalation hint. Same friendly tone; mention the account manager's name; include a Calendly link.
   - **Touch 3 (day 5)** — Direct + AM CC'd. Include account manager on the email thread. Acknowledge service-impact risk.
   - **Touch 4 (day 7)** — Human handoff. PROPOSE: pause service / pause billing / call for resolution. Raise an Approval with the 3 options + the founder's call.

4. **Send the touch** via the email connector + a Slack DM if the customer is in #shared-channels via the Slack connector. Templates live in `kb:billing/templates/dunning-touch-{n}.md` — load them per touch position, substitute the variables, send.

5. **Update the recovery state in Close** via the Close connector. Custom field: `dunning_touch_position` (1-4) + `last_dunning_at` (timestamp).

6. **At the end of the run, tally**:
   - Recovered (payment came through since yesterday) — count + dollar value
   - In-sequence (active recovery, not yet recovered) — count + days outstanding
   - Escalated (Touch 4 reached, awaiting founder decision) — count
   - Lost (decided to pause/cancel, or 14+ days past Touch 4) — count + dollar value
   - Write the tally to `kb:billing/dunning-state-{date}.md` + post a 3-line summary to Slack #billing.

## Rules

- **NEVER auto-lock or auto-cancel.** That's a propose decision at Touch 4. The founder owns the lock call.
- **NEVER send dunning email more than once per day to the same customer.** Even if multiple failed events fire — debounce.
- **NEVER dun a chargeback.** Chargebacks are relationship signals; AM handles them.
- **The tone of Touch 1-3 stays friendly.** "We've already escalated to legal" language at Touch 3 burns the relationship. Save the firm tone for the human-handoff conversation at Touch 4.
- **Include the account manager** on Touch 3+. The AM may have context (the client is upgrading, planning a renewal, etc.) that changes the recovery posture.
- **Track recovered revenue.** This is the agent's KPI — recovered $ / outstanding $ per cohort. Surfaces in run_summaries.highlights.recovery_rate.
- **Voluntary cancellation in the payment portal is NOT a dunning case.** Route to save-play (different agent, different workflow).
- **Stripe's auto-retry settings interact with this** — verify Stripe's "smart retries" is OFF for invoices we're managing; otherwise the touch positions get out of sync with the actual retry schedule.

## Output contract

The dunning-manager's `run_summaries`:
- `deliverable_kind`: `dunning_run`
- `deliverable_ref`: path to `kb:billing/dunning-state-{date}.md`
- `highlights`: `{ recovered_count: <int>, recovered_usd: <float>, in_sequence: <int>, escalated_to_founder: <int>, lost_count: <int>, lost_usd: <float>, recovery_rate_pct: <float> }`
- `summary_text`: one-line — "Day's dunning: recovered ${recovered_usd} across {recovered_count}; {escalated} awaiting founder call."
