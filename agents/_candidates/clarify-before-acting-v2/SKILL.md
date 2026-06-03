---
name: clarify-before-acting-v2
description: Use at the start of every engagement, ahead of any planning step, to convert raw client intake into a structured restatement that the client confirms is accurate. Replaces the one-sentence stub; adds the six-step intake procedure, the bounded interrogator pattern, and the four-section restatement contract.
---
# SKILL: Clarify Before Acting (v2 — full doctrine)

The v2 candidate that replaces the one-line `clarify-before-acting` stub at `external/acqu-skills/clarify-before-acting/SKILL.md`. The stub names the discipline; this v2 supplies the structure — what to consume, in what order, how to surface gaps, and what artifact to publish before any agent moves to planning.

Attaches (after operator approval) to intake, sales, client-comms, contract-drafter, and creative-studio classes. The 1-line stub stays in place until the operator approves the swap as a separate step.

## Purpose

A client engagement that begins with a half-read intake produces a build that solves the wrong problem at the right price. The cost is asymmetric: the build's per-run cap absorbs the model spend, but the client-relationship damage from a deliverable that misses the point is not metered anywhere. This skill is the structural answer — a six-step intake routine that ends in a structured restatement (the mirror-back artifact) the client signs off on before any planning fires. The agent's job is to convert the client's described solution into the client's underlying business problem, and to publish the conversion so the client can correct it.

The iron rule sits underneath: when an intake is ambiguous, resolve it from context or ask, never round to the larger interpretation. The cautionary tale across the field is the request whose literal wording fits two scopes ("fix the cart bugs" → a one-line patch OR a checkout rewrite); the symptoms read identically, the scopes differ by 10x. Surfacing the ambiguity is the work; absorbing it is the failure.

## Workflow

1. **Inventory every intake artifact, refuse to plan from a subset.** Pull every artifact that arrived with this engagement from `knowledge_chunks` filtered by `engagement_id`: the intake questionnaire, the discovery-call notes, every meeting recording or screen-share Loom, the email thread, every doc the client attached, every Slack message in the shared channel. Cross-check the count against the operator's intake checklist. If an artifact is referenced in the questionnaire but is not in `knowledge_chunks` (a recording link that 404s, an attachment that did not parse), HALT — emit `approval.requested` with the missing-artifact list, not `run.escalated`, because the operator can fetch the file faster than the agent can guess around it.

2. **Watch every recording end-to-end before scoring any extraction.** Transcripts strip out the texture that carries intent — the moment the client paused to find the right word, the topic they returned to twice, the request they dismissed with a wave, the metric they cited twice in five minutes. Use the watch-recording tool for video; for audio-only, the human-in-the-loop fallback runs through the operator. Recordings that fail playback are open questions, not skipped inputs. A claim that intake is complete with a recording marked "could not access" is a verification failure for this skill.

3. **Convert each requested feature into its underlying business outcome.** The intake will name features ("build a dashboard," "send a weekly digest"); the agent's job is to translate each into the business outcome the feature is in service of. The translation procedure: pull the client's own metric ("five hours of manual checking per week"), the audience the metric is for ("the COO asks at every Monday review"), and the decision the metric enables ("whether to renew our quota with the supplier"). The triplet — metric, audience, decision — is the outcome. A feature with no triplet is not yet understood. Capture the triplets in the restatement artifact; downstream agents read them to design the build.

4. **Profile the client's operating context.** Their vertical's norms, the language their customers use, the visual register their competitors operate in, the regulatory or contractual constraints invisible to outsiders. Pull the matching `voice_profile` row from the tenant's knowledge scope by `vertical` + `audience_class`; the row carries the standing expectations for what a competent operator in this vertical would assume. Missing profile is a low-severity finding plus an open question, not a halt — the engagement can proceed with the profile as TBD if the operator chooses.

5. **Catalog every ambiguity, then resolve or escalate.** Walk the intake top-to-bottom and list every place where two readings are possible AND every place a required input is absent. For each entry: name both readings (or "no reading possible without input X"); cite the source sentence or timestamp; mark it RESOLVED-from-context (with the resolving evidence) or PENDING. Then run the interrogator pattern over the PENDING set:
   - Round 1 always runs. Send up to four multiple-choice questions to the operator (the AskUserQuestion ceiling), each with 2-4 options plus an explicit "do nothing / out of scope" option.
   - Round 2 fires only if Round 1's answers introduced new gaps, or if open ambiguities remain.
   - After Round 2, no further rounds. Remaining unresolved items become `approval.requested` rows on the inbox, blocking planning until the operator decides.

