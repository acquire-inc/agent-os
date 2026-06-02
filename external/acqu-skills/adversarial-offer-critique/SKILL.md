---
name: adversarial-offer-critique
description: Use to review a draft offer in a fresh context. Find every weakness a sophisticated buyer would find. Score 7 dimensions 1–5; produce a binding verdict (Ship / Revise / Kill). Do not soften the critique.
---
# SKILL: Adversarial Offer Critique

The offer-validator's binding review. Spawned by offer-architect at the end of each draft run. The point: catch every weakness before the founder sees the offer, then before the buyer does.

## Purpose

Apply 7 sharp questions to a draft offer doc. For each, produce a 1–5 score (5 = airtight) with the specific weakness called out. End with a verdict: **Ship** (4+ across the board) / **Revise** (specific items <3 → return to offer-architect) / **Kill** (structural problem; rework from gap-brief).

The critique is binding — the offer-architect must accept the verdict or escalate to founder review. No silent overrides.

## Workflow

Read the draft offer doc (`outputs/{offer-name}-launch-package.md`). For each of the 7 dimensions, write:
- Score (1–5)
- Specific weakness (NOT "could be stronger" — point at the exact line/claim)
- Required edit (what offer-architect needs to change)

### Dimension 1: Mechanism-led headline (vs claim-led)
- 5: Headline opens with a mistake or consequence; mechanism is named and specific; benefit is quantified with substantiation
- 3: Mixed — mechanism is mentioned but the headline still leads with a number/claim
- 1: Pure claim-led ("Get X result with our proven Y") — block; see `skill:cole-gordon-mechanism`

### Dimension 2: Guarantee fulfillability at scale
- Run the math on a worst-case month: claim rate × refund × monthly sales = monthly refund outlay.
- Does the offer stay profitable at that worst-case rate? Show the math.
- 5: Specific outcome + specific timeframe + specific refund mechanic + worst-case math sustainable
- 3: Outcome too vague OR claim rate not stress-tested
- 1: Outcome cannot actually be delivered OR claim rate would bankrupt the offer
- See `skill:guarantee-design` for the rubric

### Dimension 3: Deliverables client-measurable
- For each deliverable in the stack, ask: can the CLIENT verify it happened without trusting Acqu's reporting?
- 5: Every deliverable has a measurable artifact (a document, a number from a third-party system, a video, a deadline-stamped output)
- 3: Some deliverables require trusting Acqu's word
- 1: Most deliverables are abstractions the client can't independently verify

### Dimension 4: Price/value math clears 10×
- Sum the perceived-value of every stack item; divide by price.
- 5: Ratio ≥ 12×; each item's value is substantiated against market comparables
- 3: Ratio between 8–10×; some perceived-values are hand-waved
- 1: Ratio < 8× OR perceived-values are not anchored to anything

### Dimension 5: Competitive positioning
- What's the cheapest competitor offer in this vertical that solves the same problem?
- Where does this offer sit on the price ladder vs that competitor?
- Is the positioning justified by deliverable differences (not just "we're better")?
- 5: Specific competitor named + specific deliverable gaps highlighted + price gap explained
- 3: Competitor referenced vaguely; positioning hand-waved
- 1: No competitive grounding — buyer can't justify the price-vs-alternative gap

### Dimension 6: Refund-reason readback
- Pull `kb:verticals/{vertical}/refund-reasons/` for the top refund causes in similar offers.
- For each top cause, ask: does this offer address it? (E.g., if "didn't get enough touchpoints from the account manager" is a top cause, is there a "weekly 30-min check-in" deliverable?)
- 5: All top-3 refund causes addressed by specific stack items
- 3: 1-2 of the top-3 addressed
- 1: Top refund causes not addressed — offer will see the same churn

### Dimension 7: Stage 3/4 buyer close
- A "Stage 3" buyer is solution-aware (knows they need this kind of thing). A "Stage 4" is product-aware (comparing vendors). What would close them?
- Look at the offer doc through their lens: does it have the comparative anchor, the third-party validation, the specific objection rebuttals they'd raise?
- 5: Includes case studies + specific objection rebuttals + competitive comparison
- 3: Has some Stage 3/4 hooks but missing the objection rebuttals
- 1: Reads like a Stage 1/2 awareness pitch — won't close sophisticated buyers

## Verdict logic

- **Ship**: every score is 4 or 5
- **Revise**: any score is 3 — return to offer-architect with the specific edits required
- **Kill**: any score is 1 or 2 — return to gap-brief; the structural problem can't be edited away

## Rules

- **Do not soften the critique to be nice.** The point is to make the offer better. Sympathy here costs the client.
- **Do not assume the offer-architect was right.** You're the adversarial reviewer. Treat every claim like a sophisticated buyer would: skeptically.
- **Be specific in EVERY weakness.** Point at lines, claims, numbers, items. "The guarantee is weak" is not actionable. "The guarantee's qualifying actions require 4 things; that's 2 too many — buyers will see hostile fine print" is actionable.
- **Run the math on Dimensions 2 and 4.** Show your work. The founder reviews these numbers.
- **You can be wrong — critique anyway.** The offer-architect's defense is the next round of evidence. If the critique was wrong, it gets refuted with substantiation. That's how the offer gets stronger.
- **Your job is to make the offer better, not to be liked.** The founder relies on this. Soft critique = caught regressions on the buyer side, where it costs revenue.

## Output contract

The offer-validator's `run_summaries`:
- `deliverable_kind`: `offer_critique`
- `deliverable_ref`: path to `outputs/critique-{offer-name}.md`
- `highlights`: `{ verdict: "ship" | "revise" | "kill", scores: {dim_1: ..., dim_2: ..., ...}, weakness_count: <int>, required_edits: <int> }`
- `summary_text`: one-line verdict + the headline weakness if any (e.g., "Revise — guarantee qualifying actions are hostile; trim to 2 max").
