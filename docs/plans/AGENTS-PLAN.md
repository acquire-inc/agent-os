# AGENTS-PLAN.md — Canonical Agent Anatomy, Data-Relay Emission Contract & Scale Plan

> **Status:** Planning only (no production code in this doc). **Date:** 2026-06-01 (rev 2).
> **Scope:** AgentOS, agents, and GenX only. **No Cliently** — this plan does not read or reconcile
> against any Cliently product docs.
> **Authority & inheritance:** this doc owns the **canonical agent anatomy**, the **per-agent
> data-relay emission contract**, and the **existing-agent improvement plan**. It **inherits** the
> canonical **Relay event schema** and the **`tenant_id` / RLS isolation model** from
> `AGENT-OS-PLAN.md` (the platform plan) — it does not redefine them. On machinery it defers to
> `main-acqu-agent-doctrine.md`; on agent *behavior* to the v1/v2 doctrine.
>
> **Status of the owning doc (2026-06-01):** `AGENT-OS-PLAN.md` does **not exist in the repo yet**
> (the AgentOS session produces it; verified absent on all branches). Until it lands, the envelope
> fields and event-type registry sketched in §2 are this doc's **working assumption**, not the
> authority — when `AGENT-OS-PLAN.md` ships, re-reconcile §2 against its canonical Relay schema and
> resolve any field-name drift in its favor.

---

## 0. READ-FIRST RECONCILIATION — what I read, and what's confirmed vs open

I read the live code (not just docs) before writing: `packages/db/src/schema.ts` (all tables),
`packages/core/src/{bundle,scheduler,lifecycle,autonomy,metering,workforce,cost,metrics}.ts`,
`apps/runner/src/{execute,hooks,config}.ts`, `apps/api/src/index.ts`, `scripts/seed/*` (seeders +
`_chains.ts` + `_tools.ts`), the 93 `exports/agents/*.md`, the doctrine set, and `.planning/*`.
**Per scope, I did not read or reconcile against any Cliently docs.**

**Corrections applied in this revision (the code is the source of truth — match it):**

1. **`tenant_id` everywhere, never `org_id`.** The codebase + RLS are multi-tenant by `tenant_id`
   (every table, the bundle, the claim path, the `is_tenant_member` policy). This plan uses
   `tenant_id` throughout. The isolation model is **owned by `AGENT-OS-PLAN.md`**; this plan consumes
   it.
2. **The telemetry contract is the "Relay" — not "pixel."** "Pixel" in this stack already means the
   **Meta tracking pixel** (`tool.11` Pixel Health, `pixel-watcher`, `event-schema-guardian`).
   Internal agent telemetry and the future external **GenX "pixel"** are the **same pipeline, same
   schema**; the GenX pixel is only the external SDK/brand exposed over the Relay later. The canonical
   **Relay event schema is owned by `AGENT-OS-PLAN.md`**; this plan defines **what every agent emits
   into it and when** (§2).
3. **The Relay is net-new (P0), not a reconciliation.** Telemetry today is **four un-unified tables**
   — `run_activity` (freeform), `autonomy_events` (gate decisions), `audit_log` (tool calls),
   `usage_events` (billing) — sharing no envelope, no versioned vocabulary. The platform plan unifies
   them into one spine. **`run_summaries` was specced (build-spec §3/§5 SessionEnd hook) but never
   built** — `runs.summary` (text) + `run_activity` stand in. It is the single biggest gap for "emit
   back what every agent did," and is the **P0 emission target** this contract must populate.
4. **Privacy posture is baked into emission (§2.5).** Agents emit **per-agent, per-tenant** events
   only. Cross-tenant use is **aggregated / pattern-level, consented, never raw-shared** across
   tenants. First-party/consented data only — nothing that turns the platform into a consumer
   reporting agency.

**Confirmed decisions (now settled — folded in, no longer open):**

- **Inngest is green-lit** as the event router/durable executor — it carries the Relay and routes
  agent chains (§4.5).
- **"Hundreds of agents" = the same agents across many tenants** (white-label fulfillment), **not**
  hundreds of novel agent types. So the scale problem is *N tenants running the proven fleet safely*
  — **isolation + Relay observability + cost caps**, not a bigger registry. The whole §3/§4 plan
  optimizes for that.
- **Sequencing rule (obeyed literally):** the **Relay + a fleet-wide RLS audit (P0)** must land
  **before** scaling the agent/tenant count. We do **not** 10× the fleet on partially-proven
  isolation and no event spine.

