---
name: output-quality-gate
description: Use before flipping any creative or client-facing deliverable to done. Run three structured checks — accuracy against source, brand-voice fit, and explicit policy compliance — and emit findings on any miss. The gate is mandatory for creative-studio, client-comms, weekly-report, and content-engine.
---
# Output Quality Gate

The structured pre-publish check for AgentOS agents that produce text humans will read — creative drafts, client emails, weekly reports, content pieces. Without it, "confident-but-wrong" outputs slip past `verification-before-completion` (which catches existence and arithmetic, not voice and policy).

## Purpose

`verification-before-completion` is necessary but not sufficient for text deliverables. A weekly report that ties out numerically can still misquote a client's name, miss the brand voice, or drift into territory the operator's content policy rejects. This gate catches those misses before the agent flips status to done. Failures here downgrade the run to `propose` with the gap surfaced for operator review.

## Workflow

1. **Accuracy pass — every concrete claim ties back to source.** For each name, number, date, quote, citation, and product reference in the draft, identify the source in the agent's tool-result audit trail (`tool.result` Relay events for this `run_id`). If a claim has no matching tool-result hash, that claim is unsourced. Either drop it, replace it with a verified equivalent, or escalate.

2. **Voice pass — the draft sits inside the brand voice envelope.** Voice envelope is a per-tenant document (`knowledge://brand/voice.md`) — read it before drafting. Score the draft against four dimensions:
   - Register (formal / conversational / authoritative — must match the envelope's target band)
   - Stance (advocate / observer / coach — must match)
   - Vocabulary (in-policy nouns and verbs; banned words from `knowledge://brand/banned.md` absent)
   - Cadence (sentence-length distribution within the envelope's range)

   Any dimension off-band → flag; the draft does not go out without an operator approval.

3. **Policy pass — explicit content policy is honored.** Read `knowledge://policy/content.md`. Check the draft against the explicit rules (claim guardrails, prohibited categories, mandatory disclaimers, citation requirements). Any rule miss → block. Policy violations are not soft-flags; they hard-fail the run with `finding.recorded` (category `compliance`, severity `medium` minimum, `high` if the violation is in the regulated-claim list).

4. **Three-pass attestation in the run summary.** When all three passes are clean, emit the attestation block (below) in `run_summaries.highlights`. The summary text MUST include one line per pass: `✓ accuracy`, `✓ voice`, `✓ policy`.

5. **On any fail: do NOT mark done.** Either escalate via Approval (preferred — the operator decides between revise / accept-as-is / abort) or post `status=failed` with the gap explicitly named. Silent draft-edit-then-pass is the corruption pattern — never alter the draft to make the gate green; revise the draft openly with the failure surfaced.

## Rules

- The gate runs after the draft is complete, before the publish/send action. Editing after the gate passes invalidates the pass — the gate runs again on the final text.
- Sourcing means a `tool.result` event exists for this `run_id` with content that supports the claim. Memory of prior runs does not source a current claim.
- Voice envelope and content policy live in `knowledge://`. They are read at run start. A draft that pre-dates the latest envelope rev is re-checked against the current envelope, not the one at draft time.
- A policy fail blocks even if voice and accuracy pass. Policy is the floor.
- No degenerate passes. If the gate has nothing to check (empty draft, no claims, no policy applies) the run does not get a green attestation — it emits `output_quality.skipped` with the reason.

## Output contract

```json
{
  "output_quality": {
    "passed": <bool>,
    "accuracy": { "claims_total": <int>, "claims_sourced": <int>, "unsourced": ["<claim summary>", ...] },
    "voice": { "register": "ok | off", "stance": "ok | off", "vocabulary": "ok | off", "cadence": "ok | off" },
    "policy": { "rules_checked": <int>, "violations": ["<rule_id>: <description>", ...] }
  }
}
```

A passing run has all four voice dimensions `ok`, `claims_total === claims_sourced`, and `violations: []`. Any deviation moves the run to `propose` or `failed` per workflow step 5.
