# EXTERNAL-TEMPLATES-AUDIT

**Snapshot SHA**: `<commit SHA from /tmp/ref tarball — operator fills>`
License: NONE (all rights reserved — reauthor never copy)
**Survey commit**: 2026-06-02

---

## Cross-reference key

This audit puts every salient capability the external runtime exhibits into one of three columns. Column (a) is what we already have. Column (b) is what we should adopt, paired with WHERE it slots in our architecture and WHY the adoption pays. Column (c) is what is irrelevant or conflicts. Every column-(b) row carries a slot path, an effort estimate, and a cross-reference to our planning corpus (`AGENT-OS-PLAN.md`, `AGENTS-PLAN.md`, `GENX-PLAN.md`, `OPTIMIZATION-AUDIT.md`). Source paths for external citations live under `/tmp/ref/agentic-templates-restructure-v2-stack-alignment/` (read-only). The three new AGENT-OS-PLAN.md sections referenced below — **Execution Plane**, **Self-Improvement Loop**, **Multi-Dataset Data Moat** — are pending additions; the column-(b) items are the source material when those sections land.

---

## Column (a) — Already have

We already have these surfaces, in some form. The pairing column documents the external runtime's equivalent so the operator can confirm the mapping. Cross-references to AGENTS-PLAN.md canonical anatomy + AGENT-OS-PLAN.md §8 (Relay schema) on each row.

