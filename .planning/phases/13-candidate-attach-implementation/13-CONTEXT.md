# Phase 13 — Candidate ATTACH Implementation (5 of 8) — AgentOS

**Triggered by:** Phase 11 decisions (`11-03-DECISIONS.md`)
**Status:** proposed
**Gated on:** Phase 12 completion (regression tests in place before fanning out skill bundle changes)

## Goal

Move 5 of the 8 Phase 11 quarantined skill candidates from `agents/_candidates/` into the live AgentOS skills bundle and wire each to the operator-selected agents. The remaining 3 candidates stay parked:
- `verification-before-completion-v2`, `clarify-before-acting-v2` — existing coverage already shipped in optimization audit Tier 1
- `secret-scan-veto` — no AgentOS code-writing target exists (cliently.dev is out of AgentOS scope)

## Scope-fence

**WRITE allowed:**
- `external/acqu-skills/<skill>/SKILL.md` (5 new skill files reauthored from candidates — NO verbatim copy from quarantine)
- `scripts/seed/<agent>.ts` for the target AgentOS agents (skill bundle additions only — no tool/autonomy/model changes)
- `packages/core/src/architect/__tests__/` or sibling files for skill-binding contract tests

**WRITE forbidden:**
- `_candidates/` retains the 8 skill files unchanged (audit trail)
- T-critical / CANT_FAIL_KEYS agents' tool or skill bundles (CANT_FAIL_KEYS gate — verified by Phase 12's immutability test)
- Any cliently.dev work (out of AgentOS scope)

## Five ATTACH operations

| Skill | Target AgentOS agents | Type |
|---|---|---|
| `prompt-injection-guardrail` | all AgentOS agents with `tool.browser` or `tool.connector.*` in bundle (full list resolved at plan time from `scripts/seed/`) | safety |
| `output-quality-gate` | `creative-studio`, `client-comms`, `weekly-report`, `content-engine` | quality |
| `shadow-mode-discipline` | all AgentOS `autonomy: propose` agents (full list resolved at plan time) | autonomy |
| `cost-ceiling-discipline` | all non-T-critical AgentOS agents | budget |
| `scope-lock-discipline` | `ad-ops`, `launcher`, `content-engine` | discipline |

## License + reauthor

All 5 skill files are reauthored from the quarantined candidates. NO verbatim copy. Each new SKILL.md is a fresh expression of the same idea using the existing skill template from `external/acqu-skills/<existing>/SKILL.md`. A Phase 13 verify gate runs the same 8-word shingle check from Phase 11 against the quarantine sources to confirm no copy bleed.

## Out of scope

- 3 KEEP-FOR-LATER candidates (`verification-before-completion-v2`, `clarify-before-acting-v2`, `secret-scan-veto`)
- cliently.dev anything (Cliently product track owns it)
- Stagehand backend for tool.browser (Tier 2 backlog)
- Reserve/commit budget pattern beyond what `cost-ceiling-discipline` documents (Tier 2)

## Acceptance

- 5 new SKILL.md files exist in `external/acqu-skills/`
- All target seed scripts include the new skill in their bundle
- Shingle check passes against quarantine sources (no verbatim copy)
- Existing agent contracts unchanged (no tool removals, no autonomy changes)
- A re-seed dry-run shows skill bundle deltas only
- No T-critical agent's skill bundle is touched
