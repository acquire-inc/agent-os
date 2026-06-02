---
name: guarantee-design
description: Use after the value stack is set. Design a guarantee strong enough to remove perceived risk but narrow enough that fulfillment math works at scale. Run the worst-case-month claim rate before locking the guarantee text.
---
# SKILL: Guarantee Design

The risk-reversal layer of every offer. The right guarantee converts cautious buyers; the wrong guarantee bankrupts the business or earns regulator attention.

## Purpose

Produce a guarantee that:
- Removes the buyer's perceived risk (the close-rate lift)
- Survives a worst-case-month claim rate (the margin defense)
- Stays on the right side of FTC §5 (the regulator defense)
- Is specific enough to fulfill without negotiation (the ops defense)

## Workflow

1. **Identify the buyer's biggest fear.** What's the worry that's keeping them from saying yes? It's usually one of: "it won't work for me specifically," "I won't get my money back if it doesn't work," "I'll be stuck in a contract."

2. **Pick the guarantee shape** that addresses that fear directly:
   - **Outcome guarantee** — "X result by Y date or we keep working until you get it (or refund Z)." Strongest. Highest claim risk. Use when the outcome is genuinely achievable and measurable.
   - **Conditional refund** — "If you do A, B, C and don't see X, full refund." Buyer must put in effort to claim. Filters tire-kickers.
   - **Performance refund (partial)** — "If we don't hit 80% of the target, refund the gap pro-rata." Aligns incentives but is operationally messy.
   - **No-questions refund window** — "30-day money-back, no questions." Useful for new offers with unproven close rates; lowest perceived risk to buyer; clearest revenue impact to model.
   - **"Better-than-money-back" / Bonus on dissatisfaction** — "If you're not satisfied, keep the work + take a $X bonus." Counterintuitive; works in high-perceived-value contexts.

3. **Run the worst-case-month math:**
   - Expected claim rate at full scale: pull from `kb:offers/historical-claim-rates/` for similar offers; if no data, assume 15% as a conservative upper bound.
   - Compute: (claim rate) × (refund amount per claim) × (sales per month) = worst-case refund outlay.
   - Add: (fulfillment cost-to-date per claimed client) × (sales per month × claim rate) = sunk-cost on claimed clients.
   - Total worst-case-month exposure = refund outlay + sunk-cost.
   - **Is the offer still profitable in the worst-case month at expected close-rate uplift?** If not, narrow the guarantee or raise the price floor.

4. **Tighten the wording to be fulfillable:**
   - Specific outcome (no fuzzy language). "8 qualified leads/mo at <$200 CPL" not "improved lead flow."
   - Specific timeframe with a clear start (when does the clock begin? when's the deadline?).
   - Specific qualifying actions the client must take (so a non-engaged client can't claim — but the bar must be reasonable).
   - Specific refund mechanic (full / partial / pro-rata / credit). State the dollar.
   - Specific exclusions (force majeure, client-caused issues — but keep this short; long exclusion lists destroy the guarantee's perceived strength).

5. **Run the FTC §5 check:**
   - Is the guarantee truthful at the time of offer? (Don't promise outcomes you can't deliver.)
   - Is the qualifying-action list reasonable? (Hostile fine-print invalidating most claims is deceptive.)
   - Is the refund mechanic clear? (Buried fine print that makes refunds practically unobtainable is deceptive.)

6. **Verify it survives `skill:adversarial-offer-critique`:**
   - Can the validator imagine a customer claiming in good faith and being denied? (Bad sign — the guarantee is hostile.)
   - Can the validator imagine a customer getting the outcome the guarantee promises and STILL claiming? (Bad sign — the guarantee is too loose.)

## Rules

- **A guarantee you can't honor is worse than no guarantee.** The first denied claim becomes a refund-policy review on Trustpilot, then a class action.
- **Specific beats generous.** "$X back if no lead by day Y" beats "satisfaction guaranteed."
- **The qualifying actions must be reasonable.** "Must attend every weekly call AND submit X by Y AND complete the onboarding within 7 days" is hostile — buyers smell it. Two qualifying actions max, both reasonable.
- **Time-bound it.** Open-ended guarantees create permanent liability. "30 days," "first 90 days," "by month 3" — pick a clock.
- **Never guarantee something outside your control.** Don't guarantee "Meta will not ban you" or "the algorithm will not change." Guarantee what YOU do, not what THEY do.
- **Show the worst-case math in the offer doc** as a private note. The validator + the founder need to see that the guarantee was stress-tested.

## Output contract

The offer-architect's guarantee section in the offer doc contains:
- The guarantee text (buyer-facing, plain English, headline-bold)
- The qualifying actions (1-2, clearly enumerated)
- The refund mechanic (specific dollar/percent + how to claim)
- The exclusions (1-3 max, narrow)
- **(Private note, NOT shown to buyer)**: worst-case claim-rate model, monthly-refund-outlay calculation, and the conclusion "offer profitable at X% close-rate uplift even at Y% claim rate."
