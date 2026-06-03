# SKILLS-EXTRACTION-REPORT

**Snapshot SHA**: `<commit SHA from /tmp/ref tarball — operator fills>`
License: NONE (all rights reserved by default — reauthored, never copied)
**Branch**: `feat/external-skills-extraction`
**Status**: pending operator review — DO NOT MERGE
**Phase**: 11-external-runtime-optimization
**Wave**: 2 (skills extraction)
**Snapshot date**: 2026-06-02

---

## Purpose

Phase 11 Wave 2 stages 8 re-authored SKILL.md candidates on the quarantine branch `feat/external-skills-extraction` under `agents/_candidates/<slug>/SKILL.md`. The branch is pushed to origin and is NEVER merged into `claude/exciting-davinci-yvptm`, `main`, or any other branch during this phase. The candidates are an operator-review surface; per-candidate disposition (swap, attach, defer, reject) is the operator's decision, recorded as a separate workflow.

This report cross-references each candidate against `docs/plans/EXTERNAL-TEMPLATES-AUDIT.md` column (b) (which slot in our architecture the candidate adopts) and `docs/plans/EXTERNAL-RUNTIME-RECONCILIATION.md` (the license posture and the Hermes-fork context that some candidate wording leans on).

---

## Per-candidate summary table

| Slug | What it does | Source path in `/tmp/ref/agentic-templates-restructure-v2-stack-alignment/` | Our-architecture slot | Dependencies on our stack | Recommendation |
|---|---|---|---|---|---|
| `verification-before-completion-v2` | Full doctrine for the contract-driven verification pass (replaces the 90-line session-shipped stub) | `hermes-runtime/skills/agentic/gate-completion-claim-audit/SKILL.md` | `external/acqu-skills/verification-before-completion/SKILL.md` (operator-approved swap) | `run_summaries.highlights.verification` jsonb, runner Stop hook, `knowledge_chunks` for SCOPE/ROADMAP/GOAL retrieval | KEEP, SWAP with the session stub when operator approves |
| `clarify-before-acting-v2` | Six-step intake routine + bounded-rounds interrogator + four-section mirror-back artifact (replaces the 1-line session stub) | `hermes-runtime/skills/agentic/understand-the-client/SKILL.md` + `agentic_build/interrogator.py` | `external/acqu-skills/clarify-before-acting/SKILL.md` (operator-approved swap) | `knowledge_chunks` for intake retrieval, `voice_profile` rows in tenant knowledge scope, approvals rail | KEEP, SWAP with the session stub when operator approves |
| `prompt-injection-guardrail` | NEW skill (no current peer); treats tool-returned content as data not instructions; detect-and-strip on common patterns; OWASP LLM01 framing | `hermes-runtime/skills/agentic/gate-platform-access-ladder/SKILL.md` (primary) + `hermes-runtime/SELF_IMPROVEMENT_AND_GATES_SPEC.md` §B3 (secondary) | New skill in `external/acqu-skills/` (when operator approves attachment); paired with future hook in `apps/runner/src/hooks.ts` | Pattern bank file (Tier 2 work), `run_summaries.highlights.injection_guard` jsonb, autonomy gate | KEEP, ATTACH to browser-using agents after Stagehand backend ships (Tier 2 timeline) |
| `output-quality-gate` | Pre-draft voice rules + banned-phrase scan + brand-discipline + grounded-facts + class-specific quality bar | `hermes-runtime/skills/agentic/voice-and-brand/SKILL.md` (primary) + `hermes-runtime/SELF_IMPROVEMENT_AND_GATES_SPEC.md` §B1 (secondary) | New skill in `external/acqu-skills/`; pairs with eventual hook in `apps/runner/src/hooks.ts` | Tenant `knowledge_scope` voice profiles, run_summaries.highlights jsonb, autonomy gate, approvals rail | KEEP, ATTACH to creative-studio, client-comms, weekly-report, content-engine — NOT T-critical (separate per-class operator approval) |
| `shadow-mode-discipline` | Six-stage send gate with fail-CLOSED state reads; surfaces the existing approvals workflow as canonical doctrine; feeds the Tier 2 shadow-dataset logger | `hermes-runtime/skills/agentic/gate-never-send-without-approval/SKILL.md` | `apps/runner/src/approvals/` (existing mechanism — the skill documents it); paired with future `packages/core/src/eval/shadow-dataset.ts` (Tier 2) | Existing approvals workflow, `agent_sent_log` ledger, `tier_overrides` jsonb on tenants | KEEP, SURFACE in the approvals workflow doctrine; the skill is documentation of existing structure |
| `cost-ceiling-discipline` | Per-run hard-stop + per-build re-approval ceiling; reserve/commit pattern; cost report as completion evidence | `hermes-runtime/skills/agentic/gate-cost-ceiling/SKILL.md` | `apps/runner/src/execute.ts` `budgetCapUsd` (existing) + future per-build singleton (Tier 2 reserve/commit work, `OPTIMIZATION-AUDIT.md` 2.B) | `agents.budget_cap_usd`, `runs.cost_usd`, `run_summaries.highlights.cost_report`, Model Router resolved-model field | KEEP, FEEDS the Tier 2 reserve/commit implementation phase |
| `scope-lock-discipline` | SCOPE.md as the operator-owned engagement contract; planner reads on every turn; refuses exclusion-list items; surfaces ambiguous expansions | `hermes-runtime/skills/agentic/gate-scope-lock/SKILL.md` | New skill in `external/acqu-skills/`; injection via the architect's system-prompt assembly | `knowledge_chunks` for engagement SCOPE.md retrieval, architect's prompt assembly, autonomy gate | KEEP, ATTACH to ad-ops, launcher, content-engine — NOT T-critical (separate per-class approval) |
| `secret-scan-veto` | First-in-chain verifier with non-advisory veto; cheap regex pattern bank in the hot path; pairs with never-inject discipline for per-tenant provisioning | `hermes-runtime/skills/agentic/gate-security-auditor-veto/SKILL.md` (primary) + `hermes-runtime/skills/agentic/gate-never-inject-client-keys/SKILL.md` (secondary) | New skill in `external/acqu-skills/`; pairs with future pattern bank in `packages/core/src/safety/pattern-banks.ts` (Tier 2 b.1) | Verifier dispatch order, `tenants.connector_secrets` table, future Nango integration | KEEP, ATTACH to cliently.dev as ADVISORY only; T-critical secrets-rotation NOT attached (Phase 11 scope-fence) |

