---
name: scope-lock-discipline
description: Use before generating any multi-step plan or invoking any build skill. SCOPE.md is the operator-owned engagement contract; the planner reads it on every turn, refuses items on the exclusion list, surfaces ambiguous expansions to the operator rather than absorbing them, and never edits the contract without recorded approval.
---
# SKILL: Scope-Lock Discipline

The doctrine layer that treats each engagement's `SCOPE.md` as the planner's contract — the authoritative source the agent plans against on every turn, not the intake notes, not the kickoff call recollection, not the agent's prior memory of the engagement. The skill exists because two very different scopes can look identical from the symptom list alone, and the planner reading raw intake will tend to choose the more impressive interpretation. The contract removes the ambiguity by enumerating the work, the exclusions, the completion criteria, and what the operator considers scope creep.

Attaches (after operator approval) to ad-ops, launcher, content-engine, creative-studio, and any class that generates a multi-step plan from intake. Not attached to T-critical agents per the Phase 11 scope-fence.

## Purpose

Silent scope drift — the failure mode where the build slowly expands past the agreement, the cost ceiling absorbs the overage, and the operator only discovers the divergence at delivery — is the structural failure this skill prevents. The mechanism is three-fold: the contract is read on every plan-generation turn (not from memory); every plan step traces to a contract bullet (no traceless steps); every apparent expansion surfaces to the operator as an explicit decision, never an inferred one.

For Acqu / Cliently, the engagement's `SCOPE.md` lives in `knowledge_chunks` keyed by `engagement_id`. The architect's system-prompt assembly fetches the relevant slice and injects it into every plan-generation context, so the planner reads the contract on each turn structurally rather than from recall.

## Workflow

1. **Fetch SCOPE.md before any plan-generation step.** Pull the engagement's `SCOPE.md` via `knowledge.retrieved` with filter `engagement_id` + `doc_type=scope`. The contract has four required sections; the skill refuses to proceed if any are missing:
   - "What we ARE doing" — the enumerated in-scope deliverables
   - "What we are NOT doing (v1)" — the explicit exclusion list, item-by-item
   - "How we'll know we're done" — the testable completion criteria
   - "What constitutes scope creep" — the operator's standing definition for this engagement
   A missing `SCOPE.md` halts the planner; the resolution is `approval.requested` with options to (a) seed the contract from the mirror-back artifact produced by `clarify-before-acting-v2`, or (b) abort planning until the operator authors it directly.

2. **Generate the plan with every step tagged to an in-scope item.** The plan's structured output carries a `scope_trace` map: each plan step ID points to the in-scope item ID it serves. Steps that cannot be traced go into a parallel `untraced_steps` collection and surface to the operator BEFORE the plan is committed — not after. The operator decides whether to add the work to the contract or drop the step.

3. **Match each plan step against the exclusion list.** A plan step that satisfies any item on "What we are NOT doing (v1)" is refused at generation time. The runner emits `autonomy.denied` with `rationale = "scope-lock: exclusion match on bullet <id>"` and the step is removed. If removing the step renders the plan incoherent (the step was load-bearing for downstream items), the whole plan escalates rather than ship a half-plan.

4. **Treat apparent expansions as explicit decisions.** Two readings of an intake request — a narrow reading that fits the contract and a wider reading that does not — is the canonical ambiguity case. The wider reading is never chosen by inference; the planner emits `approval.requested` with the two readings as the options. The shorter version of the principle: when the wording could mean either of two scopes, that ambiguity is the work-product, not the obstacle. Surfacing the choice is the discipline; absorbing it is the failure that produces over-built deliverables and surprised operators at delivery.

5. **Refuse to mutate the contract itself.** Any plan step that would write `SCOPE.md`, even by appending, is denied at the autonomy gate. The contract is operator-owned; the only path to amend is an out-of-band approval workflow the operator initiates. An agent that tries to edit the contract to accommodate a new request is gaming the discipline — the operator must approve the amendment, then the new contract drives the next plan.

6. **Confine file mutations to the engagement directory.** For agents that mutate code, content, or configuration, the engagement's working directory is the file-level expression of scope. Mutations targeting paths outside it are refused at the tool layer (the runner's file-mutation tools enforce the boundary); the skill teaches the discipline so the planner does not even propose them. The exception is the operator-owned shared knowledge directory, which is symlinked into engagements as read-mostly with a documented write carve-out for the post-engagement retrospective.

## Rules