**Still-fragile facts (not opinions — flagged so downstream trusts the right things):**

- **RLS is real but partial.** `0001_init.sql` enables RLS + `is_tenant_member` on the original
  spine; 0003–0007 add policies for their tables. But **0009/0010 additions (`agents.status`,
  `tenant_credits`, `usage_events`, `credit_ledger`) and others need an RLS audit** — the build-spec
  acceptance test ("tenant A sees zero rows of tenant B across *every* table") is **not currently
  proven fleet-wide**. This is the hard P0 gate for white-label.
- **The runtime is single-process; chains are declared, not executed.** `apps/runner` is one Node
  loop claiming runs (`FOR UPDATE SKIP LOCKED`). Handoff chains are *seeded as triggers*
  (`_chains.ts` → `agent_triggers`) but **nothing emits or routes the events** between agents at
  runtime yet — Inngest closes this (§4.5).

**One open item for the operator (not resolvable from code):** the **can't-fail model policy**
contradiction — the operator override runs the *whole* fleet on Hermes 4 405B, while CLAUDE.md says
the can't-fail list must be Claude ("never Hermes"). Carried to Open Questions.

---

## 1. THE CANONICAL AGENT ANATOMY

**The one rule (load-bearing):** *an agent is DATA, not code.* It is a registry row + a versioned
system prompt + skill files + tool/MCP bindings + trigger config. The only per-agent code ever
justified is a genuinely-new **deterministic tool** (shared across agents). Everything below is the
shape of that data and the runtime contract around it. **At our scale target — the same agents across
many tenants — this anatomy is the white-label unit: define it once, clone it per tenant.**

### 1.1 Definition — what an agent IS (the record)

The join of these rows, all carrying `tenant_id`:

| Element | Table | Purpose |
|---|---|---|
| Identity + config | `agents` | key, name, **model** (fleet = `nousresearch/hermes-4-405b`), **backend** (`claude-agent-sdk`\|`managed-agents`), **thinking_level**, **autonomy** (`propose`\|`execute_safe`\|`execute_full`), **status** (`proposed`\|`active`\|`paused`\|`archived`), **budget_cap_usd**, **escalation_policy**, **knowledge_scope_json** (`{folders,tags}`), `runner_kind`, `enabled`, `template_id` (clone provenance) |
| Versioned prompt | `agent_prompts` | append-only versions, exactly one `is_current`; `agents.persona` is the cached mirror the runner reads |
| Skills | `skills` + `agent_skills` | reusable SKILL.md playbooks with `allowed_tools_json` (least privilege at the skill layer) |
| Tools | `tools` + `agent_tools` | deterministic tool catalog; binding = "this agent may call this tool"; each carries `requires_approval` + `reversible` |
| Connectors | `mcps` + `agent_mcps` | MCP servers (Close, Slack, Pipeboard×Meta, …); credentials resolved fresh + short-TTL at bundle time via the vault |
| Triggers | `agent_triggers` | `cron` \| `webhook` \| `state` \| `on_demand`; the scheduler/Inngest router materializes runs from these |
| Evals | `eval_cases` + `agent_metrics` | per-agent test set `agent-evaluator` replays; daily scorecard drives promotion/demotion |

**Canonical AgentSpec (the template every agent conforms to)** — the existing seed shape, named so new
agents are authored against it:

```
AgentSpec {
  key, name                         # stable identity (kebab/dotted lowercase)
  persona / system_prompt           # versioned; header block: model-tier + rationale, bound MCPs,
                                     #   loaded skills, verification method
  model = ACQU_AGENT_MODEL          # config not code; fleet override = Hermes 4 405B
  thinking_level                    # low|medium|high (tier-derived: cheap→low, reason/critical→high)
  autonomy = "propose"              # NEW agents ALWAYS start here; promotion is earned from evals
  status = "proposed"               # NEW agents land proposed+disabled; a human activates
  budget_cap_usd                    # per-run hard cap; soft cap pauses, cap×1.5 kills
  escalation_policy                 # when/what hits the Approvals inbox; `always_allow:` pre-approvals
  knowledge_scope = {folders, tags} # the slice of the knowledge store it may retrieve
  skills[]                          # 1 primary function skill + safety skills
                                    #   (verification-before-completion always; clarify-before-acting if it acts)
  tools[]                           # declared in the prompt as tool.*; derived+bound by seed-tools
  mcps[]                            # connectors it needs, least-privilege
  triggers[]                        # cron / webhook / state / on_demand
  eval_cases[]                      # critical for can't-fail agents + high-volume monitors
}
```