Each row's source path is relative to `/tmp/ref/agentic-templates-restructure-v2-stack-alignment/` (read-only, chmod a-w throughout the phase).

---

## Per-candidate deep sections

### 1. `verification-before-completion-v2`

Replaces the session-shipped 90-line stub at `external/acqu-skills/verification-before-completion/SKILL.md`. The stub gets the three-step shape right (deliverable / numbers / linter) but does not name the three load-bearing structures that turn a one-shot check into a discipline: contract-driven criteria (the planner does not grade its own homework; the verifier reads SCOPE / ROADMAP / GOAL directly from `knowledge_chunks`), the fresh-context verifier (a separate `verifier`-typed subagent with a distinct `run_id` and no read access to the building agent's transcript), and the multi-viewport visual sweep with an explicit defect ledger for any client-facing UI. The v2 candidate brings the doctrine, the jsonb output contract that the agent-evaluator scorecard (Tier 2 backlog) will read, and the Stop-hook integration that gates the building agent's `run.completed` on `verification.passed`.

**Recommendation: KEEP, SWAP with the session stub when the operator approves.** This is the highest-leverage swap in the wave; every client-facing agent attaches the verification skill, and the stub-to-v2 swap upgrades the verification posture across the fleet in a single change. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) row b.2.

### 2. `clarify-before-acting-v2`

