# EXTERNAL-RUNTIME-RECONCILIATION

**Snapshot SHA**: `<commit SHA from /tmp/ref tarball — operator fills>`
License: NONE (all rights reserved by default — reauthor never copy)
**Survey commit**: 2026-06-02
**Status**: DECISION: operator's call, do not implement yet

---

## Purpose

This document reconciles two forks that surfaced from a read-only survey of `wifiwave/agentic-templates-restructure-v2-stack-alignment` (mounted read-only at `/tmp/ref/`, license=NONE → reauthor rule applies). The survey did not produce new code. The forks are operator decisions; both are documented here with evidence, recommended path, and the trade-off shape so the operator can rule between sessions.

Neither fork is implemented in this phase. Phase 11 is a planning + quarantined-extraction phase. The live fleet (`DEFAULT_TIER_MODELS`, `scripts/seed/`, `CLAUDE.md`, `AGENT-OS-PLAN.md`) is not modified by this doc or its sibling `EXTERNAL-TEMPLATES-AUDIT.md`. Downstream implementation phases pick up the resolved fork.

---

## Fork A — Hermes runtime vs. Hermes model

### The contradiction

Our `packages/core/src/router/tier-models.ts` sets `DEFAULT_TIER_MODELS["T-reason"].primary = "nousresearch/hermes-4-405b"` and `DEFAULT_TIER_MODELS["T-cheap"].primary = "nousresearch/hermes-4-70b"`. The operator-facing intent (documented inline in the same file and ratified in `CLAUDE.md`) is that Hermes-4-405B is the reasoning workhorse for "multi-step analysis, synthesis, anything where reasoning moves the output" and Hermes-4-70B is the volume default for "monitors, watchers, triage, single-step tool calls." Both placements assume Hermes-4-* is a capable agentic model — i.e., capable of multi-step tool orchestration under our `Runner` interface.

The external runtime documents the opposite. The external repo's `hermes-runtime/config.yaml` resolves Hermes-the-runtime (NousResearch's framework) onto Anthropic's Opus 4.8 as the executing model, and the YAML comment block lays out the explicit reason. The verbatim text from `hermes-runtime/config.yaml` (lines 12–15, attribution: external runtime, license=NONE, quoted for fair-use reconciliation):

> WHY NOT a Nous-native model: Nous' OWN docs say their Hermes-4-70b/405b are chat/reasoning-tuned, NOT tool-call-tuned, and "will struggle with multi-step agent loops". Nous recommends Claude (sonnet-4.6 general / opus heavyweight) to RUN the Hermes agent framework.

This is the smoking gun. The vendor that ships Hermes-4-* says, in its own published guidance as quoted by an integrator, that Hermes-4-* is **not** the right fuel for multi-step agentic loops. Our T-reason default ("multi-step analysis") and our T-cheap default (single-step tool calls — borderline, but the fleet runs many T-cheap agents that do call tools) are placing Hermes-4-* into exactly the workload Nous says it will struggle with.

The Hermes "runtime" is NousResearch's agent framework, distinct from the Hermes "model" family. The external repo runs the framework on Opus 4.8 (model AND judge), per `SOUL.md` line 3: "You run on Opus 4.8, which is both your model and your judge." The runtime's design is `Opus + Hermes-framework`, not `Hermes-model + anything`.

### Path A — adopt the Hermes runtime

Replace our Anthropic Agent SDK `Runner` implementation with the external Hermes framework. Re-host the agent loop, the plugin system, the hooks, the goal evaluator, and the skill loader on Hermes. Keep `DEFAULT_TIER_MODELS["T-reason"]` pointing at Hermes-4-405B if (and only if) we accept that Hermes-the-runtime supersedes Hermes-the-model as the operator's mental model for "Hermes," i.e., we route reasoning through Hermes-runtime + Opus, not through Hermes-405B directly.

### Path B — keep our runner, demote Hermes-4-\* in the tier map

Keep our Anthropic Agent SDK runner. Keep the Relay spine (28-event closed namespace, `relay_events` table, ingestion path), the Model Router (`packages/core/src/router/`), and the runtime `cantfail.model_violation` assertion. Port the doctrine layer — gates, skills, knowledge-base structure — into our existing surfaces (PreToolUse hook, `external/acqu-skills/`, pgvector). Demote `nousresearch/hermes-4-70b` and `nousresearch/hermes-4-405b` from primary fuel slugs to optional-fallback-only or remove them, replacing T-cheap with a model the vendor actually recommends for single-step tool calls and T-reason with one the vendor recommends for multi-step reasoning under tool use.

### Cost-benefit table

