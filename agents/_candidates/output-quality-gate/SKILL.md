---
name: output-quality-gate
description: Use before any client-facing draft leaves a creative or comms agent. Voice rules + banned-phrase scan + brand-safety + class-specific quality bar; blocks the draft and emits autonomy.denied if any check fails. Operates at the per-draft layer, not the per-build layer.
---
# SKILL: Output Quality Gate

A pre-send / pre-publish gate that runs on the OUTPUT side of any client-facing draft: cold emails, sales sequences, deck text, proposal language, status updates, ad copy, content posts. The skill is the doctrine; a paired runtime hook in `apps/runner/src/hooks.ts` enforces the same check mechanically (see §B1 of the self-improvement spec for the eval-gate framing). Distinct from per-build verification — this fires on every draft, not at the build's terminal status.

Attached (when operator approves) to creative-studio, client-comms, weekly-report, content-engine, and the outreach-class agents. NOT attached to T-critical agents.

## Purpose

A reputation-damaging message that ships to a client or prospect costs more than every reasoning win above it. The output-quality gate is the structural check that stops a draft BEFORE it reaches the approvals rail with voice slop, banned phrases, brand discipline violations, or class-specific quality failures. The cost shape is asymmetric: a draft blocked at this gate costs a few cents to regenerate; a draft that lands in front of a client with "let's dive in" or an em-dash burns trust that the cost ceiling does not measure.

The gate is not a substitute for the approvals rail — every client-facing send still requires human approval per the shadow-mode discipline. The gate is the layer BEFORE the rail, designed to catch failures the operator should never have to see.

## Workflow

1. **Load the class-specific voice profile.** Voice rules are not global; they are per-tenant per-agent-class. The voice profile lives in the tenant's `knowledge_scope` as `voice-profile-<agent_class>.md` (e.g., `voice-profile-client-comms.md`, `voice-profile-content-engine.md`). The gate reads the profile via `knowledge.retrieved` before scoring the draft. If no profile exists for the class, that itself is a finding (severity=low) and the gate falls back to the tenant's default profile.

2. **Run the banned-phrase scan.** A draft is rejected if it contains any of the verbatim banned strings, OR a paraphrase of them in the same slop register. The default bank (carried per tenant; extensible):
   - `delve into` / `let's delve` / `let us delve`
   - `in today's fast-paced world` / `in this dynamic landscape`
   - `I hope this helps` / `I hope this finds you well`
   - `let's dive in` / `let us jump in` / `let's unpack`
   - `elevate your` / `unlock the potential`
   - `robust solution` / `comprehensive suite`
   - `leverage` (verb sense — banned as noun-creep too)
   - `seamless` / `seamlessly`
   - `synergy` / `synergies`
   - `cutting-edge` / `next-level`
   The bank is operator-owned per tenant; the gate's job is to apply it, not to argue with it.

3. **Run the em-dash check.** No em-dashes anywhere — not in client-facing copy, not in commit messages, not in code comments that will appear in client-deliverable repos. Use commas, periods, or parentheses. The rule applies to all surfaces because voice drifts across surfaces; an em-dash in a code comment teaches the model an em-dash is fine.

4. **Run the brand-discipline check.** Tenant-specific: every tenant declares the public-facing brand name and the operator-only entities (legal entity name, internal codename) in their knowledge scope. The gate flags drafts that lead with an operator-only entity in a public-facing surface. For Acqu / Cliently specifically: the public-facing brand is the tenant's brand, never our own; a draft from a client-comms agent that names "Cliently" in the body to a client (rather than as a footer attribution) is a brand-discipline violation.

5. **Run the grounded-facts check.** Drafting models must use ONLY the names, numbers, and facts present in the provided context. If the draft introduces a fact not traceable to a `tool.result` event, a `knowledge.retrieved` payload, or the run's input task, that fact is flagged. The check uses an Opus-tier reviewer (T-work) to surgically identify ungrounded facts without rewriting voice; the building agent then either grounds the fact (cite the source) or removes it. Inventing a name, number, or quote that is not in the context is the failure this check exists to prevent.