Replaces the one-line stub at `external/acqu-skills/clarify-before-acting/SKILL.md`. The stub is essentially a tagline ("raise one Approval before acting on an ambiguous input"); this v2 supplies the procedure — what to inventory, in what order, how to translate features into outcomes, how to profile the client's vertical, how to bound the interrogator's rounds, and what artifact to publish before any planning fires. The metric-audience-decision outcome triplet is our framing on top of the source's prose; it gives downstream agents a structured surface to design against rather than a paragraph to re-parse.

**Recommendation: KEEP, SWAP with the session stub when the operator approves.** Second-highest leverage swap; the intake-class agents (sales, client-comms, contract-drafter) all attach this skill, and the structured restatement artifact removes the largest comprehension-failure class on retainer engagements. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) row b.3.

### 3. `prompt-injection-guardrail`

A NEW skill — no current peer in `external/acqu-skills/`. Closes the OWASP LLM01 gap on every agent that reads content from outside our trust boundary: the browser-using agents post-Stagehand backend, content-engine retrievals on third-party sources, email-parsing agents, third-party API responses where the body contains user-controlled fields. The skill is the doctrine layer paired with a future hard-hook in `apps/runner/src/hooks.ts` that mechanically strips known injection patterns before the planner reads the content. Together: the skill teaches the why, the hook enforces the what.

**Recommendation: KEEP, ATTACH to browser-using agents after the Stagehand backend ships.** The attachment is gated on Tier 2 work (the Stagehand backend lands, the pattern-bank hook lands); attaching the skill earlier without the hook is partial defense and leaves the planner-context window unprotected. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) (no exact row — this is a doctrine + Tier 2 hook composite; the closest peer is b.1 pattern banks).

### 4. `output-quality-gate`

A pre-draft check that runs voice rules (em-dashes, banned phrases), brand discipline (per-tenant brand-name posture), grounded-facts validation, and class-specific quality bars before a draft reaches the approvals rail. The skill is the doctrine; the §B1 pre-tool-call hook (Tier 2) is the enforcement. Distinct from per-build verification: this fires on every draft, not at the build's terminal status. The biggest re-authoring decision: we deliberately re-cast voice rules as PER-TENANT-PER-CLASS rather than the source's hard-coded "Agentic Solution" voice. Multi-tenancy means voice is tenant-owned, not control-plane-owned.

**Recommendation: KEEP, ATTACH to creative-studio, client-comms, weekly-report, content-engine.** Not attached to T-critical agents. The per-tenant voice profile rows must exist in `knowledge_scope` before attachment; a tenant without a profile gets a low-severity finding and a fallback to defaults, but the operator should backfill the profile before relying on the gate. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) (no exact row — pairs with the Tier 2 §B1 hook).

### 5. `shadow-mode-discipline`

Documentation of the existing approvals workflow at `apps/runner/src/approvals/` as one named discipline. The six-stage gate is already structurally enforced (the autonomy tier system + the approvals inbox + the `tool.dispatched` interception); the skill makes the discipline explicit to operators reading the agent registry. The shadow-dataset row schema (every approve/edit/reject becomes a labeled row) is our §A1 framing from the self-improvement Tier 2 spec; it feeds the agent-evaluator scorecard once that work lands.

**Recommendation: KEEP, SURFACE in the existing approvals workflow as canonical doctrine.** No runtime change needed — the skill documents what is structurally true. The labeled-dataset accumulation gates on Tier 2 work (the shadow-dataset logger at `packages/core/src/eval/shadow-dataset.ts`); until that lands, the rows live in the existing `approvals` table. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) row b.4.

### 6. `cost-ceiling-discipline`

Doctrine for the existing per-run cost meter, extended with the per-build ceiling and the reserve/commit pattern that feeds Tier 2 work (`OPTIMIZATION-AUDIT.md` 2.B). The per-run hard-stop is already enforced at `apps/runner/src/execute.ts` `budgetCapUsd`; the per-build singleton + the reserve-then-commit hook lifecycle is the new shape Tier 2 will implement. The skill is documentation now; the runtime enforcement upgrades when Tier 2 lands.