**Validation gate (exists, `scripts/seed/_schema.ts`):** every record is validated before seed — key
shape, model-slug allowlist, autonomy/backend enums, prompt length, and the safety invariant
*irreversible ⇒ requires_approval*. **Canonical: no agent reaches the DB without passing
`validateAgent`** — extend it with the Relay-emission checks in §2.6.

### 1.2 Instantiation — per tenant (this is the white-label mechanism)

Two paths, both already real:

- **Internal (Acqu, tenant #1):** seeders upsert agents idempotently (`upsertAgent` keyed on
  `tenant_id + key`); re-running converges.
- **White-label client tenant (2…N):** `provisionClientTenant` (core/provision.ts) **clones a
  template tenant's whole workforce** — agents + skills + MCP *definitions* + jobs + projects — with
  fresh IDs, remapped references, `template_id` provenance, and **credentials/runs deliberately NOT
  copied** (each tenant connects its own accounts; MCP status starts `disconnected`).

**Canonical instantiation rule (and the scale lever):** a new tenant is born by cloning a curated
**template tenant** (the golden image), not by re-running doctrine seeders. Per-tenant customization is
**overrides on the cloned rows** (model/thinking/budget/scope/branding), never forks of code. *This is
exactly why "hundreds of agents = same agents × many tenants" is tractable: one validated fleet,
cloned and configured N times.* The risk it concentrates is **isolation** — see §4.2.

### 1.3 The think loop (plan → select → execute → self-check → retry → escalate)

Enforced by the **runtime + hooks**, not by trusting the prompt — so it holds across every tenant's
clone of every agent.

1. **Bundle assembly (orchestrator, `buildBundle`).** For a claimed run: agent config + current
   prompt, bound skills (+allowed-tools), bound tools (key/kind/requires_approval/reversible), MCP
   servers (+fresh short-TTL credentials), **knowledge retrieved from pgvector scoped to
   `knowledge_scope`**, pinned env vars (decrypted via vault), API callbacks. *(Gap: the bundle does
   not yet include recent `run_summaries` for continuity — build-spec §4 wanted this; §5 P0.)*