| Capability | Our surface | Their surface | AGENTS-PLAN.md anatomy ref | AGENT-OS-PLAN.md ref |
|---|---|---|---|---|
| T-critical → Opus 4.8 floor (can't-fail safety contract) | `packages/core/src/router/tier-models.ts` `T_CRITICAL_ALLOWLIST` + runtime `assertCantFailModel` (`apps/runner/src/execute.ts`) | `hermes-runtime/config.yaml` `model.default: anthropic/claude-opus-4.8` + Opus-as-judge in SOUL.md | AGENTS-PLAN.md §1.4 functions; §2.2 emission map (`cantfail.model_violation`) | AGENT-OS-PLAN.md Open Q #1 RESOLVED |
| PreToolUse autonomy gate | `apps/runner/src/hooks.ts` `buildPreToolUseHook` | `hermes-runtime/plugins/agentic_gates/__init__.py` `pre_tool_call` dispatcher | AGENTS-PLAN.md §1.7 failure handling | AGENT-OS-PLAN.md §6.1 autonomy tiers |
| CANT_FAIL_KEYS (Architect refusal) | `packages/core/src/architect/hydrate.ts` `CANT_FAIL_KEYS` set | Gates-as-doctrine in SOUL.md §"The eight gates" | AGENTS-PLAN.md §1.7 guardrails | AGENT-OS-PLAN.md §6.5 security findings |
| Per-run cost ceiling | `apps/runner/src/execute.ts` `budgetCapUsd` + per-run token meter | `agentic_gates/__init__.py` `gate_cost_ceiling` + env `AGENT_RUN_BUDGET_USD="5.00"` | AGENTS-PLAN.md §1.7 cost caps | AGENT-OS-PLAN.md §7.1 cost metering |
| Tenant isolation | `tenant_id` on every table + RLS via `is_tenant_member()` + 32-vector attack registry | per-client VPS + per-client Supabase (different bet, same intent) | AGENTS-PLAN.md §4.2 two-fence model | AGENT-OS-PLAN.md §2.1 enforcement layers |
| Tool registry + per-agent bindings | `tools` table + `agent_tools` bindings + the tools registry per `packages/core/src/tools/` | `hermes-runtime/skills/agentic/tool-catalog/SKILL.md` (manifest-driven tool catalog) | AGENTS-PLAN.md §1.5 APIs/MCP tools | AGENT-OS-PLAN.md §4.3 tool registry |
| Skill loader + agent skill bindings | `external/acqu-skills/<slug>/SKILL.md` + `agents.skills[]` array | `hermes-runtime/skills/agentic/<slug>/SKILL.md` (per-skill markdown contracts) | AGENTS-PLAN.md §1.3 skill binding | AGENT-OS-PLAN.md §4.1 skill registry |
| Verification-before-completion (session stub) | `external/acqu-skills/verification-before-completion/SKILL.md` (90-line stub shipped this session) | `hermes-runtime/skills/agentic/gate-completion-claim-audit/SKILL.md` (300-line full doctrine — adoption target, see column (b)) | AGENTS-PLAN.md §1.7 guardrails | n/a |
| Clarify-before-acting (session stub) | `external/acqu-skills/clarify-before-acting/SKILL.md` (1-line stub) | `hermes-runtime/skills/agentic/understand-the-client/SKILL.md` (6-step procedure — adoption target, see column (b)) | AGENTS-PLAN.md §1.7 | n/a |
| Closed event-name namespace (Relay) | 28-event `EVENT_NAMES` in `packages/core/src/relay/events.ts` | `~/.hermes/logs/gates.log` (best-effort, append-only line log) | AGENTS-PLAN.md §2.2 emission map | AGENT-OS-PLAN.md §8.3 canonical event-name namespace |
| Per-agent autonomy tier | `agents.autonomy_tier` ∈ {`propose`, `execute_safe`, `execute_full`} + the Architect's bounded-rollout ladder | SOUL.md §"How you earn autonomy" — bounded rollout, prove-then-widen | AGENTS-PLAN.md §1.7 routing | AGENT-OS-PLAN.md §6.1 autonomy tiers |
| Approvals inbox | `approvals` table + the approval workflow at `apps/runner/src/approvals/` | gate_never_send + ledger at `~/.hermes/state/send-ledger.json` + Telegram heartbeat | AGENTS-PLAN.md §2.5 internal vs external emission | AGENT-OS-PLAN.md §6.2 approvals inbox |

The column-(a) map is symmetric on intent and asymmetric on substrate: where the external runtime has a `~/.hermes/state/*.json` ledger, we have a table; where it has a `gates.log` line log, we have the Relay event spine; where it has `pre_tool_call` plugin hooks, we have the SDK PreToolUse hook. The architectural delta is registry-vs-file, not capability-vs-gap.

---

## Column (b) — Should adopt + WHY + WHERE

Per row: a one-line description of what to adopt, the slot path in our architecture, the WHY, an effort estimate (S = small, M = medium, L = large), and a cross-reference. The list is intentionally larger than what Phase 11 Wave 2 will extract (Wave 2 quarantines 8 candidates; the remaining items below are explicit future-phase work). The "honest scope note" at the end of this document calls out the gap.

### b.1 — 8-gate regex pattern banks (defense-in-depth on PreToolUse)

**Slot**: `apps/runner/src/hooks.ts` `buildPreToolUseHook` augmentation. Adopt the `SEND_CLASS`, `FILE_MUTATION`, `COMPLETION`, `DEPLOY_CLASS`, `SECRET_PATTERNS`, `PLACEHOLDER`, `CAPTCHA_BYPASS`, `CLIENT_PATH` regex banks as a new module `packages/core/src/safety/pattern-banks.ts`. The hook reads them as a layered floor under the autonomy-tier check.
**Why**: defense-in-depth. The autonomy gate handles policy; the pattern banks handle escaped policy (tool name is `send_safe_message`, regex still catches `send`). Battle-tested from real incidents (the SEND_CLASS bank reflects "75 sends out of one inbox" per SOUL.md gates).
**Effort**: M.
**Cross-ref**: `OPTIMIZATION-AUDIT.md` Tier 2 backlog item — falls under the "harden the PreToolUse hook" track.

### b.2 — Full gate-completion-claim-audit doctrine (replace session stub)

**Slot**: `external/acqu-skills/verification-before-completion/SKILL.md` — REPLACE the 90-line stub with a re-authored version of `hermes-runtime/skills/agentic/gate-completion-claim-audit/SKILL.md`. Wave 2 quarantines at `agents/_candidates/verification-before-completion-v2/SKILL.md`; the swap is an operator-approved follow-up.
**Why**: adds three load-bearing structures the stub lacks: (1) Visual Evidence Gate (screenshots at 1440x900 / 768x1024 / 390x844 + printed layout-bug ledger), (2) contract-not-transcript re-derivation (criteria from SCOPE.md / ROADMAP.md / GOAL.md, never the transcript), (3) the fresh-eyes loop until zero non-blocked misses.
**Effort**: S (re-author).
**Cross-ref**: AGENTS-PLAN.md anatomy §1.3 skill binding; the verification skill attaches to every agent that produces a client-facing artifact.

### b.3 — Full understand-the-client doctrine + interrogator pattern (replace stub)

**Slot**: `external/acqu-skills/clarify-before-acting/SKILL.md` — REPLACE the 1-line stub with a re-authored version of `hermes-runtime/skills/agentic/understand-the-client/SKILL.md` + the interrogator pattern. Wave 2 quarantines at `agents/_candidates/clarify-before-acting-v2/SKILL.md`.
**Why**: the stub names the discipline; the external doctrine provides the 6-step procedure (gather all source; watch the meeting; extract the OUTCOME not features; model their world; surface ambiguities; produce the MIRROR-BACK artifact). The four-section `understanding.md` contract gives an output the agent can be evaluated against — without it, the skill is a slogan.
**Effort**: S.
**Cross-ref**: AGENTS-PLAN.md §1.3; attaches to intake / sales / client-comms agents.

### b.4 — Shadow-mode dataset logger (A1)

**Slot**: a new module `packages/core/src/eval/shadow-dataset.ts` + a migration adding `eval_datapoints` (or reusing `approvals` with new columns). Relay `approval.granted` / `approval.rejected` writes `{ts, agent_key, run_id, task, input_context, draft, judge_verdict, operator_decision, operator_edit}`.
**Why**: closes the agent-evaluator-has-no-signal gap (`OPTIMIZATION-AUDIT.md` 2.E). Every approval-rail decision is a perfect label: approve = good, edit = the edit is the better answer, reject = bad. Free golden set.
**Effort**: M.
**Cross-ref**: AGENT-OS-PLAN.md Self-Improvement Loop section (planned); `OPTIMIZATION-AUDIT.md` 2.E.

### b.5 — Eval-gate as 9th non-bypassable hook (A2) with write-protected rubric

**Slot**: a new `eval_gate` in `apps/runner/src/hooks.ts` intercepting writes to `external/acqu-skills/*/SKILL.md`, `scripts/seed/acqu-*.ts`, `packages/core/src/router/tier-models.ts`. Before the write commits, score the candidate against a frozen case set; Opus-judged baseline-or-better. Rubric is operator-owned, write-protected.
**Why**: anti-reward-hacking. When the generator can edit its own scoring machinery, optimization pressure drives reward hacking. Operator-owned write-protect prevents the generator from making itself score higher. Judge from a different model family than the generator (Opus judging Hermes/Sonnet) — the literature requirement for reliable LLM-as-judge. Makes the scorecard ratchet-only.
**Effort**: M-L.
**Cross-ref**: AGENT-OS-PLAN.md Self-Improvement Loop A2 spec; pairs with b.4.

### b.6 — Reflexion retry loop (A3)

**Slot**: `apps/runner/src/execute.ts` post-`run.failed` handler. On a completion-audit failure or Opus-judge rejection, T-reason writes a 2–4 sentence reflection, stored in episodic memory keyed to the task; retry with reflection prepended. Bounded to 2–3 retries; escalate after the cap per AGENTS-PLAN.md §1.7.
**Why**: closes the "agent fails, then what?" gap. Today `run.failed` terminates with no learned mechanism for the next attempt. Reflexion compounds with the shadow-dataset (b.4) over time.
**Effort**: M.
**Cross-ref**: AGENT-OS-PLAN.md Self-Improvement Loop A3 spec.

### b.7 — Output-QA gate (B1)

**Slot**: `apps/runner/src/hooks.ts` PreToolUse on draft-class tools (any tool with name matching `draft|reply|compose|content_*`). Apply: voice rules (no em-dashes, banned-phrase list from `CLAUDE.md` voice section), brand-safety regex bank, output-class-specific rubric (different rubric per deliverable type — see b.10).
**Why**: stops a reputation-damaging draft from being created in the first place, not just from being sent. Defense-in-depth on top of the approval rail.
**Effort**: S.
**Cross-ref**: AGENTS-PLAN.md §1.7; pairs with the existing CLAUDE.md voice section.

### b.8 — Prompt-injection input guardrail (B3)

**Slot**: `apps/runner/src/tools/` per-tool result handler. On any tool returning content from an external surface (`tool.browser`, `tool.fetch_url`, `tool.gmail_read`, `tool.scrape_*`), treat returned content as DATA not INSTRUCTIONS. Strip recognized patterns ("Ignore previous instructions", "You are now…", JSON-shaped instruction blobs) before the planner sees content. Patterns in `packages/core/src/safety/injection-patterns.ts`.
**Why**: critical before the Stagehand `tool.browser` ships. OWASP LLM01 (prompt injection via tool-returned content) is the leading exploit class for agentic browsers.
**Effort**: S.
**Cross-ref**: AGENTS-PLAN.md §1.5; AGENT-OS-PLAN.md §3.2 sandboxing track.

### b.9 — `output_quality_auditor.py` + 6 deliverable-class rubrics (direct port)

**Slot**: reauthor as `packages/core/src/eval/output-quality-auditor.ts` + rubric modules under `packages/core/src/eval/rubrics/` covering: research-doc, claude-project, custom-scraper, full-build, n8n-workflow, pitch-deck. Each rubric has `check_*` methods + `Severity` + `Finding` shape; orchestrator dispatches on deliverable-type, aggregates into `QAVerdict`.
**Why**: high leverage. Agent-evaluator scorecard is the Tier 2 gap; the external runtime ships the exact shape per-deliverable-class. The 6 rubrics cover most of our agent-class output types.
**Effort**: L; high leverage.
**Cross-ref**: AGENT-OS-PLAN.md Self-Improvement Loop section + `OPTIMIZATION-AUDIT.md` 2.E (agent-evaluator scorecard implementation).

### b.10 — Retrospective pattern (review depth, not cron mechanism)

**Slot**: a new module `packages/core/src/eval/retrospective.ts` triggered by `run.completed`. We have the event spine; we skip their `due_at` sentinel-cron mechanism. Adopt REVIEW DEPTH from `internal-services/retrospective/`: structured `retrospective.json` with what-worked, what-failed, root-cause, rule-or-exemplar to capture, eval-case to add. Append `retrospectives.jsonl` per agent, write `retrospective.completed` event.
**Why**: adopt the depth without the substrate. The valuable part is the rubric — what a retrospective captures and feeds back. Informs b.4 and b.9.
**Effort**: M.
**Cross-ref**: AGENT-OS-PLAN.md Self-Improvement Loop section; AGENTS-PLAN.md §2.3 `run_summaries` composition.

### b.11 — Pure functional critique + learning (reauthor critique.ts + learning.ts)

**Slot**: `packages/core/src/eval/critique.ts` + `packages/core/src/eval/learning.ts` — reauthored from `templates/agent-sdk-base/src/`. Pure functions with injected model-call. `critique.ts` = post-draft self-review (runs at most once; fails SAFE to original). `learning.ts` = approval → exemplar capture + recurring-edit promotion.
**Why**: testable in isolation. Two-invariant design prevents critique-loop runaways (documented bug class). The asymmetric capture: approved drafts → AGENT's text as exemplar; edited drafts → OPERATOR's edit as exemplar (the better answer).
**Effort**: M.
**Cross-ref**: AGENT-OS-PLAN.md Self-Improvement Loop section; pairs with b.4.

### b.12 — 3-tier memory architecture with `default_trust`

**Slot**: a config knob on `packages/core/src/knowledge/retrieve.ts`. Three tiers map to: TIER 1 truth = `relay_events` + `agents` + registry tables. TIER 2 high-trust = system prompts + frozen `kb` docs. TIER 3 advisory = pgvector at `default_trust: 0.5`. The 0.5 weight means recall surfaces candidates; never settles a fact.
**Why**: posture fix. Today pgvector returns candidates without trust weighting; planner / answerer treat all chunks as equally authoritative. The knob flips that.
**Effort**: S.
**Cross-ref**: AGENT-OS-PLAN.md §5.3 retrieval path; Multi-Dataset Data Moat section (planned).

### b.13 — $15K per-build cost ceiling (reserve/commit)

**Slot**: a new `tenant_billing_meters` table + a reserve/commit metering pattern at `packages/core/src/billing/reserve-commit.ts`. Reserve the cost at run-start (estimate based on agent class + tool budget), commit on `run.completed`, refund on `run.failed` (partial). Hard-stop at $15K per build with operator re-approval required to cross.
**Why**: closes Open Q #5 from `OPTIMIZATION-AUDIT.md` (tenant-level billing). Today we have a per-run cap; we have no per-tenant or per-build cap. The external runtime's $15K per-build ceiling is the right shape; the reserve/commit pattern is the right mechanism.
**Effort**: M.
**Cross-ref**: AGENT-OS-PLAN.md §7.2 gaps for tenant-level billing; `OPTIMIZATION-AUDIT.md` Open Q #5.

### b.14 — `verify-gates.sh` install-time gate-proof check

**Slot**: a new `pnpm verify:safety-gates` script in the root `package.json` that proves every entry in `CANT_FAIL_KEYS` triggers under expected attack patterns. The script reads a per-gate fixture (`packages/core/src/safety/gate-fixtures.ts` — a closed registry of {attack-pattern, expected-gate-name}), invokes the PreToolUse hook against each fixture, and asserts the matching gate fires.
**Why**: closes the "do the gates actually work in prod?" doubt. Today, the gates are tested at unit level. There is no fleet-wide "every gate fires when it should" assertion. The external runtime's `test_gates.py` is the canonical shape: a closed fixture set, every gate paired with at least one attack pattern, runs in CI.
**Effort**: S.
**Cross-ref**: AGENT-OS-PLAN.md §9.3 three hard gates; AGENTS-PLAN.md §1.7 guardrails.

### b.15 — Knowledge-base 3-category structure (lessons / known_issues / playbooks)

**Slot**: any future per-tenant `kb/` seeding (Phase 10 onboarding + the GenX-PLAN.md §3.1 onboarding flow). Adopt the three top-level folders: `lessons/` (post-incident learnings, append-only), `known_issues/` (active open issues with status), `playbooks/` (how-to procedures keyed to recurring situations). Naming convention per the existing CLAUDE.md rule: `{company}_{project}_{type}_{slug}_{yyyy-mm-dd}.md`.
**Why**: the three categories are a tested vocabulary. Without a structure, tenants seed `kb/` ad-hoc and retrieval suffers (similar-named files compete). With a structure, retrieval is scoped by category at query time.
**Effort**: S.
**Cross-ref**: GENX-PLAN.md §3.1 onboarding flow; AGENT-OS-PLAN.md §5.1 tables and lineage.

---

## Column (c) — Irrelevant or conflicts

These exist in the external runtime and are not adoption candidates. Either they conflict with our doctrine (Fork B isolation choice) or they are out of scope for an OS-layer build.

- **Per-client VPS + per-client Supabase** (their isolation choice). Conflicts with our RLS+single-Supabase moat thesis. The cross-tenant aggregation that lives in `relay_events_xtenant_agg` and feeds `GENX-PLAN.md` §4.3 ("the wedge: aggregated outcome data across verticals") cannot coexist with their model. See `EXTERNAL-RUNTIME-RECONCILIATION.md` Fork B. The Execution Plane work is where the legitimate "we need physical isolation somewhere" pressure absorbs without unwinding the data-plane contract.
- **`hermes` CLI + `hermes auth add nous` flow.** Their runtime substrate. We run on the Claude Agent SDK via the OpenRouter gateway (`ANTHROPIC_BASE_URL`). Adopting the CLI would mean adopting the runtime — see Fork A recommendation (Path B: keep our runner). Doctrine sources only.
- **`managed-agents-registry.json` of ~70 Anthropic Managed Agents.** A different agent-execution model. We have our own `Runner` interface (`apps/runner/src/`) and our own 56-agent acqu seed under `scripts/seed/`. Mixing the two models would create two systems-of-record for "what agents exist" — exactly the bug class CLAUDE.md warns against ("Agents are DATA, not code"). The Managed Agents registry is a different vendor's data model; we keep ours.
- **`website-factory/`** (their client-facing build factory). Hard-excluded per `11-CONTEXT.md` scope fence. Out of scope for the OS-layer phase; revisit only if the operator pivots Cliently to a website-build factory model (not the current product shape).
- **Telegram heartbeat + Loom watching skills + per-client ops scripts.** Client-specific ops, not generic OS work. The Telegram heartbeat is a specific operator's notification channel; the Loom-watching skill is bound to the operator's content pipeline. Generic OS work would extract the SHAPE of these ("operator-channel notification carve-out") but not the implementation. The carve-out shape is already captured in our `agents.escalation_channel` field.

---

## Explicit 5-category callout (operator-named axes)

The operator's framing of this audit named five categories explicitly. They map to the columns above as follows.

### (i) sandboxed/VPS execution + tenant isolation

See Fork B in `EXTERNAL-RUNTIME-RECONCILIATION.md` (per-client VPS + per-client Supabase is column (c) — conflicts with our moat thesis). The legitimate sandboxed/VPS execution pressure is absorbed by the Execution Plane work in `AGENT-OS-PLAN.md` (the planned section): ephemeral per-run sandboxed containers for tool execution give us a hardened blast radius for untrusted code / untrusted browser sessions / untrusted scrape targets, without unwinding the RLS contract at the data layer. Cross-references: AGENT-OS-PLAN.md §2.1 enforcement layers + §3.2 sandboxing track + Execution Plane (planned).

### (ii) Eval harnesses / self-improvement / feedback loops

See column-(b) rows b.4 (shadow-mode dataset), b.5 (eval-gate 9th hook + write-protected rubric), b.6 (Reflexion retry loop), b.9 (output_quality_auditor + 6 rubrics), b.10 (retrospective pattern), b.11 (critique + learning). Together these constitute the Self-Improvement Loop spine. The A1–A5 build order from the external `SELF_IMPROVEMENT_AND_GATES_SPEC.md` maps to b.4→b.5→b.6→b.10→b.9 in our terminology. Cross-references: AGENT-OS-PLAN.md Self-Improvement Loop section (planned); `OPTIMIZATION-AUDIT.md` 2.E (agent-evaluator scorecard).

### (iii) Telemetry / event-schema or dataset / "pixel" patterns

Our 28-event Relay namespace (`AGENT-OS-PLAN.md` §8.3) is the canonical event-schema; their `~/.hermes/logs/gates.log` is a best-effort append-only line log — same role, different shape. Their 3-tier memory architecture (`AGENTS.md` lines 28 + `SOUL.md` memory section) maps to our pgvector + Relay + run_summaries triple — see column-(b) b.12 (`default_trust` posture fix). The "pixel" pattern from `GENX-PLAN.md` §4 lives at the `/relay/ingest` boundary; the external runtime has no equivalent because it doesn't aggregate across tenants by design. Cross-references: AGENT-OS-PLAN.md §8 (Relay schema), §8.3 (canonical event-name namespace), §8.5 (consent boundary); GENX-PLAN.md §4 (the Pixel); Multi-Dataset Data Moat section (planned).

### (iv) Skill / agent registry or MCP-tool patterns

Their `hermes-runtime/skills/agentic/tool-catalog/SKILL.md` is a manifest-driven tool catalog; we have the `tools` table + `agent_tools` bindings (column (a) row 6). Their per-skill SKILL.md contract matches our `external/acqu-skills/<slug>/SKILL.md` shape. The adoption candidates in column (b) (b.2 verification-before-completion-v2, b.3 clarify-before-acting-v2) replace session stubs with full doctrine. Their `provision-manifest.yaml` (per-client tenant onboarding manifest) maps to our future tenant-onboarding flow in GENX-PLAN.md §3 (not adopted as-is; the manifest format diverges, but the SHAPE of "a single declarative file lists everything a new tenant needs" is a pattern to replicate). Cross-references: AGENTS-PLAN.md §1.3 (skill binding), §1.5 (APIs/MCP tools); GENX-PLAN.md §3.1 (onboarding flow); AGENT-OS-PLAN.md §4 (registries).

### (v) Governance / approval / autonomy-tier patterns

Their 8 hard gates (column (a) rows 2–4 + column (b) b.1 pattern banks) map to our PreToolUse hook + CANT_FAIL_KEYS + autonomy-tier check. Their bounded-rollout ladder ("prove ONE internal goal first; then membrane and revision loop; then ratchet; then harden; then widen") maps to our `autonomy_tier` progression (`propose` → `execute_safe` → `execute_full`) plus the per-agent `eval_promotion` rule. Their `approvals.mode: manual` + 60-second `approvals.timeout` (fails closed) + `cron_mode: deny` corresponds to our Approvals inbox (`AGENT-OS-PLAN.md` §6.2). Cross-references: AGENT-OS-PLAN.md §6 (governance), §6.1 (autonomy tiers), §6.2 (approvals inbox); AGENTS-PLAN.md §1.7 (failure handling, guardrails, cost caps, approvals routing).

---

## Honest scope note

This audit identifies fifteen column-(b) adoption candidates. Phase 11 Wave 2 will quarantine only **eight** of them as re-authored SKILL.md candidates on the `feat/external-skills-extraction` branch: `verification-before-completion-v2` (b.2), `clarify-before-acting-v2` (b.3), `prompt-injection-guardrail` (slot for b.8 doctrine), `output-quality-gate` (slot for b.7 doctrine + b.9 rubric subset), `shadow-mode-discipline` (slot for b.4 doctrine), `cost-ceiling-discipline` (slot for b.13 doctrine), `scope-lock-discipline` (additional gate), `secret-scan-veto` (additional gate). The remaining seven items (b.1 pattern banks; b.5 eval-gate hook; b.6 Reflexion loop; b.9 full auditor + rubrics module; b.10 retrospective module; b.11 critique/learning ports; b.12 default_trust knob; b.14 verify-gates script; b.15 KB structure) are future-phase work (`OPTIMIZATION-AUDIT.md` Tier 2 backlog, the agent-evaluator scorecard track, and the planned AGENT-OS-PLAN.md Self-Improvement Loop section).

This is the honest accounting. Wave 2 is a SUBSET of the audit; the audit is not a Wave 2 manifest. The operator decides which items advance from "noted in this audit" to "planned in a phase" to "implemented in a Wave." This document's job is to make the full surface visible so that decision is informed; it is not to schedule the work.

The license posture is the same as `EXTERNAL-RUNTIME-RECONCILIATION.md`: nothing copied; column (b) cites source paths and SHAPES the adoption around our existing surfaces. The reauthored quarantine candidates in Wave 2 carry explicit `source_path` and `license: NONE (all-rights-reserved — reauthored, never copied)` provenance tags. The two short quotes from the external runtime in the sibling reconciliation document stay there; this audit does not quote, it only cites.
