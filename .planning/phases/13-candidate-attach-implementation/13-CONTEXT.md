# Phase 13 — Candidate ATTACH Implementation (6 of 8)

**Triggered by:** Phase 11 decisions (`11-03-DECISIONS.md`)
**Status:** proposed
**Gated on:** Phase 12 completion (cliently.dev must be T-critical before `secret-scan-veto` attaches as advisory)

## Goal

Move 6 of the 8 Phase 11 quarantined skill candidates from `agents/_candidates/` into the live skills bundle and wire each to the operator-selected agents. The remaining 2 candidates (`verification-before-completion-v2`, `clarify-before-acting-v2`) stay parked.

## Scope-fence

**WRITE allowed:**
- `external/acqu-skills/<skill>/SKILL.md` (6 new skill files reauthored from candidates — NO verbatim copy from quarantine)
- `scripts/seed/<agent>.ts` for the 16 target agents listed below (skill bundle additions only)
- Tests under `packages/core/src/architect/__tests__/` to assert skill-binding contracts

**WRITE forbidden:**
- `_candidates/` retains the 8 skill files unchanged (audit trail)
- T-critical agents' tool/skill bundles (CANT_FAIL_KEYS gate)

## Six ATTACH operations

| Skill | Target agents | Type |
|---|---|---|
| `prompt-injection-guardrail` | all agents with `tool.browser` or `tool.connector.*` in bundle (estimated 18 agents — full list resolved at plan time) | safety |
| `output-quality-gate` | `creative-studio`, `client-comms`, `weekly-report`, `content-engine` | quality |
| `shadow-mode-discipline` | all `autonomy: propose` agents (estimated 38 agents — full list resolved at plan time) | autonomy |
| `cost-ceiling-discipline` | all non-T-critical agents (estimated 42 agents) | budget |
| `scope-lock-discipline` | `ad-ops`, `launcher`, `content-engine` | discipline |
| `secret-scan-veto` | `cliently.dev` (advisory; defense-in-depth on top of Phase 12's T-critical Opus floor) | security |

## License + reauthor

All 6 skill files are reauthored from the quarantined candidates. NO verbatim copy. Each new SKILL.md is a fresh expression of the same idea using the existing skill template from `external/acqu-skills/<existing>/SKILL.md`. A Phase 13 verify gate runs the same 8-word shingle check from Phase 11 against the quarantine sources to confirm no copy bleed.

## Out of scope

- 2 KEEP-FOR-LATER candidates (`verification-before-completion-v2`, `clarify-before-acting-v2`)
- Stagehand backend for tool.browser (Tier 2 backlog)
- Reserve/commit budget pattern beyond what `cost-ceiling-discipline` documents (Tier 2)

## Acceptance

- 6 new SKILL.md files exist in `external/acqu-skills/`
- All 16 (or whatever the resolved set is) seed scripts include the new skill in their bundle
- Shingle check passes against quarantine sources (no verbatim copy)
- Existing agent contracts unchanged (no tool removals, no autonomy changes)
- A re-seed dry-run shows skill bundle deltas only
