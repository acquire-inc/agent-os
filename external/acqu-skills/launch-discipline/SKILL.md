---
name: launch-discipline
description: Use before any Meta ad goes live. Validate the package, post the diff, wait for approval, then write PAUSED with $10 budget cap. Never publish ACTIVE. Never publish > $10. Never publish without approval.
---
# SKILL: Launch Discipline

The discipline that makes launcher trustworthy. Three rules that have NEVER been violated and never will be. The PreToolUse hook 1c enforces the approval; this skill is the in-prompt instructions for the agent to ALSO enforce, so a future model misreading the autonomy doesn't accidentally over-promise.

## Purpose

Take an approved creative package + target ad-set spec, validate it against the campaign plan, post the diff for one-tap human approval, then write the ad to Meta in PAUSED state with budget locked at $10. The PM activates manually after the launch is confirmed safe.

## Workflow

1. **Validate the package against `kb:campaign-plan/{tenant}/`**:
   - Does the offer in the package match an active offer in the campaign plan? (No offer in the plan = block; route to `offer-architect` first.)
   - Is the target audience locked? (Audience definition matches a documented audience in `kb:campaign-plan/{tenant}/audiences.md` = ok; ad-hoc audience = block until documented.)
   - Does the creative-set respect the naming convention? (See `skill:naming-convention`.)
   - Does the ad-set's daily budget cap in the plan match what we're about to write? (Mismatch = block; ask which is correct.)

2. **Construct the full launch diff** WITHOUT writing to Meta:
   - Campaign record (if new campaign): name, objective, special-ad-category (if applicable), buying-type
   - Ad-set record: name (per convention), targeting (verbatim from the audiences doc), placements, optimization goal, bid strategy, budget = $10/day (locked)
   - Ad records: name (per convention), creative ID, headline, body, link, status = PAUSED
   - Pixel events to track (per the campaign-plan)

3. **Run the pre-launch checklist** (the `ftc-claim-review` outputs from `ad-claim-compliance` MUST be PASS or PASS-WITH-DISCLOSURE for every claim in the creative — block if any are BLOCK):
   - Required disclosures from `ftc-claim-review` are included in the ad body (verify the disclosure text is present and visually adequate)
   - UTM parameters match `kb:campaign-plan/{tenant}/utm-convention.md`
   - Pixel events tagged correctly
   - Creative dimensions match placement specs (no upload-time auto-crop surprises)

4. **Post the diff to Slack #launch-approvals** with a raised Approval (the PreToolUse hook routes this automatically because `spec.autonomy = propose`):
   - Two options: "Launch (PAUSED, $10 cap)" / "Cancel"
   - Include the full diff inline
   - Include the `ftc-claim-review` verdict for every claim
   - Include the link to the campaign-plan reference

5. **On Approval = Launch:**
   - Write to the Pipeboard × Meta connector: create campaign (if new), create ad-set, create ads — all with `status = PAUSED` and ad-set daily budget = $10.
   - Capture every Meta ID returned (campaign_id, ad_set_id, ad_ids[])
   - Save the launch record to `kb:campaign-plan/{tenant}/launches/{date}-{slug}.md` with the IDs + the diff + the approval timestamp + the approver

6. **Confirm in Slack:** "✅ Live (PAUSED) at {timestamp}. Budget locked at $10/day. Activate manually when ready. IDs: campaign={...}, ad_set={...}, ads=[...]."

7. **On Approval = Cancel:**
   - Record the cancellation in the run's summary
   - Do NOT write to Meta
   - Post the cancellation to Slack with the approver's name + reason if given
   - Emit `finding.recorded(category=anomaly, severity=low, title="Launch cancelled by approver")` so the founder sees the pattern if cancellations cluster

## Rules

- **NEVER write ACTIVE.** PAUSED is mandatory. The PM activates after manually confirming the ad is safe (tracking firing, claim-check pass, no unexpected automatic optimizations).
- **NEVER write a budget > $10.** Period. The PM raises the budget manually after activation. The agent's daily budget cap is hardcoded; no override accepted.
- **NEVER write without an approved diff.** The PreToolUse hook 1c enforces this, but the prompt also enforces it. Two layers because Meta writes are irreversible.
- **NEVER edit the creative package mid-launch.** If the creative needs a fix, cancel the launch, send back to creative-studio, re-submit. Editing in-flight loses audit-trail clarity.
- **NEVER skip the `ftc-claim-review` check.** If `ad-claim-compliance` returns BLOCK on any claim, the launch is blocked. No exceptions.
- **NEVER assume a previous approval covers a new launch.** Each launch is its own diff and its own approval. Even if "the same creative ran last week."
- **The launcher is the AUDIT TRAIL.** Every launch must produce a `kb:campaign-plan/{tenant}/launches/{date}-{slug}.md` doc with the IDs. If the launch happened but the doc didn't write, that's a finding (severity=high).
- **Forbidden: special-ad-category mismatches.** Verify the campaign's special-ad-category matches the offer's classification in `kb:offers/{slug}/regulatory.md`. Mismatched special-ad-category is auto-rejected by Meta AND a compliance issue (HOUSING / CREDIT / EMPLOYMENT — CRA-adjacent territory).

## Output contract

The launcher's `run_summaries`:
- `deliverable_kind`: `launch` (on Approval=Launch) | `launch_cancelled` (on Approval=Cancel)
- `deliverable_ref`: path to `kb:campaign-plan/{tenant}/launches/{date}-{slug}.md`
- `highlights`: `{ campaign_id, ad_set_id, ad_ids, budget_locked: 10, status_written: "PAUSED", approver, approval_timestamp, ftc_review_verdict, cancelled_reason: <string|null> }`
- `summary_text`: one-line — "✅ Launched PAUSED {n} ads at ${budget_locked}/day; activate manually." OR "❌ Cancelled by {approver}: {reason}."