6. **Run the class-specific quality bar.** Every client-facing agent class declares a quality bar in its skill set:
   - sales/outreach: lead with our results, not the prospect's research; no links in cold emails; the deck is the CTA, not a calendar link
   - content-engine: matches the tenant's published voice cadence
   - weekly-report: the three-item status format (this week / next week / blocked)
   - creative-studio: matches the ad-creative-policy skill's compliance checks (NOT the CRA blocklist — that is T-critical and out of scope here)
   The class-specific bar lives in the agent's primary skill; the gate just runs it.

7. **On any failure, BLOCK the draft and emit autonomy.denied.** The draft does not flow to the approvals rail; the agent receives the failure list and the option to regenerate. After 3 consecutive failures on the same draft, escalate (`approval.requested`) with the failure list and the option to (a) override on operator authority, (b) loosen the rule for this draft only, or (c) abort.

## Rules

- **Voice rules apply to ALL surfaces.** Em-dashes in code comments are still em-dashes; a banned phrase in a commit message is still a banned phrase. The rule is the discipline, not the surface.
- **The bank is operator-owned per tenant.** The gate's job is to apply it. An agent that tries to edit the bank to make its draft pass is gaming the gate; the bank file lives under a write-protect equivalent to the eval-rubric protection (see eval-gate, Tier 2 backlog).
- **Grounded facts only.** Inventing a name, number, or quote is the highest-cost failure on this gate — it is what turns "the agent wrote a confident-sounding email" into "the agent lied to the client."
- **The gate runs at draft time, not at send time.** Catching slop the moment it is generated is cheaper than catching it on the approvals rail (where the operator has to review and reject). The shadow-mode discipline still owns the send gate; this skill owns the draft gate.
- **A blocked draft is not a failed run.** The agent regenerates; only after 3 consecutive blocks does the run escalate. The cost ceiling and per-run cap still bound the retry loop.
- **No tenant-blind defaults.** The banned-phrase bank, the brand-discipline rules, the class-specific bar all read from the tenant's knowledge scope; a tenant that has not declared their voice profile gets a low-severity finding and falls back to defaults.
- **Class is per-agent-class, not per-agent.** All client-comms agents in a tenant share the client-comms voice profile; the gate does not tune per-agent.

## Output contract

The agent's `run_summaries.highlights` carries:

```json
{
  "output_quality": {
    "passed": true,
    "checks_run": ["banned_phrases", "em_dash", "brand_discipline", "grounded_facts", "class_quality_bar"],
    "blocks": [],
    "regenerations": 0,
    "voice_profile_path": "kb:<tenant>/voice-profile-<class>.md"
  }
}
```

When a check fails, `blocks` carries one entry per failure:
```json
{ "check": "banned_phrases", "matches": ["leverage", "robust solution"], "draft_id": "<id>" }
```

Relay events:
- `autonomy.denied` on every block, rationale=`"output_quality: <check>"`
- `knowledge.retrieved` for the voice profile load
- `finding.recorded` (category=`anomaly`, severity=`low`, title=`"voice profile missing for <tenant>/<class>"`) if step 1 fell back to defaults
- `approval.requested` after 3 consecutive blocks on the same draft, with options `[override, loosen-for-this-draft, abort]`
- `approval.resolved` once the operator answers
- `run.escalated` if the operator chose `abort`

The `summary_text` field carries: `"Output gate: <N> checks ran, <M> blocks across <K> regenerations; final draft passed."` For a failed run: `"Output gate: <M> blocks unresolved after 3 regenerations; escalated."`

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_paths:
  - hermes-runtime/skills/agentic/voice-and-brand/SKILL.md
  - hermes-runtime/SELF_IMPROVEMENT_AND_GATES_SPEC.md
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the banned-phrase bank shape, the em-dash rule, the brand-discipline framing, and the grounded-facts check from voice-and-brand.SKILL.md; adopted the §B1 pre-tool-call output-QA framing (block-before-the-draft-ships) from SELF_IMPROVEMENT_AND_GATES_SPEC.md. Deliberately re-cast the voice rules as PER-TENANT-PER-CLASS rather than the source's hard-coded "Agentic Solution" voice — multi-tenancy means voice is tenant-owned, not control-plane-owned. The class-specific quality bar is our framing (the source's voice doc is monolithic; our agent registry is class-bound). Relay events from the closed 28-event namespace (`autonomy.denied`, `knowledge.retrieved`, `finding.recorded`, `approval.requested`, `approval.resolved`, `run.escalated`).
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
