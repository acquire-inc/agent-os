---
name: verification-before-completion-v2
description: Use before flipping any run to status=done. A separate fresh-context verifier re-derives success criteria from the engagement contract (never from the building run's transcript), demands an inspectable artifact per criterion, runs the three-viewport visual sweep on any client-facing UI, and exits only when a clean re-audit shows no non-blocked gaps. Replaces the 90-line session-shipped stub.
---
# SKILL: Verification Before Completion (v2 — full doctrine)

The v2 candidate that replaces the session-shipped 90-line `verification-before-completion` stub at `external/acqu-skills/verification-before-completion/SKILL.md`. The stub has the three-step shape (deliverable / numbers / linter) but does not name the three load-bearing structures that turn the discipline from a slogan into a ratchet: contract-driven criteria derivation, a fresh-context verifier, and the multi-viewport visual sweep for client-facing UI. This v2 lands them on our anatomy, our `run_summaries.highlights.verification` jsonb, and our closed Relay namespace.

The stub stays in place until the operator approves the swap as a separate step.

## Purpose

Nothing flips to `status=done` on the building agent's own report. The structural answer is a separate verifier that runs from a fresh context, reads the engagement contract directly, demands an artifact it can open for every criterion, and refuses the completion claim until a re-audit returns clean. The failure this prevents is the most expensive class of failure a fleet can produce — a confidently-summarized run that conceals a missing file, an invented metric, or a UI that looks nothing like what the summary describes — because that lie corrupts every downstream agent that reads it, and the operator does not catch the drift until trust has already been spent.

## Workflow

1. **Refuse self-grading; spawn the verifier from a clean context.** The building agent does not run its own verification. The runner spawns a `verifier`-typed subagent with a distinct `run_id`, an empty episodic memory window, and no read access to the building agent's transcript. The building agent's terminal signal is `run.escalated` with `payload.reason = "verification_pending"` rather than `run.completed`. The verifier picks up the artifacts, the contract, and nothing else.

2. **Pull the success criteria from the contract, in this priority order.** The verifier reads from disk surfaces in our control plane, ignoring whatever the building agent wrote about what it built:
   - The engagement's `SCOPE.md` "What we ARE doing" block (retrieved via `knowledge.retrieved` from `knowledge_chunks`, filter on `engagement_id` and `doc_type=scope`)
   - Each `Success Criteria` block in the engagement's `ROADMAP.md`
   - The agent's `GOAL.md` if the agent owns one (the self-owned-goal pattern)
   - The agent registry row's `success_criteria` jsonb as the final fallback when no engagement-level contract exists
   The transcript records the building agent's belief about what landed. The contract records the operator's standing definition of what was promised. The verifier scores against the second, never the first.

3. **For every criterion, require an inspectable artifact.** The verifier walks the criteria list and demands one of:
   - A file path it can read via the knowledge-read tool and whose contents match the substance the criterion asks for (not a header, not a `<TODO>`)
   - A destination-side confirmation that a tool-call side effect landed (a row in the destination system, the audit log entry, the Slack message ID returned by the send tool — replayed by reading the `tool.result` event for this run with a matching `input_hash`)
   - A re-pulled source value that confirms any quantitative claim — for every cited count, percentage, date window, or dollar figure, the verifier re-runs the source query and confirms the number agrees. Date-window arithmetic ("last 7 days" pulling a 6-day range, off-by-one) is the most frequent silent error class.
   - A no-op confirmation that says so explicitly in the summary, with `deliverable_kind = "no_op"` on the `run.completed` event. Silent absence is not acceptable because the operator cannot tell a clean no-op run from an agent that failed to fire.
   A claim with no artifact is recorded as a gap. A claim whose artifact is a placeholder is recorded as a gap. The bright line: a successful test run is not a working feature; an existing workflow is not an executing workflow; passing typecheck is not user-correct behavior.

4. **For any UI, deck, ad creative, email render, or public artifact: run the three-viewport visual sweep.** When the deliverable will be seen by a real human, the verifier captures rendered screenshots at the standard responsive cuts (desktop 1440 by 900, tablet 768 by 1024, mobile 390 by 844) and writes their paths into `run_summaries.highlights.verification.visual_evidence_paths`. The verifier then prints an explicit defect ledger, one line per check, each marked PASS-with-evidence-path or FAIL-with-evidence-path. The checks:
   - content outside the viewport
   - horizontal scroll where none is expected
   - vertical scroll where none is expected
   - image fetch failures
   - misaligned or unequal element heights
   - text contrast below threshold
   - dead anchors and broken navigation
   - JavaScript console errors
   - loading indicators that never resolve
   - empty-data renderings
   - silent form-submit failures
   A ledger entry reading "none found" without a screenshot path is not a PASS; it is an invalid ledger and the run is marked unverified. Defects the sweep identifies are corrected and re-captured in the same loop, not catalogued and forwarded.

5. **Loop: audit, fix, re-audit with a fresh subagent.** A single pass is not the gate. The structure is a loop with the exit condition "the latest cycle produced no non-blocked gaps." Between cycles, the building agent (not the verifier) repairs the gaps; the next cycle's verifier is a fresh subagent again (it has not seen the previous cycle's fixes). A gap that carries a `blocked_reason` field (third-party API down, operator-owned dependency missing, blocked on the approval rail) is acceptable to ship around; a gap without a `blocked_reason` blocks the completion claim.