**Recommendation: KEEP, FEEDS the Tier 2 reserve/commit implementation phase.** No live-fleet attachment needed in this phase — the skill is reference material for the future implementation. The pricing-constants extraction (PRICING table read from `tenants.tier_overrides.pricing_constants`) is the part operators will care about most when the Tier 2 work begins. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) (no exact row — the existing column-a coverage of cost ceiling is the per-run side; this candidate is the per-build extension).

### 7. `scope-lock-discipline`

SCOPE.md as the operator-owned engagement contract injected on every plan-generation turn. The architect's system-prompt assembly already has the structural slot for per-engagement context injection; the skill names the discipline so the planner traces every step to a contract bullet, refuses exclusion-list items, and surfaces ambiguous expansions rather than absorbing them.

**Recommendation: KEEP, ATTACH to ad-ops, launcher, content-engine.** Not attached to T-critical agents. The attachment requires each tenant to have engagement SCOPE.md files in `knowledge_chunks` keyed by `engagement_id`; without contracts, the skill halts the planner (which is the correct behavior, but the operator may want to onboard tenants with seed contracts before attachment). Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) (no exact row — closest peer is the architect injection slot from column (a)).

### 8. `secret-scan-veto`

A pre-deploy / pre-commit credential scanner that runs FIRST among verifiers with non-advisory veto. The skill carries two doctrines composed into one: the pattern-bank scan for committed credentials, and the never-substitute rule for per-tenant secret provisioning. The composition is deliberate — both are faces of the same secret-handling posture, and a tenant that has the scan but not the provisioning rule will eventually overwrite a tenant credential with a control-plane key when the tenant credential goes missing.

**Recommendation: KEEP, ATTACH to cliently.dev as ADVISORY only.** The T-critical code-writing agent reads the skill to inform planning (do not write keys to deploy envs; route via the never-inject pattern), but the runner's own T-critical paths govern the agent's tool calls. The T-critical `secrets-rotation` agent is explicitly NOT attached — rotation has its own dedicated workflow with operator-only paths, and the Phase 11 scope-fence forbids skill attachments to CANT_FAIL agents. Cross-references EXTERNAL-TEMPLATES-AUDIT.md column (b) row b.1 (the pattern-bank Tier 2 work that supplies the regex hot-path).

---

## Hard rules

- **T-critical exclusion: zero candidates attach to CANT_FAIL_KEYS agents in this phase.** Every candidate's provenance block carries `bound_to: NONE`. The CANT_FAIL set in `packages/core/src/architect/hydrate.ts` is unchanged; the Architect's refusal-to-assemble protection is unchanged; the Model Router T-critical Opus pin is unchanged; the runner's `cantfail.model_violation` assertion at SessionStart is unchanged. The `secret-scan-veto` candidate, even though it discusses `cliently.dev` and the never-inject discipline, is ADVISORY in attachment posture and never gates the T-critical agent's actions.

- **Operator approval is the ONLY path to swap a candidate with a session stub OR to attach a candidate to a live agent.** No automated rollout, no per-tenant default-on, no quiet attachment in a subsequent commit. Every swap is a recorded operator decision. Every attachment to an agent's `skills[]` array is a recorded operator decision.

- **The branch `feat/external-skills-extraction` is QUARANTINED — never merged into `claude/exciting-davinci-yvptm`, `main`, or any other branch in this phase.** Phase 11 Wave 4 (or later) is the implementation path for any approved swap or attachment; the implementation will copy approved candidates into `external/acqu-skills/` and update the relevant agent registry rows on the working branch directly, not via a merge of the quarantine branch.

- **License posture: NONE → reauthored never copied.** The CR-02 shingle detector ran across all 8 candidate↔source pairs with a threshold of ≤10 shared 8-word shingles per pair; every pair passed with the actual per-pair shared-shingle counts recorded in the Wave 2 execution summary. If the operator detects verbatim copy in any candidate during review, that candidate is BLOCKED from swap and the candidate's SKILL.md is rewritten before any further consideration. The shingle threshold is conservative; passing it is necessary but not sufficient for "re-authored" — operator review is the final check.