6. **Publish the mirror-back artifact for client confirmation.** Write `kb:engagements/<engagement_id>/understanding.md` with four ordered sections:
   - "Here is exactly what I understood you want" — the outcome triplets from step 3, in the client's own metrics
   - "Here is what done looks like" — testable success criteria, each one footnoted to the intake source that grounds it
   - "Here is what I am NOT doing" — the explicit exclusion list (this becomes the seed for SCOPE.md's "What we are NOT doing" section in the next phase)
   - "Open questions" — the items the interrogator could not resolve, presented as multiple-choice for the client (not free-text prompts)
   For retainer work, the operator routes the artifact to the client; the engagement does not advance to planning until the client confirms. The artifact then becomes a `knowledge_chunks` entry that every downstream agent reads via `knowledge.retrieved` when scoping its own work.

## Rules

- **Ambiguity is a signal to surface, not a signal to round up.** Two readings means ask; one reading you derived means cite the derivation. The pattern that goes wrong is the planner picking the more impressive reading and starting work.
- **Watching the recording is not optional when one exists.** Reading the transcript while skipping the video is the most common comprehension failure on retainer engagements. If the recording cannot play, the agent stops; the operator either repairs the link or the engagement runs with the gap marked.
- **Features are inputs; outcomes are the deliverable target.** A skill output that just restates the feature list as the outcome list has skipped step 3. Each line in "Here is exactly what I understood you want" carries the metric+audience+decision triplet, not the feature name.
- **The mirror-back is the gate, not a status update.** No agent plans against intake until the artifact is published; for retainer work, no agent plans until the client confirms. Planning before the artifact lands is the trapdoor that ships wrong-target builds.
- **Two rounds of clarifying questions is the cap.** Three rounds signals the gap is structural — the engagement does not have enough information, the operator decides whether to gather more or descope.
- **Open questions stay open, never silently resolved.** A `PENDING` ambiguity that becomes `RESOLVED-by-inference` without a citation is a Rule-1 bug for this skill. The verification skill will catch it on the artifact.
- **The profile fallback is a finding, not an excuse.** A missing voice profile blocks nothing but surfaces a low-severity finding so the operator can backfill the registry before the next engagement in that vertical.

## Output contract

The agent's `run_summaries.highlights` carries:

```json
{
  "clarification": {
    "mirror_back_path": "kb:engagements/<engagement_id>/understanding.md",
    "outcome_triplets": [
      { "feature_requested": "<text>", "metric": "<text>", "audience": "<text>", "decision": "<text>" }
    ],
    "open_questions": [
      { "question": "<text>", "options": ["<a>", "<b>", "<c>"], "blocking": true | false }
    ],
    "rounds": 1,
    "voice_profile_resolved": true | false
  }
}
```

The `summary_text` field is one line: `"Understanding published: <N> outcome triplets, <M> open questions, <R> interrogator rounds, voice profile <resolved|TBD>."`

Relay events:
- `knowledge.retrieved` for every intake artifact read in step 1, and for the voice profile lookup in step 4
- `knowledge.written` for the `understanding.md` artifact
- `approval.requested` for the Round-1 / Round-2 interrogator batches, AND for any unresolved item after Round 2 (blocking)
- `approval.resolved` once each batch returns
- `finding.recorded` (category=`anomaly`, severity=`low`, title=`"voice profile missing for vertical=<v> audience=<a>"`) when step 4 falls back
- `run.escalated` if Round 2 ends with blocking open questions still unresolved, with `payload.reason = "clarification_unresolved"`

Downstream agents (the planner, the scope-lock skill, the verification skill) read the mirror-back artifact at the start of their own runs; the seed for SCOPE.md "What we are NOT doing" is copied verbatim from the artifact's section 3.

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_paths:
  - hermes-runtime/skills/agentic/understand-the-client/SKILL.md
  - agentic_build/interrogator.py
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the six-step intake structure, the four-section restatement artifact contract, and the "translate feature requests into business outcomes" framing from understand-the-client.SKILL.md; adopted the bounded-rounds interrogator pattern (Round-1-always-runs, Round-2-only-on-gaps, hard-stop-after-two) from interrogator.py. Re-authored every sentence in our voice with our architecture references — `knowledge_chunks` for engagement artifact retrieval, `voice_profile` rows in the tenant knowledge scope, the agent registry, and Relay events from the closed 28-event namespace. The metric/audience/decision outcome-triplet is OUR framing — the source describes outcome extraction in prose; we structure it for the run_summaries jsonb. Source's substrate-specific machinery (Python AskUserQuestion bindings, the `.planning/intake-answers.json` atomic-write path, the ASCII spec preview) was left out — our substrate is the approvals rail and the knowledge writer, not theirs.
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