6. **Write the verifier's verdict into the building agent's `run_summaries.highlights`.** The runner's `Stop` hook reads `verification.passed` on the building agent's summary before allowing the building agent's `run.completed` to land. If `verification.passed` is missing or false, the building agent's terminal status becomes `failed` or `escalated` (never `done`), regardless of what the building agent itself claimed.

## Rules

- **A skipped verification is not a passed verification.** The runner's terminal-status handler in `apps/runner/src/hooks.ts` does not, today, distinguish "verified and clean" from "never verified" — the agent-evaluator scorecard (Tier 2 backlog) will distinguish them by reading `run_summaries.highlights.verification.passed`. Build the habit before the scorecard reads it.
- **Confident-but-wrong is the worst outcome.** A failed run with an honest error message is recoverable in the next run; a completed run whose summary disagrees with reality corrupts every downstream agent that reads it for the rest of the day.
- **Editing the deliverable mid-verification to satisfy the check is a Rule-1 bug.** If a file is empty when the verifier reads it, the fix is to write real content. Substituting a placeholder string that satisfies a substring match is gamesmanship the `tool.result` audit trail will catch and the eval gate (Tier 2) will refuse.
- **A fresh verifier means a separate run.** The runner enforces it: same agent class is fine, distinct `run_id` and zero shared context window is required. Reusing the building agent's context defeats the structural separation.
- **The visual sweep is non-negotiable for client-facing surfaces.** A summary that says "checked all three viewports manually, looked clean" without three screenshot paths is an unverified UI. The screenshots are the evidence; the prose is not.
- **Burn budget on the verifier rather than ship unverified.** The per-run cap has headroom for verification cost; if the verifier exhausts the cap before reaching a clean cycle, the run escalates rather than rounds to done.
- **A gap without `blocked_reason` blocks completion.** The verifier's job is to refuse the `done` claim until every criterion either passes-with-evidence or carries an externally-blocked reason recorded in the highlights.

## Output contract

The verifier's own `run_summaries.highlights`:

```json
{
  "verification": {
    "passed": true,
    "deliverable_kind": "kb_doc | tool_call | no_op | ui_artifact | code_change",
    "checks": [
      { "criterion": "<from contract>", "evidence_path": "<file or row ref>", "result": "pass" }
    ],
    "visual_evidence_paths": [
      "kb:verifications/<run_id>/desktop-1440x900.png",
      "kb:verifications/<run_id>/tablet-768x1024.png",
      "kb:verifications/<run_id>/mobile-390x844.png"
    ],
    "layout_ledger": { "viewport_overflow": "pass", "h_scroll": "pass", ... },
    "loop_cycles": 2,
    "blocked_gaps": []
  }
}
```

The verifier's `summary_text` is one line: `"Verification clean in <N> cycles; <M> criteria evidenced; visual sweep <captured|n/a>."` For a failure: `"Verification FAILED on [<criterion list>]; building agent status set to escalated."`

The building agent's `run_summaries.highlights` then carries `verification.passed_by_run_id` pointing at the verifier's run. The runner's `Stop` hook reads this field; only if `verification.passed` is true does the building agent's `run.completed` land.

Relay events:
- `knowledge.retrieved` for each contract read in step 2
- `tool.result` lookups for each side-effect confirmation in step 3
- `knowledge.written` for any screenshot bundle produced by step 4
- `finding.recorded` (category=`anomaly`, severity depends) on every verification failure — `medium` for a gap with a clear path to fix, `high` if the building agent's summary contained a metric no `tool.result` event supports (the fabrication signal)
- `approval.requested` if the verifier needs the operator's judgment on a `blocked_reason` (options: `fix-then-reverify`, `accept-with-gap-noted`, `abort`)
- `approval.resolved` once the operator decides
- `run.failed` (verifier's own) on a structurally-impossible verification
- `run.escalated` (building agent's) on a `verification.passed = false` outcome

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_path: hermes-runtime/skills/agentic/gate-completion-claim-audit/SKILL.md
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the contract-derived-criteria framing (re-derive from operator-owned scope artifacts, not from the build's transcript), the fresh-context verifier separation, the multi-viewport visual sweep with an explicit defect ledger, and the loop-not-single-pass exit condition from the source. Re-authored every sentence in our voice with explicit references to our architecture — `knowledge_chunks` and `knowledge.retrieved` for contract surfaces, `tool.result` replay for side-effect confirmation, the agent registry's `success_criteria` jsonb as fallback, `run_summaries.highlights.verification` jsonb (matches AGENTS-PLAN.md §2.3), the runner's Stop hook for terminal-status gating, and Relay events from the closed 28-event namespace (`run.completed`, `run.escalated`, `run.failed`, `finding.recorded`, `approval.requested`, `approval.resolved`, `knowledge.retrieved`, `knowledge.written`, `tool.result`). The source's substrate-specific machinery (the `gsd-verifier` Claude agent name, the `.planning/GOAL.md` AGENTIC-GO-GOAL-MET promise token, the Ralph Loop fresh-spawn pattern) was deliberately left out — our substrate is the agent-evaluator scorecard (Tier 2 backlog) plus the runner's `status=done` flow, not theirs.
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