- **`/tmp/ref` integrity is locked throughout the phase.** The IN-04 sentinel at `/tmp/.phase-11-wave1-sentinel` was captured at the start of Wave 1 and is asserted at the end of Wave 2. Any write into `/tmp/ref` fails the integrity check and halts the workflow.

- **The two session-shipped stubs (`verification-before-completion`, `clarify-before-acting`) STAY in place until operator approves the swap as a separate step.** The candidates land on the quarantine branch only; the live fleet under `external/acqu-skills/` continues to read the session-shipped stubs.

- **Phase 11 modifies ZERO live-fleet files.** No changes to `scripts/seed/`, no changes to `external/acqu-skills/`, no changes to `CLAUDE.md`, no changes to the 3 planning documents, no changes to `packages/core/src/router/tier-models.ts`, no changes to `packages/core/src/architect/hydrate.ts`. The branch `feat/external-skills-extraction` adds files only under `agents/_candidates/` plus this single report under `docs/plans/`.

---

## Next steps for operator

Four explicit decisions to make, in this suggested order:

1. **Review each candidate's SKILL.md.** Spot-check the prose for voice fit, verify the Output contract references our actual jsonb schema and Relay events, confirm the Provenance block accurately describes what was adopted vs left out. The shingle detector caught verbatim 8-word phrases; operator review catches paraphrased lifts the detector misses.

2. **Decide swap vs defer for the two -v2 candidates.** `verification-before-completion-v2` and `clarify-before-acting-v2` are the highest-leverage swaps — they upgrade the verification and intake posture across every agent that attaches them. The swap is a single change to `external/acqu-skills/<slug>/SKILL.md` (replace stub contents with the v2 candidate contents); the implementation phase carries it out on the working branch directly.

3. **Decide per-class attachment for the new and per-agent candidates.** Four candidates carry per-class attachment recommendations: `output-quality-gate` (creative-studio, client-comms, weekly-report, content-engine), `scope-lock-discipline` (ad-ops, launcher, content-engine), `prompt-injection-guardrail` (browser-using agents, gated on Stagehand backend), `secret-scan-veto` (cliently.dev advisory). Each attachment is a separate `skills[]` array edit on the relevant agent registry row. The two doctrine-surface candidates (`shadow-mode-discipline`, `cost-ceiling-discipline`) do not need per-agent attachment — they live as canonical documentation of existing or future mechanisms.

4. **Resolve the Hermes-fork decision from `docs/plans/EXTERNAL-RUNTIME-RECONCILIATION.md`.** Independent of this report, but related — some candidate wording (especially `cost-ceiling-discipline`'s Tier 2 reserve/commit framing and `shadow-mode-discipline`'s shadow-dataset framing) leans on Path B assumptions (keep our runner, port the doctrine). If the operator decides Path A (adopt the Hermes runtime), the candidates need re-framing for the Hermes substrate before attachment. Path B is recommended in the reconciliation doc; this report assumes Path B.

A follow-up phase implements the approved swaps and attachments. The quarantine branch stays pushed to origin as a reference until every approved candidate has been copied to `external/acqu-skills/` on the working branch, at which point the operator can delete the quarantine branch or leave it for historical reference.

---

*Snapshot date: 2026-06-02*
*Cross-references: docs/plans/EXTERNAL-RUNTIME-RECONCILIATION.md (Wave 1 — license posture + Hermes-fork context), docs/plans/EXTERNAL-TEMPLATES-AUDIT.md (Wave 1 — column-(b) adoption candidates), docs/plans/AGENT-OS-PLAN.md (Relay event namespace, run_summaries schema), docs/plans/AGENTS-PLAN.md (canonical agent anatomy), packages/core/src/architect/hydrate.ts (CANT_FAIL_KEYS), packages/core/src/relay/events.ts (closed 28-event EVENT_NAMES)*
