# Phase 11: External runtime optimization — Context

**Gathered:** 2026-06-02
**Status:** Ready for planning
**Source:** Operator direction + read-only survey of `/tmp/ref/agentic-templates-restructure-v2-stack-alignment` (chmod a-w)

<domain>
## Phase Boundary

Distill value from the external `wifiwave/agentic-templates-restructure-v2-stack-alignment` runtime repo into:
1. Two reconciliation forks documented + recommended (operator's call to resolve)
2. A three-column audit of what we have / what to adopt / what conflicts
3. Eight quarantined skill candidates re-authored to OUR canonical anatomy + Relay schema (NOT copied)

**OUT OF SCOPE** for this phase:
- ANY live-fleet changes (no `scripts/seed/acqu-*.ts` edits, no `external/acqu-skills/` swaps, no `CLAUDE.md` or AGENT-OS/AGENTS/GENX-PLAN.md changes)
- Merging the extraction branch
- Implementing the Hermes-fork resolution (operator decides; subsequent phase implements)
- Implementing the CRA blocklist / agent-evaluator scorecard / reserve-commit budget (Tier 2 backlog from OPTIMIZATION-AUDIT)
- Live operator gates 1-3 (`supabase db push`, `pnpm seed:phase-9`, `pnpm verify:isolation-live`)
- Touching any repo other than `acquire-inc/agent-os` (no `git remote add`, no clone)

</domain>

<decisions>
## Implementation Decisions (locked from operator direction)

### Write boundary
- ONLY writable repo: `acquire-inc/agent-os` (this session's connected repo)
- External repo at `/tmp/ref/` stays chmod a-w throughout the phase
- No `git remote add`, no `git clone`, no push to non-`bunn-os/agent-os`

### Licensing posture
- The external repo has NO LICENSE file → all rights reserved by default
- Every extracted artifact MUST be **re-authored** as a Cliently-native version
- Provenance tags on every quarantined SKILL.md: `source_path`, `license: NONE (all-rights-reserved — reauthored, never copied)`

### Hermes fork — RESOLVED by the runtime's own `config.yaml`
The runtime documents verbatim:
> "Nous' OWN docs say their Hermes-4-70b/405b are chat/reasoning-tuned, NOT tool-call-tuned, and 'will struggle with multi-step agent loops'. Nous recommends Claude (sonnet-4.6 general / opus heavyweight) to RUN the Hermes agent framework."

- "Hermes" = NousResearch's RUNTIME (their framework), not their model family
- The runtime runs on Opus 4.8 (model AND judge)
- Our `DEFAULT_TIER_MODELS["T-reason"].primary = "nousresearch/hermes-4-405b"` is using Hermes for EXACTLY the case Nous says NOT to use it for
- **Recommended path** (operator's call): **Path B** — keep our Anthropic Agent SDK runner; port gates/skills/KB; demote Hermes-4-* from `DEFAULT_TIER_MODELS` to optional-fallback-only
- T-critical → Opus 4.8 floor is correct under both Path A and Path B (no safety impact either way)
- **Decision deferred** to operator review of `EXTERNAL-RUNTIME-RECONCILIATION.md` — this phase does NOT propagate the fix

### Isolation fork
- Their model: per-client VPS + per-client Supabase (physical isolation)
- Our model: single Supabase + `tenant_id` RLS via `is_tenant_member()` + 32-vector attack registry
- **Recommended** (operator's call): keep ours; ripping out cross-tenant aggregation would unwind the moat thesis
- **Decision deferred** to operator review

### Quarantined extraction scope — 8 candidates
On branch `feat/external-skills-extraction`, under `agents/_candidates/<slug>/SKILL.md`:

| Slug | Source path | Why | Maps in our stack |
|---|---|---|---|
| `verification-before-completion-v2` | `hermes-runtime/skills/agentic/gate-completion-claim-audit/SKILL.md` | Full doctrine vs our 90-line stub (visual-evidence gate, contract-not-transcript re-derivation, fresh-eyes loop) | Replaces our session-shipped stub when operator approves the swap |
| `clarify-before-acting-v2` | `hermes-runtime/skills/agentic/understand-the-client/SKILL.md` + `agentic_build/interrogator.py` | 6-step procedure with mirror-back artifact contract | Replaces our 1-line stub when approved |
| `prompt-injection-guardrail` | `gate-platform-access-ladder` + `B3` from `SELF_IMPROVEMENT_AND_GATES_SPEC.md` | NEW gap in our doctrine | Attaches to `tool.browser`-using agents post-Stagehand |
| `output-quality-gate` | `B1` spec + `hermes-runtime/skills/agentic/voice-and-brand/SKILL.md` | Voice rules + brand-safety before client-facing | Attaches to creative-studio, client-comms, weekly-report, content-engine |
| `shadow-mode-discipline` | `gate-never-send-without-approval` + `A1` shadow-dataset spec | Approval-rail decisions become labeled eval rows | Surfaces our existing approvals workflow as canonical |
| `cost-ceiling-discipline` | `gate-cost-ceiling` SKILL.md | Per-run + per-build ceiling pattern | Extends our `budgetCapUsd` with the reserve/commit shape |
| `scope-lock-discipline` | `gate-scope-lock` SKILL.md | SCOPE.md as operator-owned contract | Attaches to ad-ops, launcher, content-engine |
| `secret-scan-veto` | `gate-security-auditor-veto` + `gate-never-inject-client-keys` | Pre-deploy secret-scan veto | Attaches to cliently.dev / code-writing agents (NOT T-critical, attached only as advisory) |

### T-critical exclusion (hard rule)
- NO candidate attaches to a T-critical / can't-fail agent in this phase
- `CANT_FAIL_KEYS` set in `packages/core/src/architect/hydrate.ts` untouched
- Architect's refusal-to-assemble protection unchanged
- Model Router T-critical Opus pin unchanged
- Runner SessionStart `cantfail.model_violation` assertion unchanged

### Survey data already gathered (skipping researcher)
The survey of `/tmp/ref` produced enough context to skip the gsd-phase-researcher spawn:
- 667 files in scope after hard-exclude filter (1474 total; 807 excluded)
- All high-value dirs present: `hermes-runtime/`, `agentic_build/`, `internal-services/`, `templates/agent-sdk-base/`, `knowledge-base/`, `managed-agents-registry.json`, `schemas/`, `.planning/`
- `hermes-runtime/plugins/agentic_gates/__init__.py` confirmed NO secrets (regex pattern banks + safe defaults only)
- LICENSE: NONE (all rights reserved → re-author rule)
- 20 SKILL.md files under `hermes-runtime/skills/agentic/`
- 6 self-improvement source files: `output_quality_auditor.py` + 6 rubrics, `retro_runner.py`, `retrospective.py`, `critique.ts`, `learning.ts`
- 8 hard gates as `agentic_gates/__init__.py` regex pattern banks
- SOUL.md + AGENTS.md + SELF_IMPROVEMENT_AND_GATES_SPEC.md as the doctrine layer

</decisions>

<canonical_refs>
## Canonical References

Downstream agents MUST read these before planning or implementing.

### Our existing planning corpus
- `docs/plans/AGENT-OS-PLAN.md` — Relay schema §8, Open Q #1 RESOLVED, the 3 new sections (Execution Plane, Self-Improvement Loop, Multi-Dataset Data Moat) referenced by the audit
- `docs/plans/AGENTS-PLAN.md` — canonical agent anatomy + per-agent Relay emission contract (the audit's column-(a) refs map here)
- `docs/plans/GENX-PLAN.md` — CRA blocklist mechanism, free-tier launch-gate predicates
- `docs/plans/OPTIMIZATION-AUDIT.md` — Tier 1 closed last commit, Tier 2 backlog (this phase advances Tier 2 indirectly by sourcing the agent-evaluator scorecard pattern)

### External (read-only at `/tmp/ref/agentic-templates-restructure-v2-stack-alignment/`)
- `hermes-runtime/SOUL.md` — runtime identity layer
- `hermes-runtime/AGENTS.md` — project + business facts
- `hermes-runtime/config.yaml` — the Hermes runtime-vs-model resolution evidence
- `hermes-runtime/SELF_IMPROVEMENT_AND_GATES_SPEC.md` — A1-A5 + B1-B5 build order for the self-improvement loop
- `hermes-runtime/plugins/agentic_gates/__init__.py` — 8-gate regex pattern banks
- `hermes-runtime/skills/agentic/*/SKILL.md` — 20 doctrine skills (the candidate source material)
- `agentic_build/output_quality_auditor.py` + `rubrics/` — output-quality scorecard rubric structure
- `templates/agent-sdk-base/src/{critique,learning}.ts` — pure-functional self-improvement L2 pattern
- `internal-services/retrospective/` — retrospective service shape

</canonical_refs>

<specifics>
## Specific Ideas

### The 8-gate regex pattern banks (audit column-b adoption candidate)
From `hermes-runtime/plugins/agentic_gates/__init__.py`:
- `SEND_CLASS` — `send|reply|outreach|outbound|email|sms|dm|message|notify|mail|post_message|whatsapp|telegram_send`
- `FILE_MUTATION` — `write|edit|create|append|delete|remove|move|rename|mkdir|put_file|fs_write|patch|apply`
- Safe defaults: `AGENT_SHADOW_MODE="true"`, `AGENT_SEND_PER_RUN_CAP="1"`, `AGENT_RUN_BUDGET_USD="5.00"`, `AGENT_MAX_TOOL_CALLS="400"`

Maps to our `apps/runner/src/hooks.ts` `buildPreToolUseHook`. Adoption would augment our autonomy gate with defense-in-depth pattern banks.

### Self-improvement loop architecture (audit column-b cross-ref to AGENT-OS-PLAN §A2)
A1-A5 build order from the runtime spec:
- A1 shadow-mode → labeled eval dataset (free golden set from approval-rail decisions)
- A2 eval-gate = 9th non-bypassable pre_tool_call hook (write-protected rubric, Opus-judged baseline-or-better refuse-to-write)
- A3 Reflexion retry loop (2-4 sentence verbal reflection on failure, stored to episodic memory, retry with reflection prepended; bounded 2-3)
- A4 judge-calibration loop (diff Opus-judge verdicts against operator decisions to detect drift; sample 1-2% for human calibration)
- A5 cron + heartbeat cadence (offline eval on every change, daily online rollup, weekly full benchmark)

Cross-references our Tier 2 `agent-evaluator scorecard implementation` gap from OPTIMIZATION-AUDIT.md.

### Quarantine path
`agents/_candidates/` does NOT yet exist in the repo. Phase 11 creates it on the `feat/external-skills-extraction` branch as the quarantine boundary. The directory's visual separation from `external/acqu-skills/` is the whole point — operators see live skills in one tree, candidates in another.

### Branch state
Currently on `claude/exciting-davinci-yvptm`. The extraction work happens on a NEW branch `feat/external-skills-extraction` cut from current HEAD. The 3 planning docs (RECONCILIATION, AUDIT, EXTRACTION REPORT) land on `claude/exciting-davinci-yvptm` directly (they're documentation, not code).

</specifics>

<deferred>
## Deferred Ideas (do NOT implement in this phase)

- Hermes-fork resolution implementation (Path B propagation to `CLAUDE.md` + `Model Router` `DEFAULT_TIER_MODELS` + AGENT-OS-PLAN Open Q #1) — operator decides first
- Swapping any session-shipped stub skill (`verification-before-completion`, `clarify-before-acting`) for its `_candidates/*-v2` version — operator approves the swap as a separate step
- Wiring any quarantined candidate to an agent (NO `skills[]` array edits, NO seed-script changes)
- Implementing the 8-gate regex pattern banks in our `PreToolUse` hook — Tier 2 / future phase work
- Implementing the agent-evaluator scorecard (A1-A5 above) — Tier 2 / future phase
- Reading or extracting anything from the hard-exclude paths (`website-factory/runs/**`, `**/dist/**`, `**/*_business.config.json`, `**/leads.json`, `**/factory_output.csv`, `knowledge-base/customers/**`, `*william_morgan*`)
- Touching any non-`bunn-os/agent-os` repo

</deferred>

<scope_fence>
## Scope Fence (hard refusals)

This phase REFUSES to:
- Modify `scripts/seed/acqu-*.ts`
- Modify `external/acqu-skills/*/SKILL.md`
- Modify `CLAUDE.md` or the 3 plans (`AGENT-OS-PLAN.md`, `AGENTS-PLAN.md`, `GENX-PLAN.md`)
- Modify `packages/core/src/router/tier-models.ts` (the Hermes-fork resolution lives downstream)
- Modify `packages/core/src/architect/hydrate.ts` `CANT_FAIL_KEYS` (T-critical exclusion is hard)
- Attach any candidate to a T-critical agent
- Merge `feat/external-skills-extraction` into any other branch
- Clone, remote-add, or push to any non-`bunn-os/agent-os` repo
- Run operator gates 1-3 (`supabase db push`, `pnpm seed:phase-9`, `pnpm verify:isolation-live`)
- Implement the Hermes-fork resolution before operator review of `EXTERNAL-RUNTIME-RECONCILIATION.md`

</scope_fence>

---

*Phase: 11-external-runtime-optimization*
*Context gathered: 2026-06-02 via inline survey (gsd-sdk unavailable in sandbox; researcher skipped — context already complete from prior turn's read-only survey)*
