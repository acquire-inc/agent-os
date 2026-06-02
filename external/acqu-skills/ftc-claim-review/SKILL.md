---
name: ftc-claim-review
description: Use before any ad creative or claim ships externally. Extract every factual assertion; verify substantiation against kb:proof/; check FTC Act §5 + prohibited categories; produce a pass/block verdict per claim with required edits or required fine print.
---
# SKILL: FTC Claim Review

The discipline that gates external ad launches. Per CLAUDE.md hard gate #1: no client ad launch ships until `ad-claim-compliance` has reviewed and approved. A missed violation is a ban, a fine, or a lawsuit — false positives cost a delayed launch; false negatives cost the client and the agency.

## Purpose

For every factual claim in a piece of creative — performance numbers, benefit promises, testimonials, before/afters, comparative statements, time-bound offers — produce one of three verdicts:

- **PASS** — substantiated, FTC-compliant, no required edits.
- **PASS WITH FINE PRINT** — substantiated but requires specific disclosure (typical results, individual results may vary, paid endorser, etc.). Required disclosure text included.
- **BLOCK** — unsubstantiated, prohibited category, or not survivable under regulator scrutiny. Required rewrite included.

## Workflow

For each piece of creative under review:

1. **Enumerate every factual claim.** Performance ("3× more leads"), benefit ("guaranteed weight loss"), testimonial ("I made $50k"), comparative ("better than competitor X"), time-bound ("limited time"), authority ("doctor-recommended"). Number them. Treat implicit claims (image of stacks of cash with "you could be next") as claims too.

2. **For each claim, run substantiation lookup**:
   - Query `kb:proof/substantiated-claims/` for documented evidence (numbers, dates, source).
   - Query `kb:proof/approved/{client-slug}/` for client-specific approved case data.
   - If the claim is a TESTIMONIAL: require (a) signed authorization on file in `kb:proof/testimonial-releases/`, (b) typical-results disclosure or representative-results data showing this testimonial is not an outlier.
   - If unmatched in either kb path: claim is UNSUBSTANTIATED → block path.

3. **Run FTC Act §5 check**:
   - Truthfulness: does the claim accurately represent reality at the time of substantiation? (Old data — flag as stale if >12 months and the metric is performance-tied.)
   - Non-deceptive: would a reasonable consumer be misled? (Imagery, omissions, fine-print contradictions.)
   - Material: would this claim influence a purchase decision? (Material claims need stronger substantiation.)
   - If FTC §5 fails on any axis → block path.

4. **Run prohibited-category check** — the CRA-adjacent list. Categories where Acqu/clients face existential exposure if claims slip:
   - Health/medical (weight loss, cure, treatment) — requires licensed-professional endorsement OR disclaimer per FDA guidelines
   - Financial (income claims, guaranteed returns) — requires actual results data + disclosure of typical results
   - Credit/employment/housing decisioning — REFUSE; route to CRA blocklist (`packages/core/src/architect/cra-blocklist.ts`)
   - Legal services — bar-association approval required
   - Children's product (COPPA-adjacent) — additional review

5. **Compile the verdict per claim**:
   - PASS rows: claim text + source citation
   - PASS WITH FINE PRINT rows: claim text + required disclosure text + placement requirement (visible, legible, contemporaneous)
   - BLOCK rows: claim text + specific reason + recommended rewrite

6. **Emit the result**:
   - Write `kb:compliance/reviews/{date}-{creative-slug}.md` with the full breakdown.
   - For approved creative: mark status=compliant in the run-summary's `deliverable_ref` field; the launcher reads this before queuing.
   - For blocked creative: raise an Approval with the block list and the recommended rewrites; do not let the run mark "done" silently. The creative-studio agent picks up the rewrites.
   - For PASS WITH FINE PRINT: include the required disclosure verbatim in the run-summary so the launcher attaches it to the creative metadata.

## Rules

- **Never approve a claim you are not confident will survive FTC scrutiny.** "Probably fine" is a block.
- **Ask: would this claim stand up in court if a class-action attorney looked at it?** If the answer is "depends on the attorney," it's a block.
- **A delayed launch is recoverable; a regulator action is not.** Err on the side of caution.
- **No "as good as" or "as effective as" without head-to-head data on file.**
- **Authority claims require credentials on file.** "Doctor recommended" needs a specific doctor's authorization in `kb:proof/endorsements/`.
- **Testimonials require typical-results context.** A standalone outlier testimonial is deceptive by omission.
- **Imagery is a claim.** A "before" photo with no "after" but an implied transformation is a claim. Treat it as such.
- **Time-bound offers must have a real expiration date.** Perma-running "limited time" is per se deceptive.
- **The verdict is BINDING.** creative-studio must edit and re-submit before the launcher can queue. The PM cannot override without explicit Founder + legal sign-off (escalate the override decision through the Approvals inbox).

## Output contract

The agent's `run_summaries` for an ad-claim-compliance review carries:
- `deliverable_kind`: `compliance_review`
- `deliverable_ref`: path to `kb:compliance/reviews/{date}-{creative-slug}.md`
- `highlights`: `{ verdict: "approved" | "approved-with-disclosure" | "blocked", block_count: <int>, disclosure_count: <int>, claim_count: <int>, prohibited_categories: [...] }`
- `summary_text`: one-paragraph plain-English verdict with the headline numbers and the most important call.