| Path | What it preserves | What it unwinds | Magnitude |
|---|---|---|---|
| Path A (adopt Hermes runtime) | The Hermes plugin / hook / skill model, the framework's gate-as-doctrine separation, the Opus-as-model-and-judge framing | Our Relay spine wiring at the `Runner` boundary; our Model Router resolution flow; the runtime `cantfail.model_violation` assertion; the custom-tools dispatch; the OpenRouter gateway integration; the Inngest scheduler shape | ~132,000 lines of session work across Phases 5–9 |
| Path B (keep runner, demote Hermes-4-\*) | All of the above; the Open Q #1 RESOLVED runtime assertion; the Architect's `CANT_FAIL_KEYS` refusal; every Phase 9 security agent; the 56 existing acqu-\*.ts seed scripts; the 32-vector attack registry | The current `DEFAULT_TIER_MODELS["T-reason"].primary` and `DEFAULT_TIER_MODELS["T-cheap"].primary` slug choices (one-line edits to one file) | One small constant change in `packages/core/src/router/tier-models.ts` + a regression-test refresh in `router.test.ts` + a `CLAUDE.md` tier-table refresh |

### The T-critical floor is unchanged under both paths

The T-critical → Opus 4.8 floor (AGENT-OS-PLAN.md Open Q #1 RESOLVED) is **correct under both Path A and Path B**. The contested half of the doctrine is only the non-critical default — the slug, not the safety contract. The runtime `cantfail.model_violation` assertion in `apps/runner/src/execute.ts` and the `T_CRITICAL_ALLOWLIST` in `packages/core/src/router/tier-models.ts` survive any resolution of this fork, because Opus 4.8 is also the external runtime's chosen model. Both paths agree on Opus as the can't-fail floor; they diverge only on what runs non-critical tiers and on which framework hosts the agent loop.

### Recommended: Path B

Path A unwinds ~132,000 lines of session work without changing the operator-visible behavior on the safety dimension that matters (T-critical → Opus, locked). Path B preserves all of that work AND gets the doctrine right on the model side. The cost-shape is asymmetric: Path A is a re-platform; Path B is a constant change + a regression-test refresh. The risk-shape is also asymmetric: Path A re-introduces every surface our session-shipped tests cover (Relay schema, Model Router precedence, can't-fail assertion, OpenRouter gateway, Inngest function); Path B touches one constant and one CLAUDE.md table.

Path B accepts the external runtime's evidence (Hermes-4-* is not tool-call-tuned) without accepting the external runtime's substrate (Python framework + per-client VPS — see Fork B). It treats the external repo as a doctrine source, not a runtime source. This is the disposition the rest of this phase's audit (`EXTERNAL-TEMPLATES-AUDIT.md`) is built around: port the doctrine into our existing surfaces; do not adopt the external framework.

### Decision blocker

DECISION: operator's call, do not implement yet.

Sub-decision: demote Hermes-4-70b/405b in `DEFAULT_TIER_MODELS` now (next phase), or stage to a follow-up phase after a comparative eval against the replacement slug? The agent-evaluator scorecard (Tier 2 backlog, `OPTIMIZATION-AUDIT.md` 2.E) is the gating mechanism for a controlled swap; without it, a slug change is judged by anecdote.

---

## Fork B — Isolation model

### Their model: per-client VPS + per-client Supabase

The external runtime's `AGENTS.md` line 28 states (verbatim, attribution: external runtime, license=NONE, quoted for fair-use reconciliation):

> Memory (deployed client agent): per-client Supabase is the source of truth, Hermes-native plus a Holographic local provider are advisory recall only, no Letta, no cloud SaaS.

The runtime hosts each client on a Hetzner VPS the client owns, with that client's own Supabase. The isolation guarantee is **physical**: cross-tenant access is impossible because the tenants do not share a database, do not share a host, and do not share a process.

### Our model: single Supabase + tenant_id RLS

Our model is documented in `AGENT-OS-PLAN.md` §2 (multi-tenant data model). Every table carries `tenant_id`. RLS via `is_tenant_member()` enforces per-row access at the database layer. The 32-vector attack registry plus the `tenant-isolation-tester` agent (Phase 9 hard gate) is the proof-of-isolation surface. Cross-tenant aggregation is intentional and lives at a schema-enforced boundary (the `relay_events_xtenant_agg` view + the consent boundary in §8.5).

### Side-by-side comparison

| Dimension | Their per-client VPS + Supabase | Our single Supabase + RLS |
|---|---|---|
| Isolation bet | Physical (no shared substrate) | Logical (RLS at row layer + auditable attack-vector registry) |
| Per-tenant cost shape | Linear in tenants (one VPS, one Supabase per tenant) | Sub-linear in tenants (shared infra; cost scales with usage, not headcount) |
| Cross-tenant aggregation | Impossible by construction | First-class via `relay_events_xtenant_agg` view, consent-bounded |
| Moat implication | None at the data layer (each tenant is an island) | Aggregated outcome data across tenants becomes the wedge (`AGENT-OS-PLAN.md` §8 + `GENX-PLAN.md` §4.3) |
| Audit trail | Per-tenant (each VPS, each Supabase) | Unified (Relay spine across the fleet) |
| Failure blast radius | Per-tenant (one VPS down → one tenant down) | Fleet-scoped (shared infra has shared failure modes) |
| Onboarding | Provision a new VPS, a new Supabase, a new bundle | Insert a `tenants` row + the seed scripts pick up the rest |

### Recommended: keep ours

Adopting their isolation model would unwind the cross-tenant aggregation that the moat thesis depends on. The `relay_events_xtenant_agg` view + the consent boundary (`AGENT-OS-PLAN.md` §8.5) IS the wedge for `GENX-PLAN.md` §4.3 ("the wedge: aggregated outcome data across verticals"). Per-client physical isolation makes that aggregation impossible by construction — the moat thesis cannot coexist with their model.

Their model and ours are both legitimate. They are different bets. Their bet is on physical-isolation as the regulatory + trust story (the "no shared substrate" pitch). Our bet is on RLS-at-row + an auditable attack-vector registry as a per-row contract, and on cross-vertical aggregated outcomes as the wedge. The choice is structural; ripping out cross-tenant aggregation later is not a refactor, it is a rebuild.

### The Execution Plane is the adjacent design space

The Execution Plane work (planned section in `AGENT-OS-PLAN.md`) is where closer-to-physical isolation lands without unwinding the DB-layer RLS contract. Ephemeral per-run sandboxed containers for tool execution give us a hardened blast radius for the part of the workload that needs physical isolation (untrusted code, untrusted browser sessions, untrusted scrape targets) while preserving the shared data-plane RLS contract for the part that does not (registry rows, agent specs, KB documents, Relay events). The fork resolution recommendation accepts that the Execution Plane is the legitimate place to absorb the "we need physical isolation somewhere" pressure.

### Decision blocker

DECISION: operator's call, do not implement yet.

---

## What stays intact regardless of either fork's resolution

The following surfaces are unaffected by either fork's resolution. They are correctness-critical, ratified, and ship from prior phases.

- **T-critical → Opus 4.8 floor** (`AGENT-OS-PLAN.md` Open Q #1 RESOLVED). The `seedAgent` exemption skips `tenants.default_model_override` for T-critical specs. The runtime `cantfail.model_violation` assertion in `apps/runner/src/execute.ts` reads `T_CRITICAL_ALLOWLIST` and fails closed on drift. Both stay.
- **CRA blocklist mechanism** (`GENX-PLAN.md` Open Q #8 RESOLVED mechanism, pending counsel-approved wording). Architect refuses to assemble agents whose function touches credit / employment / housing / insurance / government-benefit eligibility decisioning. Runtime guard emits `cantfail.cra_violation` for manually-authored seeds that bypass the Architect.
- **The Architect's CANT_FAIL_KEYS refusal** (`packages/core/src/architect/hydrate.ts`). Untouched by Phase 11.
- **The Relay event spine** (`AGENT-OS-PLAN.md` §8). 28-event closed namespace, `relay_events` table, the consent boundary, the `relay_events_xtenant_agg` view. Untouched by Phase 11.
- **All Phase 9 security agents.** `tenant-isolation-tester`, `security-anomaly-watchdog`, `access-auditor`, and the 32-vector attack registry. Untouched by Phase 11.

The point of listing these here is to make the scope of each fork explicit. Fork A is a runtime + model-slug decision; Fork B is a data-isolation decision. Neither fork moves the safety floor, the CRA gate, the Architect's refusal, the Relay namespace, or the Phase 9 security agents. The operator can decide either fork in either direction without re-litigating those surfaces.

---

## Honest license acknowledgment

The external repo carries no LICENSE file. Under the GitHub default and most jurisdictions, that is all-rights-reserved by the author. Every external artifact this phase touches is treated under the reauthor-never-copy rule:

- This reconciliation document only **describes** the external runtime. The structure (Fork A, Fork B, recommendations, intact surfaces) is Cliently-native analysis.
- Two short paragraphs are **quoted** verbatim: the `hermes-runtime/config.yaml` "WHY NOT a Nous-native model" block (4 lines), and the `hermes-runtime/AGENTS.md` memory architecture line (1 sentence). Total quoted material under 80 words across the two quotes. Both are explicitly attributed to their source paths and to the external runtime. Both are used for the narrowly-scoped purpose of reconciling our doctrine against the external runtime's documented design — the fair-use reconciliation case is direct.
- Nothing else is copied. The audit document (`EXTERNAL-TEMPLATES-AUDIT.md`, sibling to this file) is a 3-column analytical structure citing source paths; it does not lift code or prose.
- The quarantined extraction (Wave 2, on `feat/external-skills-extraction`) re-authors candidate SKILL.md files into our canonical anatomy with explicit `source_path` and `license: NONE (all-rights-reserved — reauthored, never copied)` provenance tags. No verbatim copying.

The license posture is unchanged from `11-CONTEXT.md`. Wave 2's quarantined candidates inherit the same posture. Operator review of these two docs is the gate before any downstream phase implements either fork's recommendation.
