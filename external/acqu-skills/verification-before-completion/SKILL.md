---
name: verification-before-completion
description: Use before marking ANY run done. Verify your output is real and right against three concrete checks — the deliverable exists, the numbers tie out, and the linter for this agent class passes. If any check fails, do NOT report done.
---
# Verification Before Completion

The discipline 57+ agents share: **before you flip the run to `status=done` and post a summary, verify the work you claim is real.** A confident-sounding summary that hides a missing file or a fabricated number is worse than a failure — it costs trust + downstream agents act on the lie.

The check is three steps. Each one fails LOUD if it can't be satisfied.

## Steps

1. **Deliverable check.** Whatever you said you'd produce — open the file, fetch the URL, query the row. If it doesn't exist, you're not done.
   - For a written deliverable (kb doc, run-summary, plan.md): read it back and confirm it contains the substance you promised, not a placeholder or `<TODO>`.
   - For a tool-call deliverable (an approved Pipeboard pause, a Slack message sent, a vector chunk written): confirm the side effect actually landed. Check the audit log or the destination system.
   - For a no-op deliverable (e.g. "nothing to alert on today"): say so explicitly in the summary and emit a `run.completed` with `deliverable_kind = 'no_op'`. Silent done with no output is forbidden — operators can't distinguish "did the work and there was nothing" from "didn't run."

2. **Numbers tie out.** If your output contains any quantitative claim — a CPR, a count, a percentage, a dollar amount, a date range — re-pull the source data and confirm the number matches what you wrote.
   - Off-by-one date windows are the most common silent failure (you said "last 7 days" but pulled `between now() - 7 days and now() - 1 day` = 6 days).
   - Currency conversions, unit conversions, rounding direction — every transformation is a potential drift point. Show the math in your scratchpad, then re-do it.
   - If you cite the result of a tool call, the tool's `tool.result` Relay event must already exist for this `run_id` with a matching `input_hash`. If not, you're claiming a number you didn't actually fetch.

3. **Class-specific linter passes.** Every agent class has a domain check it MUST run before declaring done. The check lives in the agent's primary skill (e.g. `skill:daily-ad-ops` runs the rule-engine compliance check; `skill:tenant-isolation-testing` confirms every positive control returned ≥1 row).
   - If your primary skill doesn't have a linter named, that's a finding: emit `finding.recorded` (category=anomaly, severity=low, title="verification linter missing for <agent_key>") so the operator can backfill.
   - If the linter exists and FAILS, do NOT proceed. Either fix the gap or escalate (raise an Approval, set status=escalated).

## Rules

- **Confident-but-wrong is the worst outcome.** A failed run with a clear error is recoverable; a `done` run with bad data corrupts every downstream agent that reads it. When in doubt, escalate.
- **Verification is not optional.** The runner's terminal-status handler does NOT distinguish "you verified and it passed" from "you skipped verification." Future evals will (the `agent-evaluator` scorecard will read `verification.passed` from the `run_summaries.highlights` jsonb). Build the habit now.
- **No silent edits to your own deliverable to make the check pass.** If step 1 fails because the file is empty, write the file with real content — don't write a placeholder and call it verified. The eval pass will catch the discrepancy via the `tool.result` audit trail.
- **Time matters less than truth.** Going over budget to verify properly is a smaller cost than producing wrong output. Burn the extra few cents.

## Output contract

When verification passes, include in your run-summary (the `summary_text` field of `run_summaries`):
- One line per step: `✓ deliverable: <what + where>`, `✓ numbers: tied to <source>`, `✓ linter: passed`.
- The `run_summaries.highlights` jsonb gets `{ "verification": { "passed": true, "deliverable_kind": "...", "checks": ["deliverable", "numbers", "linter"] } }`.

When verification FAILS, do NOT post `status=done`. Either:
- Raise an Approval describing the gap (`raiseApproval(context="verification failed: <step>", options=[fix, accept-as-is, abort])`), or
- Post `status=failed` with the gap in the summary and emit `finding.recorded(category=anomaly, severity=medium)` so the founder sees the pattern in #findings.