- **Plan from the contract on every turn, not from memory.** The architect injects the contract on each plan-generation context; the planner reads it each time. Recall is unreliable; the structural injection is the discipline.
- **A traceless plan step is a contract drift signal, not a permissible addition.** Untraced steps surface before the plan is committed; the operator authorizes or removes.
- **Exclusion-list matches deny at generation, not at execution.** A plan step that satisfies an exclusion bullet is not "generated and then refused later" — it is not generated. Late refusal wastes budget and operator attention.
- **Identical symptom descriptions can describe very different scopes.** A patch and a rebuild can both satisfy a defect complaint; the contract is what distinguishes them. When the intake leaves the choice open, the planner asks; it does not infer.
- **The contract is operator-owned, write-protected from agent edits.** Any agent attempt to mutate `SCOPE.md` is a Rule-2 critical finding; the operator amends via the explicit workflow, the runtime never auto-edits.
- **Exclusions are refusals, not deferrals.** An item on "What we are NOT doing" is not a hidden backlog item; the engagement is not doing it. A later engagement can scope it in.
- **Repo confinement is scope at the file level.** A write to a path outside the engagement directory is, by definition, outside the engagement's scope. The tool layer enforces; the skill teaches.
- **Every untraced step or exclusion match produces an audit-trail finding.** The operator sees the pattern in the findings inbox; a recurring class of drift is a signal that either the contract needs sharpening or the agent's planning approach needs evaluation.

## Output contract

The agent's `run_summaries.highlights` carries:

```json
{
  "scope_lock": {
    "scope_path": "kb:engagements/<engagement_id>/SCOPE.md",
    "scope_trace": [
      { "plan_step_id": "<id>", "scope_bullet_id": "<id>", "bullet_text": "<verbatim>" }
    ],
    "untraced_steps": [
      { "plan_step_id": "<id>", "resolution": "added_to_contract | dropped | escalated" }
    ],
    "exclusion_matches": [
      { "plan_step_id": "<id>", "exclusion_bullet_id": "<id>", "resolution": "removed | escalated" }
    ],
    "contract_write_attempts": 0
  }
}
```

Relay events:
- `knowledge.retrieved` on the SCOPE.md fetch
- `autonomy.denied` on every exclusion-list match (`rationale = "scope-lock: exclusion match"`)
- `autonomy.denied` on every contract-write attempt (`rationale = "scope-lock: SCOPE.md is operator-owned"`)
- `approval.requested` on every two-reading ambiguity, with the readings as options
- `approval.resolved` once the operator decides
- `finding.recorded` (category=`anomaly`, severity=`medium`, title=`"scope expansion attempted: <step_summary>"`) for each untraced step
- `finding.recorded` (category=`anomaly`, severity=`high`, title=`"contract write attempted by agent"`) for any `SCOPE.md` mutation attempt
- `run.escalated` if the plan cannot be completed inside the contract without operator amendment

The `summary_text` field: `"Scope-lock: <traced> steps traced to <bullets>; <untraced> untraced; <exclusions> exclusion denials; contract write attempts=<count>."`

For a missing-contract halt: `"Scope-lock: SCOPE.md missing for engagement <id>; planner halted, escalated."`

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_path: hermes-runtime/skills/agentic/gate-scope-lock/SKILL.md
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the four-section contract structure, the read-before-planning rule, the exclusion-list-is-refusal-not-deferral rule, the operator-owned-and-write-protected posture for SCOPE.md, the surface-don't-absorb framing on ambiguous expansions, and the file-level repo-confinement extension from the source. Re-authored every sentence in our voice; the trace-map representation in the highlights jsonb is OUR framing (the source uses prose attribution). Mapped onto our existing surfaces — `knowledge_chunks` for engagement contract retrieval, the architect's system-prompt assembly for per-turn injection (analogous to the source's UserPromptSubmit hook), the runner's autonomy gate for denial events, and Relay events from the closed 28-event namespace (`knowledge.retrieved`, `autonomy.denied`, `approval.requested`, `approval.resolved`, `finding.recorded`, `run.escalated`). Source's substrate-specific machinery (`UserPromptSubmit` cat-SCOPE-into-prompt hook, the `confine-client-session.sh` PreToolUse hook, `$CLAUDE_PROJECT_DIR` env-var path semantics, the abspath-not-realpath symlink carve-out detail) was left out — our substrate is the architect plus the tool layer, not theirs.
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