2. **Plan.** The prompt carries the workflow; thinking-level (high for reasoning/can't-fail) governs
   depth. Convention: a one-line `plan.md` of the run's most important call.
3. **Tool selection — scoped two ways.** (a) **per skill** via `allowed_tools_json`; (b) **per agent**
   via `agent_tools` (the hard ceiling). *(Residual gap: no `tool_key → runtime SDK tool-name` map, so
   SDK-level `allowedTools` restriction + registry-driven gating for MCP tools isn't enforced at the
   SDK boundary — only the autonomy gate + prompt do. §5.)*
4. **Execute (Runner, behind hooks).** `executeRun` routes on `backend`: SDK in-process loop, or
   Managed Agents (beta header). Same safety contract either way.
5. **Self-check.** `verification-before-completion` is canonical on every agent; can't-fail agents add
   domain linters (e.g. ad-ops checks rule-engine compliance + change-per-day before queuing).
   **Canonical: no run claims "done" without its verification step.**
6. **Retry.** (a) **model fallback** — on a provider-availability error (Nebius is single-sourced) the
   runner retries once on `claude-haiku-4-5` (`model-fallback.ts`); (b) **manual** — `retryRun` clones
   a failed run. *(Automatic step-level retry / durable resume across restart = the Inngest build, §4.)*
7. **Escalate → Approvals inbox.** When the gate returns `propose`, the run raises an `approvals`
   row, records the gate event, and **suspends** (status `waiting`, persisting `sdk_session_id`); a
   human decides; the run resumes (`waiting → pending → running`) on the exact SDK session. Budget
   over the soft cap also escalates (pause for re-approval); cap×1.5 kills.

### 1.4 Skills, Functions, and tool/MCP access (scoped per tenant + per autonomy tier)

- **Skills** — versioned SKILL.md (content-hashed), playbook + `allowed-tools` frontmatter. An agent
  holds 1 primary function skill + safety skills. `skill-librarian` proposes/refines them.
- **Functions** (doctrine v2: 8 domains, 26 functions) — the *business* grouping an agent serves; the
  map for *what agents should exist*, not a runtime object.
- **Access is scoped by three gates, narrowest wins:**
  1. **Binding** (`agent_tools` / `agent_mcps`) — the agent can't see what it isn't bound to.
  2. **Skill allow-list** (`allowed_tools_json`) — least privilege within a playbook.
  3. **Autonomy tier × reversibility** (the runtime gate, §1.6) — *can it act without a human?*
- **Per-tenant connector scoping:** MCPs are per-tenant rows; credentials are per-tenant vault refs
  resolved fresh at bundle time. A cloned tenant gets MCP *definitions* but connects its own
  accounts — **cross-tenant credential bleed is structurally impossible iff the vault namespace + RLS
  hold**, which §4.2 says we must *prove* fleet-wide, not assume.

### 1.5 Memory — three distinct tiers (name them, don't conflate)

| Tier | Lifetime | Where it lives | Who writes/reads |
|---|---|---|---|
| **Short-term context** | one run | the SDK session (`sdk_session_id`) + the assembled Bundle | runtime; discarded on terminal status (session id kept for resume) |
| **Persistent agent state** | across runs | **(P0 gap) the missing `run_summaries`** + `runs.summary` + `agent_metrics` | lifecycle on completion; should feed the next bundle (continuity) — *not wired yet* |
| **Knowledge store** | durable, shared | `documents` + `doc_chunks` (pgvector, 1536-dim), namespaced `tenant/{id}/...`, scoped by `knowledge_scope` | `memory-consolidator` writes run memory as documents; retrieval at bundle time; `knowledge-curator` keeps it clean |

**Canonical memory rules:** (1) short-term never crosses runs except via an explicit summary; (2)
persistent state **is** the run-summary contract — *this table must be built (§5 P0)*; (3) knowledge
retrieval is always scope-limited and **tenant-namespaced** (an isolation surface — §4.2); (4) **large
tool outputs go to files/knowledge and the path is returned — never dumped into context** (doctrine
non-negotiable #4).

### 1.6 Guardrails, cost caps, and the Approvals inbox (the autonomy gate)

Pure + backend-agnostic (`autonomy.ts`), enforced in **hooks** (`PreToolUse`/`PostToolUse`/`Stop`/
`SessionEnd`) so a prompt can't bypass it.

- **Decision order (authority):** operator `always_allow:t1,t2` → registry `requires_approval`
  (authoritative when known) → verb heuristic (read-only verbs reversible; else irreversible).
- **By tier:** `execute_full` → allow all (pre-approved scopes); `execute_safe` → auto-run
  reversible, **propose** irreversible; `propose` → same shape, conservative default. **New agents
  start `propose`.**
- **Cost caps** (`cost.ts budgetDecision`): under cap → ok; over soft cap → **pause for
  re-approval**; ≥ cap×1.5 → **kill**. Per-tenant monthly budget + prepaid credit balance gate at the
  **claim** step (`canTenantRun`) — a depleted prepaid tenant claims no work. *(At many tenants, this
  per-tenant economic backpressure is what stops one tenant's runaway agent from draining the fleet.)*
- **When it MUST hit the Approvals inbox:** any irreversible/side-effecting tool under
  `propose`/`execute_safe`; any spend over the soft cap; **always** for the can't-fail list and the
  **workforce mutations** (spawn/pause/archive/reactivate agents). Approvals render to Slack + the
  dashboard with `{1A allow once, 1B always this run, none deny}`.

---

## 2. THE PER-AGENT DATA-RELAY EMISSION CONTRACT

**Inheritance:** the **canonical Relay event envelope + schema is owned by `AGENT-OS-PLAN.md`.** This
section defines the **agent's obligations against it** — which events every agent emits, when, with
what minimum payload — so that internal agents and the future external **GenX pixel** are *identical at
the source* (the pixel is just the same envelope over HTTP). One Relay, one schema, two ingress doors.

> Today this is fragmented across `run_activity` / `autonomy_events` / `audit_log` / `usage_events`
> with no shared envelope. The platform plan unifies them; this contract is what each agent feeds in.

### 2.1 What EVERY agent emits, and exactly when (the mandatory minimum)

Emitted by the **runtime/hooks**, not the prompt — uniform across all agents and all tenants:

| When | event_type | props (minimum) | today's partial equivalent |
|---|---|---|---|
| Run claimed/starts | `run.started` | trigger_source, scheduled_for, chain_id? | run_activity "start" |
| Knowledge retrieved | `knowledge.retrieved` | n_chunks, namespaces | run_activity "knowledge" |
| Before a tool call | `tool.proposed` | tool_name, input_hash, reversible | — |
| Gate decision | `gate.{allow\|propose\|deny}` | tool_name, rationale, autonomy | autonomy_events |
| Approval raised | `approval.requested` | proposed_action, options | approvals row |
| Approval resolved | `approval.decided` | option_key, decided_by | run_activity "decision" |
| After a tool runs | `tool.called` | tool_name, input_hash, result(ok/err) | audit_log |
| Model fallback | `model.fallback` | from_model, to_model, reason | run_activity "fallback" |
| Budget event | `budget.{warn\|pause\|kill}` | spend, cap, hard_ceiling | (status endpoint only) |
| Assistant output | `agent.message` | text (truncated), step | run_activity "assistant" |
| **Run ends (terminal)** | `run.completed` \| `run.failed` \| `run.skipped` | **the run-summary contract** + cost | `runs.summary` (unstructured) |
| Billable usage | `cost.metered` | tokens, raw_usd, billable_usd, credits | usage_events |

All carry the inherited envelope fields (`tenant_id`, `source='agent'`, `source_id=agent_key`,
`run_id`, `session_id`, `event_id` for idempotency, `occurred_at`/`received_at`, `schema_version`,
`context={agent_key, model, autonomy, trigger_source, chain_id, parent_event_id}`) — **as defined in
AGENT-OS-PLAN.md.**

### 2.2 `run_summaries` is the P0 emission target

The most important payload — currently missing as structured data — is the **run-summary contract**,
emitted as the `run.completed` event's `props` **and** persisted as the `run_summaries` row (the
persistent-memory tier, §1.5):

```
run_summary {
  what_i_did              # the actions taken this run
  what_i_produced         # paths/refs to artifacts (NOT inline blobs)
  what_i_learned          # signal for the learning loop (E.6) + memory-consolidator
  what_next               # continuity hint for the next run's bundle
  verification_result     # the self-check outcome (pass/fail + detail)
}
```

**Canonical: no run reaches a terminal state without emitting this** (SessionEnd hook →
`run_summaries` + Relay `run.completed`). This single P0 build closes three gaps at once: structured
persistent memory, run continuity into the bundle, and "emit back what every agent did."

### 2.3 Event vocabulary + schema governance (so the same agents × many tenants don't drift)

- **Registered event types** live in the platform's `relay_event_types` registry (owned by
  AGENT-OS-PLAN.md). This unifies the existing `event-schema-guardian` + `tool.event-schema-registry`
  to govern **internal agent events too**, not just the Meta pixel. Unregistered `event_type` →
  ingest **quarantines** (accepts + flags) and `event-schema-guardian` alerts; never silently drops,
  never auto-registers (new events need an engineer + a schema PR).
- **Versioning:** `schema_version` per event_type; readers tolerate old versions; producers bump on
  change; no in-place reshape.
- **Validation at the source:** the emitter validates `props` against the registered schema before
  emit (mirrors `_schema.ts`'s fail-loud posture). Same library, internal agent and external pixel.

### 2.4 Internal agent vs GenX pixel — identical at the source

- **Internal agent:** runtime hooks call `emit(RelayEvent)` in-process → insert to the spine.
- **GenX pixel (external SDK/brand, later):** the same envelope POSTed to the platform's relay ingest
  endpoint with a **tenant-scoped ingest key** (`source='pixel'`). Server validates envelope + `props`
  + tenant key, dedupes on `event_id`, inserts to the same table.
- **The only differences are ingress (in-process vs HTTP) and `source`/auth.** Envelope, schema,
  vocabulary, validation, storage are byte-identical — which is exactly what lets
  `attribution-reconciler` / `funnel-monitor` / `pixel-watcher` join agent actions to real-world
  outcomes without a second pipeline.

### 2.5 Privacy posture (baked into emission)

- **Per-agent, per-tenant at the source.** Every event carries `tenant_id` and is RLS-scoped; an
  agent emits only its own tenant's events.
- **Cross-tenant is aggregated/pattern-level + consented, never raw-shared.** Agents that look across
  tenants (e.g. `intel` spotting a winning creative angle) read an **explicitly aggregated,
  de-identified** view — never another tenant's raw rows. Raw cross-tenant reads must return zero rows
  (the RLS guarantee).
- **First-party / consented data only.** PII in `props` is minimized; PII-flagged fields are hashed
  by the emitter per the registry. **Nothing in this contract permits covert harvesting or turning the
  platform into a consumer reporting agency** — the pixel (when built) is first-party + consent-aware
  (`tool.13` Quiz/Form already encodes A2P consent norms).

### 2.6 Emitter conformance is part of the canonical spec

Extend `validateAgent` (§1.1) so an agent can't ship unless: it inherits the runtime emitter (free —
it's in the hooks) and any **custom** event types it emits are registered in `relay_event_types`. Keeps
"emit back what you did" a structural guarantee, not a per-prompt promise — essential when the same
agent runs across many tenants.

---

## 3. EXISTING AGENTS — inventory + improvement plan (optimized for many tenants, one fleet)

**93 agents seeded as data** across the doctrine's 8 domains, all on Hermes 4 405B, exported to
`exports/agents/*.md` + `managed-agents-registry.json`. They already share the anatomy (prompt +
skills + tools + MCPs + triggers + autonomy/budget). **Divergence from canonical is mostly at the
Relay + chaining layer, not per-agent** — which is good news for the scale target: one platform fix
lifts the whole fleet across every tenant at once.

### 3.1 Representative groups (what they do today)

| Group | Examples | Today | Canonical divergence |
|---|---|---|---|
| **Always-on monitors** (T-cheap) | connector-health-monitor, pixel-watcher, funnel-monitor, rate-limit-guardian, cash-position-monitor | cron/webhook; cheap up/down + triage | Emit only `run_activity`; no structured `run.completed`/Relay events. Highest run volume × N tenants → the biggest telemetry-cost + observability win from the spine. |
| **Reasoning workhorses** (T-reason) | intel, forecast-runner, expansion-finder, market-signal-scanner, vertical-scout | multi-step synthesis | Need `run_summary` continuity (read prior summaries) — currently stateless across runs. |
| **Can't-fail** | ad-claim-compliance, tenant-isolation-tester, security-anomaly-watchdog, contract-drafter, pricing-architect, offer-validator, code-writing agents | autonomy gated; eval cases seeded | **Model-policy conflict:** operator override runs these on Hermes; CLAUDE.md says "NEVER Hermes" for can't-fail. Resolve per-agent on eval evidence (Open Q). |
| **Chain participants** | E.1 spine (lead-triage→…→billing-runner), E.2 creative→launch, E.4 churn fan-in | triggers seeded in `agent_triggers` | **Events not emitted/routed at runtime** — the chain is declared, not executed. Closed by Inngest (P1). |
| **Meta-layer** | agent-architect (new), agent-onboarder, agent-evaluator, agent-retirer, skill-librarian, memory-consolidator, knowledge-curator | org-design + lifecycle + learning loop | `agent-evaluator` reads `agent_metrics` (works); the learning loop (E.6) depends on event routing (P1). |
| **Client-facing / fulfillment** | weekly-report, client-comms, onboarding-runner, client-health, the code/QA/docs/support agents | per-tenant via template clone | These are the agents most cloned across white-label tenants → they exercise the isolation + Relay attribution paths hardest. |

### 3.2 Prioritized improvement work

**P0 — platform, lifts all 93 across all tenants at once (do before scaling tenant/agent count):**
1. **Build `run_summaries` + the SessionEnd hook** → structured persistent memory + the
   `run.completed` Relay event for every agent. (§2.2)
2. **Stand up the Relay spine + emitter** (owned by AGENT-OS-PLAN.md); re-point
   `autonomy_events`/`audit_log`/`usage_events`/`run_activity` as projections. (§2)
3. **Feed recent run-summaries into `buildBundle`** → continuity for reasoning agents. (§1.3)
4. **Fleet-wide RLS audit** + re-run the cross-tenant zero-rows acceptance test on **every** table
   (esp. 0009/0010). **This is the hard gate for white-label** — see §4.2.

**P1 — chaining + boundary hardening (unlocks safe multi-tenant fulfillment at volume):**
5. **Inngest event router:** emit chain events from agent actions → route to subscribed
   `agent_triggers` → materialize the next run. Turns `_chains.ts` from data into behavior. (§4.5)
6. **Per-tenant + per-agent concurrency caps + backpressure** (new config) so one tenant can't
   starve the fleet. (§4.1)
7. **`tool_key → runtime SDK tool-name` map** → enforce `allowedTools` at the SDK boundary + fully
   registry-driven gating for MCP tools. (§1.3)

**P2 — per-agent polish:**
8. Author `allowed-tools` frontmatter on more SKILL.md files (least privilege is uneven today).
9. Expand eval cases beyond the 12 critical ones, esp. for chain participants + high-volume monitors,
   so promotion is evidence-driven at scale.
10. Resolve the can't-fail model policy with eval data, not by default (Open Q).

---

## 4. SCALE READINESS — the same agents across many tenants

The target is **N tenants running the proven fleet**, so "scale" = *isolation + observability + cost
control + safe handoff at volume*, not a bigger catalog.

### 4.1 Concurrency
- **Today:** one runner loop, `claimNextRun` with `FOR UPDATE SKIP LOCKED` (already collision-free for
  many workers). `RUNNER_AGENT_IDS` pins which agents a worker serves.
- **To scale across tenants:** run **N stateless runner workers** claiming from the shared `runs`
  queue (the DB is the coordinator — no new infra for the claim path). **Inngest** adds durable
  step-level retries, long runs surviving restarts, and event-driven fan-out.
- **Backpressure:** **per-tenant + per-agent concurrency caps** (new config, P1) so one tenant or one
  hot agent can't starve the rest; the prepaid balance gate + budget caps already provide economic
  backpressure per tenant.

### 4.2 Isolation between tenants — the hard P0 gate (owned model: AGENT-OS-PLAN.md)
- **Structural:** `tenant_id` on every row + RLS + per-tenant vault credentials + per-tenant MCP rows
  + tenant-namespaced vector store. The bundle only ever resolves one tenant's run.
- **Must prove, not assume:** the build-spec's zero-cross-tenant-rows test **fleet-wide incl.
  0009/0010 tables** (P0 #4). `tenant-isolation-tester` is a **hard gate** — **no scaling the tenant
  count until it passes.** When the GenX pixel arrives, its ingest key is a new external surface →
  tenant-scoped + rate-limited (`rate-limit-guardian`).
- **This is the #1 risk of the white-label model:** cloning one fleet across many tenants concentrates
  everything on the isolation boundary holding. The sequencing rule exists precisely for this.

### 4.3 Cost control
- **Per run:** `budget_cap_usd` (pause at soft cap, kill at ×1.5). **Per tenant:** monthly budget +
  prepaid credits (claim-gate enforcement). **Per fleet:** model tiering (70B carries volume, 405B
  carries thinking) — *note the operator override currently runs everything on 405B; the tier table is
  the fallback policy.* Metering turns every run into billable usage + credits. **Across many tenants
  the volume monitors dominate run count** → the cheapest safe tier + the Relay (to *see* cost per
  event/agent/tenant) is what keeps it affordable.

### 4.4 Observability
- **The Relay is the observability layer:** one queryable event spine → per-agent/per-tenant/per-chain
  dashboards, cost attribution, drift detection (`agent-evaluator`), schema drift
  (`event-schema-guardian`), infra health (`runner-ops`, `incident-responder`). **Canonical: if it
  isn't an emitted event, it didn't happen.** Debugging the same agent across hundreds of tenants is
  impossible without a complete, uniform event trail — which is why §2 is P0.

### 4.5 Series-of-agents: safe handoff + shared state (Inngest, green-lit)
- **Handoff = events, not direct calls.** Agent A emits a chain event (`lead.qualified`) → **Inngest**
  routes it to Agent B's trigger → B's run is materialized. No agent invokes another directly (keeps
  them decoupled, independently testable, independently autonomous). `_chains.ts` already declares the
  vocabulary + subscriber wiring; **Inngest is the missing executor.**
- **Shared state = the knowledge store + run-summaries + chain context**, never shared mutable memory.
  The envelope carries `chain_id` + `parent_event_id` so the whole series is reconstructable and
  attributable **within one tenant**. Hand-off payloads are written to knowledge/files and
  **referenced by path** in the event — never stuffed into the next agent's context.
- **Gates inside chains are first-class:** E.1 can't start onboarding before `first_payment.received`;
  E.2 can't launch before `ad-claim-compliance` passes. These are **event preconditions** the router
  refuses to cross until the gate event exists.
- **Loop/failure safety:** cycle detection + max-depth on `parent_event_id` so a misconfigured series
  can't fan out infinitely; a stalled chain is surfaced by its owner agent (`briefing` owns
  spine-health today).

---

## 5. HONEST GAP LIST (solid / fragile / missing before we scale)

**Solid (trust it):**
- Agents-as-data: 93 agents, versioned prompts, skills/tools/MCPs/triggers, idempotent seeders, record
  validation. The anatomy is real and clone-ready.
- The autonomy gate + cost caps + approvals + vault credential resolution — pure, hook-enforced,
  unit-tested, backend-agnostic. Safety doesn't depend on prompt compliance.
- The claim queue (`FOR UPDATE SKIP LOCKED`) — already concurrency-safe for many workers.
- Metering → credits, model fallback, workforce lifecycle, template-clone provisioning.

**Fragile (works, won't survive many-tenant scale as-is):**
- **Telemetry is four un-unified tables, no envelope or versioned vocabulary.** (Relay = fix.)
- **RLS coverage is partial / unproven on newer tables.** The isolation guarantee is the whole
  white-label bet; must be tested fleet-wide, not assumed. **Hard P0 gate.**
- **Single runner process; no durable executor.** Fine for one tenant, not for the same fleet × N.
- **Tool gating stops at the autonomy gate + prompt**, not the SDK boundary.
- **Model-policy contradiction** for can't-fail agents (Hermes override vs "never Hermes").

**Missing (must build before scaling):**
1. **`run_summaries` + SessionEnd hook** — structured persistent memory + `run.completed`. (P0)
2. **The Relay spine + emitter + type registry** (owned by AGENT-OS-PLAN.md; this contract feeds it). (P0)
3. **Run-summary continuity into the bundle.** (P0)
4. **Fleet-wide RLS audit + cross-tenant acceptance test.** (P0, hard gate)
5. **Inngest event router** — turns declared chains into executed series. (P1)
6. **Per-tenant + per-agent concurrency caps + backpressure.** (P1)
7. **tool_key → SDK tool-name map.** (P1)

**Sequencing (obeyed literally):** P0 (1–4) lifts all 93 agents and is the precondition for both
*seeing* and *isolating* the fleet across many tenants. **Do not 10× the tenant/agent count on
partially-proven isolation and no event spine.** P1 (5–7) is the precondition for running the same
fleet across many tenants safely as series. Adding tenants before P0 multiplies an un-observable,
partially-isolated fleet.

---

## Resolved this revision

- **Can't-fail model policy — RESOLVED (2026-06).** The operator override runs the whole fleet on
  Hermes 4 405B and explicitly supersedes the doctrine's "never Hermes" rule for the can't-fail list;
  re-tiering them to Claude needs an explicit operator instruction (not given). So we **keep
  all-Hermes** and move the safety guarantee to the **runtime gate**: a can't-fail agent **can never
  be auto-promoted past `autonomy=propose`** — every irreversible action keeps hitting the human
  Approvals inbox regardless of scorecard. Enforced in code, not prose: `CANT_FAIL_AGENTS` +
  `maxAutonomyForAgent` (`packages/shared`), the auto-promotion ceiling in `proposeAutonomyChange`
  (`packages/core/metrics.ts`, +15 pure tests), and a seed-time invariant
  (`seed-remaining-phases.ts` asserts every can't-fail agent sits at `propose`). Running a specific
  can't-fail agent on Claude remains a per-agent **config** change (set its `model`), never a code
  change. (Matches "safety via hooks, not the model" — doctrine non-negotiable #3.)

## Open questions for you
2. **`run_summaries` shape — final field set.** I've specced `{what_i_did, what_i_produced,
   what_i_learned, what_next, verification_result}`. Confirm, or add fields the learning loop / GenX
   attribution will need (e.g. an explicit `outcome` field for consented cross-tenant pattern-mining).
3. **Aggregation threshold for cross-tenant intelligence.** "Aggregated/pattern-level, consented" —
   what's the minimum cohort size (k-anonymity floor) before an `intel`-style agent may surface a
   cross-tenant pattern? This sets the Relay's de-identified-view policy and should match whatever
   AGENT-OS-PLAN.md fixes.
4. **Template-tenant governance.** Since white-label = clone the golden template, who owns promoting a
   change into the template (vs a single tenant's override), and does `agent-architect` propose
   template-level changes or only per-tenant ones? This decides how fleet-wide improvements roll out
   across many tenants.
