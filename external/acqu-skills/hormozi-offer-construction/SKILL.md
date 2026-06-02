---
name: hormozi-offer-construction
description: Use when building or refining an offer spec. Structure the value stack so perceived value ÷ price ≥ 10×; sequence by perceived-cost-to-deliver vs perceived-value-to-buyer; produce a stack that makes "yes" the easy answer.
---
# SKILL: Hormozi Offer Construction

The structural rubric for Acqu's offer designs. Borrowed from Alex Hormozi's $100M Offers framework, adapted for B2B agency services. Produces offers where the value math is so lopsided that buyers feel they'd be stupid to say no.

## Purpose

Transform a gap-brief (the problem-to-solve + target-vertical + price-point) into a value stack — a sequenced bundle of deliverables where the sum-of-perceived-values exceeds the price by at least 10×, AND where the highest-perceived-value items cost the least to deliver.

## Workflow

1. **Identify the Dream Outcome.** The result the client truly wants — not what they say they want. ("Get more leads" is the surface ask; the dream outcome is usually "stop feeling anxious about revenue" or "be the founder who scaled past $10M.") Write the dream outcome in one sentence.

2. **List the Obstacles.** What's blocking the dream outcome? Be specific. ("Doesn't have a creative pipeline." "Can't write copy." "Doesn't know which audiences work." "Lacks attribution.") Each obstacle is a candidate value-stack item — solve it as a deliverable.

3. **Convert each Obstacle to a Solution-Deliverable.** Specific, dated, measurable. NOT "we'll help with creative." YES "we'll deliver 8 new ad concepts per month with copy + image direction, in your Drive folder by the 7th of each month."

4. **Score each Deliverable on the 2×2:**
   - **Perceived Value to Buyer** (LOW / HIGH) — how much would the buyer pay if they bought this standalone?
   - **Perceived Cost to Deliver** (LOW / HIGH) — how expensive does it LOOK to provide?
   - The MOST valuable position: HIGH perceived value × LOW perceived cost (e.g., a one-page "Quarterly Roadmap" document that looks bespoke but is 80% template). Stack these heavily.
   - The LEAST valuable position: LOW perceived value × HIGH perceived cost — DROP these from the stack.

5. **Sequence the Stack for "yes-momentum":**
   - Open with the highest-perceived-value item (the headline deliverable).
   - Layer in the obstacle-removers in order of "what would I worry about next?"
   - End with the risk-reversal (the guarantee — handled by `skill:guarantee-design`).
   - The buyer should mentally check off each obstacle as they read the stack.

6. **Compute the Value Math:**
   - For each deliverable, write down its standalone perceived value in dollars.
   - Sum the stack.
   - Divide by the proposed price.
   - **Target ratio: ≥10×.** If under 10×, you have two levers: (a) raise the perceived value of the stack (add more high-value low-cost items), or (b) lower the price (only as a last resort).
   - Show the math explicitly in the offer doc. "$58k in value for $4.8k/mo = 12× value-to-price."

7. **Sanity-check against the offer-validator's questions** (handled by `skill:adversarial-offer-critique` in the next agent). Don't pre-rationalize obvious weaknesses; the validator will find them.

## Rules

- **Specific, dated, measurable. ALWAYS.** Vague deliverables ("strategic guidance") destroy the value stack because the buyer can't perceive them. "Monthly 90-min strategy call recorded + delivered with action items in Drive by EOD" is the same thing, with perceived value attached.
- **Drop items that are HIGH cost / LOW value.** They eat margin without moving the close rate. Every item must earn its place in the stack.
- **The headline deliverable should be the dream-outcome ENABLER.** If the dream outcome is "$10M ARR," the headline is the lead-flow system that produces the volume, not the daily reporting (reporting is a stack item, not the headline).
- **NEVER stack obstacles you can't actually remove.** The offer breaks at the first under-delivered promise. If you don't have a creative pipeline that works, don't promise 8 concepts/mo.
- **The 10× ratio is the FLOOR, not the ceiling.** Higher is better. 20× ratios close themselves.
- **Price holding is a function of stack credibility, not stack quantity.** 5 strong items beat 12 weak ones. The validator will trim aggressively.

## Output contract

The offer-architect's `run_summaries` carries:
- `deliverable_kind`: `offer_spec`
- `deliverable_ref`: path to `outputs/{offer-name}-launch-package.md`
- `highlights`: `{ value_to_price_ratio: <float>, stack_item_count: <int>, headline_deliverable: <string>, dream_outcome: <string> }`
- `summary_text`: one-paragraph plain-English description of the offer + the value math.

The offer-validator reads this and runs adversarial review before the founder sees it.
