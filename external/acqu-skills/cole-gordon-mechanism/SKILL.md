---
name: cole-gordon-mechanism
description: Use when writing the headline hook for an offer or ad. Structure as: most people make mistake X → consequence Y → our way → benefit Z. Mechanism-led, not claim-led.
---
# SKILL: Cole-Gordon Mechanism

The headline construction pattern that beats claim-led copy in sophisticated markets. Used by Acqu's offer-architect + creative-studio for every ad-headline and offer-positioning that needs to break through "I've heard it all before."

## Purpose

Replace "we'll get you X result" (claim-led; the prospect has heard it 1,000 times and discounted it) with "most people are getting X wrong because Y; our mechanism is Z; you get [specific result] without [pain]" (mechanism-led; sounds different; bypasses the prospect's claim-fatigue filter).

## Workflow

For every headline you draft:

1. **Identify the mistake the prospect is currently making** (or that "most people in their position" make). It should be specific enough to be falsifiable. NOT "people don't market right." YES "agencies are launching new creative without testing the angle first, which is why CPL stays flat after week 2."

2. **State the consequence of that mistake.** What's the cost of staying wrong? NOT "you lose money." YES "you spend 60% of your media budget on creative that the algorithm has already classified as fatigued."

3. **Introduce the mechanism — YOUR way.** The mechanism is a SPECIFIC method, not a value-claim. NOT "our proven system." YES "our 5-angle weekly rotation, where every Monday we identify the top-performing psych driver and ship three variant tests by Wednesday."

4. **State the benefit — SPECIFICALLY measurable.** NOT "better results." YES "CPL drops 30-50% in the first 4 weeks because you're never running fatigued creative."

5. **Stitch the four parts into one headline + one supporting subhead:**
   - HEADLINE: the mistake → consequence compression. "Most agencies are losing 60% of their budget to fatigued creative they can't see in time."
   - SUBHEAD: the mechanism → benefit compression. "Our weekly 5-angle rotation cuts CPL 30-50% in the first month."

## Examples (study these — they're the pattern)

**Bad (claim-led):**
> "Get 3× more leads with our proven Meta ads system."
> — Generic claim, no mechanism, sounds like every other ad.

**Good (mechanism-led):**
> "Most agencies test one new ad per week. We launch 5 angles every Monday."
> "Result: 3× the testing velocity, 40% lower CPL by week 4."

**Bad:**
> "Improve your sales with better lead qualification."

**Good:**
> "75% of your inbound leads are unqualified — and your reps know it within 30 seconds. So why are they on calls with them?"
> "Our pre-call scoring pulls 12 signals from the application and disqualifies before booking. Reps only talk to leads scoring 80+."

## Rules

- **Mechanism is specific and falsifiable.** "Our 5-angle weekly rotation" is a mechanism. "Our proprietary process" is not — it's a black box, which prospects discount.
- **The mistake must be one the target prospect IS making** (not a strawman). Acqu's research informs this; if you're guessing, use the offer-research agent's outputs in `kb:offers/proposals/`.
- **Numbers in the benefit should be substantiated.** "CPL drops 30-50%" needs case-study evidence in `kb:proof/`. If unsubstantiated, blocked by `ad-claim-compliance` (which runs `ftc-claim-review`).
- **NEVER start a headline with a claim.** "Get 5× ROAS" is the wrong opening — it's where claim-led ads go. Start with the mistake or the consequence.
- **Compress aggressively.** Mechanism-led works best in 12-20 words for the headline. Long-form discovers the mechanism in the body; the headline gets the click.
- **Test against `skill:adversarial-offer-critique`** — the validator will check whether the headline leads with mechanism or claim. Lead with claim = block.

## Output contract

The offer-architect's headline section contains:
- HEADLINE (one line, mechanism-led, 12-20 words)
- SUBHEAD (one line, benefit-quantified, 12-25 words)
- **(Private note)**: the mistake + consequence + mechanism + benefit breakdown showing where each headline piece came from. The validator + the founder review this to confirm mechanism-led construction.
