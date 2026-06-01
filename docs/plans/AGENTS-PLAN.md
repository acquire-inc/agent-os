# AGENTS-PLAN.md — Canonical Agent Anatomy, Telemetry Contract & Scale Plan

> **Status:** Planning only (no production code in this doc). **Date:** 2026-06-01.
> **Scope:** how every agent on the Agent OS is *defined, run, observed, and chained* — so we can
> confidently spin up hundreds and series-of-agents later. **Authority:** this is a *platform/agent
> contract* doc. On machinery it defers to `main-acqu-agent-doctrine.md`; on agent *behavior* it
> defers to v1/v2 doctrine. Where it proposes new platform structure it says so explicitly.

---

## 0. READ-FIRST RECONCILIATION — what I read and the conflicts I'm flagging

I read the live code (not just docs) before writing: `packages/db/src/schema.ts` (all tables),
`packages/core/src/{bundle,scheduler,lifecycle,autonomy,metering,workforce,cost,metrics}.ts`,
`apps/runner/src/{execute,hooks,config}.ts`, `apps/api/src/index.ts`, `scripts/seed/*` (the seeders +
`_chains.ts` + `_tools.ts`), the 93 `exports/agents/*.md`, the doctrine set, and `.planning/*`.

**Conflicts / corrections you should know before trusting anything downstream:**

1. **The two named docs do not exist in this repo.** There is no `AGENT-OS-PLAN.md` and no
   `CLIENTLY-2.0-RESOLVED-DIRECTION.md` (searched the whole tree). I reconciled against what *is*
   here: the build-spec (`docs/acqu-os-build-spec.md`), the doctrine trio, and `.planning/`. **If
   those two docs exist elsewhere, this plan must be re-reconciled against them** — flagging, not
   guessing. (Open question #1.)

2. **`org_id` vs `tenant_id`.** The brief says "multi-tenant by `org_id`." The codebase is
   multi-tenant by **`tenant_id`** (every table, the bundle, the claim path, RLS helper
   `is_tenant_member`). I treat **`tenant_id` ≡ `org_id`** and use `tenant_id` throughout to match
   reality. Renaming would be a large, risky migration for zero functional gain — **recommend we keep
   `tenant_id` and treat "org" as the product-facing word.** (Open question #2.)

3. **The "GenX pixel" does not exist yet, and "pixel" today means something else.** Every "pixel"
   reference in the repo is the **Meta tracking pixel** (`tool.11` Pixel Health, `pixel-watcher`,
   `event-schema-guardian`). There is **no unified internal-telemetry/pixel SDK**. So the brief's
   "treat agent telemetry and the GenX pixel as ONE pipeline" is a **net-new contract this doc
   defines** (§2), not something to reconcile. I'll name it the **Relay** to avoid colliding with the
   Meta-pixel meaning, and define the GenX pixel as the external SDK/brand over the same events.

4. **Telemetry today is fragmented across 4 tables, and there is no single event spine.** We have
   `run_activity` (freeform kind+message), `autonomy_events` (gate decisions), `audit_log` (tool
   calls), `usage_events` (billing). They share no envelope, no versioned schema, no typed event
   vocabulary. The build-spec *promised* a `run_summaries` table (§3, §5 SessionEnd hook) — **it was
   never built** (`runs.summary` text + `run_activity` rows stand in). This is the single biggest gap
   for "emit back what every agent did" (§2, §5-gap).

5. **RLS is real but partial.** `0001_init.sql` enables RLS + `is_tenant_member` policies on the
   original spine, and migrations 0003–0007 add policies for their tables. But **the tables added in
   0009/0010 (`agents.status`, `tenant_credits`, `usage_events`, `credit_ledger`) and several others
   need an RLS audit** — the build-spec's acceptance test ("tenant A sees zero rows of tenant B
   *across every table*") is **not currently proven for the newer tables**. Flagged in §4/§5.

6. **The runtime is single-process, not yet a fleet.** `apps/runner` is one Node loop that claims
   runs (`claimNextRun`, `FOR UPDATE SKIP LOCKED`) for a fixed `RUNNER_AGENT_IDS` set. There is **no
   Inngest yet** (the doctrine's intended durable executor), no event bus — handoff "chains" are
   *seeded as triggers* (`_chains.ts` → `agent_triggers`) but **nothing emits or routes the events**
   between agents at runtime. Series-of-agents is **designed in data, not yet wired in execution**
   (§4).

**What this means:** the *anatomy* below is ~80% already true in code (agents really are data +
versioned prompt + skills + tools + MCPs + triggers, run behind real autonomy/budget hooks). The
*telemetry spine* and the *event-routed chaining* are the two big builds standing between us and
"hundreds of agents."

---

## 1. THE CANONICAL AGENT ANATOMY

**The one rule (unchanged, load-bearing):** *an agent is DATA, not code.* Adding an agent is a
registry row + a versioned system prompt + skill files + tool/MCP bindings + trigger config. The
only per-agent code that is ever justified is a genuinely-new **deterministic tool** (shared across
agents). Everything below is the shape of that data and the runtime contract around it.

### 1.1 Definition — what an agent IS (the record)

An agent is the join of these rows, all carrying `tenant_id` (≡ org):

| Element | Table | Purpose |
|---|---|---|
| Identity + config | `agents` | key, name, **model** (fleet = `nousresearch/hermes-4-405b`), **backend** (`claude-agent-sdk`\|`managed-agents`), **thinking_level**, **autonomy** (`propose`\|`execute_safe`\|`execute_full`), **status** (`proposed`\|`active`\|`paused`\|`archived`), **budget_cap_usd**, **escalation_policy**, **knowledge_scope_json** (`{folders,tags}`), `runner_kind`, `enabled`, `template_id` (provenance for cloned tenants) |
| Versioned prompt | `agent_prompts` | append-only versions, exactly one `is_current`; `agents.persona` is the cached mirror the runner reads |
| Skills | `skills` + `agent_skills` | reusable SKILL.md playbooks with `allowed_tools_json` frontmatter (least privilege at the skill layer) |
| Tools | `tools` + `agent_tools` | deterministic tool catalog; binding = "this agent may call this tool"; each tool carries `requires_approval` + `reversible` |
| Connectors | `mcps` + `agent_mcps` | MCP servers (Close, Slack, Pipeboard×Meta, …); credentials resolved fresh + short-TTL at bundle time via the vault |
| Triggers | `agent_triggers` | `cron` \| `webhook` \| `state` \| `on_demand`; the scheduler/event-router materializes runs from these |
| Evals | `eval_cases` + `agent_metrics` | per-agent test set the `agent-evaluator` replays; daily scorecard drives promotion/demotion |

**Canonical agent spec (the template every agent conforms to)** — this is the existing seed shape,
named explicitly so new agents are authored against it:

```
AgentSpec {
  key, name                         # stable identity (kebab/dotted lowercase)
  persona / system_prompt           # versioned; header block: model-tier + rationale, bound MCPs,
                                     #   loaded skills, verification method (doctrine main §...)
  model = ACQU_AGENT_MODEL          # config not code; fleet override = Hermes 4 405B
  thinking_level                    # low|medium|high  (tier-derived: cheap→low, reason/critical→high)
  autonomy = "propose"              # NEW agents ALWAYS start here; promotion is earned from evals
  status = "proposed"               # NEW agents land proposed+disabled; a human activates
  budget_cap_usd                    # per-run hard cap; soft cap pauses, cap×1.5 kills
  escalation_policy                 # when/what hits the Approvals inbox; `always_allow:` pre-approvals
  knowledge_scope = {folders, tags} # what slice of the knowledge store it may retrieve
  skills[]                          # 1 primary function skill + safety skills
                                    #   (verification-before-completion always; clarify-before-acting if it acts)
  tools[]                           # declared in the prompt as tool.*; derived+bound by seed-tools
  mcps[]                            # connectors it needs, least-privilege
  triggers[]                        # cron / webhook / state / on_demand
  eval_cases[]                      # critical for can't-fail agents + high-volume monitors
}
```

**Validation gate (exists, `scripts/seed/_schema.ts`):** every agent record is validated before
seed — key shape, model-slug allowlist, autonomy/backend enums, prompt length, and the safety
invariant *irreversible ⇒ requires_approval*. **Canonical: no agent reaches the DB without passing
`validateAgent`.** Extend this with the Relay-contract checks in §2.6.

### 1.2 Instantiation — per tenant

Two paths, both already real:

- **Internal (Acqu, tenant #1):** seeders upsert agents idempotently (`upsertAgent` keyed on
  `tenant_id + key`). Re-running converges to the same state.
- **Client tenant (Cliently):** `provisionClientTenant` (core/provision.ts) **clones a template
  tenant's whole workforce** — agents + skills + MCP *definitions* + jobs + projects — with fresh IDs,
  remapped references, `template_id` provenance, and **credentials/runs deliberately NOT copied** (the
  client connects their own accounts; status starts `disconnected`).

**Canonical instantiation rule:** a new tenant is born by cloning a curated **template tenant**, not
by re-running doctrine seeders. The template tenant is the golden image; per-tenant customization is
overrides (model/thinking/budget/scope) on the cloned rows, never forks of code.

### 1.3 The think loop (plan → select → execute → self-check → retry → escalate)

This is the contract every run honors. It is enforced by the **runtime + hooks**, not by trusting the
prompt — so it holds for hundreds of agents regardless of what any prompt says.

1. **Bundle assembly (orchestrator, `buildBundle`).** For a claimed run, assemble: agent config +
   current prompt, bound skills (+their allowed-tools), bound tools (key/kind/requires_approval/
   reversible), MCP servers (+fresh short-TTL credentials), **knowledge retrieved from pgvector scoped
   to `knowledge_scope`**, pinned env vars (decrypted via vault), and the API callbacks. *(Gap: the
   bundle does not yet include recent `run_summaries` for continuity — build-spec §4 wanted this; see
   §5.)*
2. **Plan.** The system prompt carries the agent's workflow; thinking-level (high for reasoning/
   can't-fail) governs depth. Convention (in prompts today): write a one-line `plan.md` of the run's
   most important call.
3. **Tool selection — scoped two ways.** (a) **Per skill:** a skill's `allowed_tools_json` is the
   least-privilege set for that playbook. (b) **Per agent:** `agent_tools` is the hard ceiling — an
   agent may only call tools it's bound to. *(Residual gap: there's no `tool_key → runtime SDK
   tool-name` map yet, so SDK-level `allowedTools` restriction + fully registry-driven gating for MCP
   tools is not enforced at the SDK boundary — only the autonomy gate + prompt enforce it. §5.)*
4. **Execute (Runner, behind hooks).** `executeRun` routes on `backend`: SDK in-process loop, or
   Managed Agents (beta header). Same safety contract either way.
5. **Self-check.** `verification-before-completion` skill is canonical on every agent; can't-fail
   agents add domain linters (e.g. ad-ops checks rule-engine compliance + change-per-day before
   queuing). **Canonical: a run may not claim "done" without its verification step.**
6. **Retry.** Two real mechanisms: (a) **model fallback** — on a provider-availability error
   (Nebius is single-sourced) the runner retries once on `claude-haiku-4-5` (`model-fallback.ts`);
   (b) **manual run retry** — `retryRun` clones a failed run to a fresh scheduled one. *(Gap: no
   automatic step-level retry / durable resume across process restart — that's the Inngest build. §4.)*
7. **Escalate → Approvals inbox.** When the autonomy gate returns `propose` (see §1.6), the run
   raises an `approvals` row, records a `propose` autonomy event, and **suspends** (status `waiting`,
   persisting `sdk_session_id`). A human decides; the run resumes (`waiting → pending → running`) on the
   exact SDK session. Budget over the soft cap also escalates (pause for re-approval); cap×1.5 kills.

### 1.4 Skills, Functions, and tool/MCP access

- **Skills** are versioned SKILL.md files (content-hashed). They hold *playbook* + `allowed-tools`
  frontmatter. An agent holds 1 primary function skill + the safety skills. Skills are the unit of
  reuse across agents and the thing `skill-librarian` proposes/refines.
- **Functions** (doctrine v2: 8 domains, 26 functions) are the *business* grouping an agent serves —
  not a runtime object, but the map for *what agents should exist*. A function may be served by one
  agent or a small team; `agent-architect` (the new org-design agent) decides that shape.
- **Tools** are deterministic, shared, registry rows. **MCP tools** are external connectors.
  **Access is scoped by three gates, narrowest wins:**
  1. **Binding** (`agent_tools` / `agent_mcps`) — the agent can't see what it isn't bound to.
  2. **Skill allow-list** (`allowed_tools_json`) — least privilege within a playbook.
  3. **Autonomy tier × reversibility** (the runtime gate, §1.6) — *can it act without a human?*
- **Per-tenant connector scoping:** MCPs are per-tenant rows; credentials are per-tenant vault refs
  resolved fresh at bundle time. A cloned client tenant gets MCP *definitions* but must connect its
  own accounts — **cross-tenant credential bleed is structurally impossible if the vault namespace +
  RLS hold** (which §4/§5 says we must *prove*, not assume).

### 1.5 Memory — three distinct tiers (name them, don't conflate)

| Tier | Lifetime | Where it lives | Who writes/reads |
|---|---|---|---|
| **Short-term context** | one run | the SDK session (`sdk_session_id`) + the assembled Bundle | runtime; discarded on terminal status (except session id kept for resume) |
| **Persistent agent state** | across runs | **(gap) the missing `run_summaries`** + `runs.summary` + `agent_metrics` | lifecycle on completion; should feed the next bundle (continuity) — *not wired yet* |
| **Knowledge store** | durable, shared | `documents` + `doc_chunks` (pgvector, 1536-dim), namespaced `tenant/{id}/...`, scoped by `knowledge_scope` | `memory-consolidator` writes run memory as documents; retrieval at bundle time; `knowledge-curator` keeps it clean |

**Canonical memory rules:** (1) short-term never crosses runs except via an explicit summary; (2)
persistent state is **the run-summary contract** (what I did / produced / learned / next /
verification) — *this table must be built* (§5); (3) knowledge retrieval is always scope-limited and
tenant-namespaced; (4) **large tool outputs are written to files/knowledge and the path is returned —
never dumped into context** (doctrine non-negotiable #4).

### 1.6 Guardrails, cost caps, and the Approvals inbox (the autonomy gate)

The gate is **pure + backend-agnostic** (`autonomy.ts`) and runs in **hooks** (`PreToolUse` /
`PostToolUse` / `Stop` / `SessionEnd`), so an agent can't bypass it via its prompt.

- **Decision order (authority):** operator `always_allow:t1,t2` in escalation policy → registry
  `requires_approval` (authoritative when known) → verb heuristic (read-only verbs reversible; else
  irreversible).
- **By tier:** `execute_full` → allow all (pre-approved scopes); `execute_safe` → auto-run
  reversible, **propose** irreversible; `propose` → same shape, conservative default. **New agents
  start `propose`.**
- **Cost caps** (`cost.ts budgetDecision`): under cap → ok; over soft cap → **pause for
  re-approval** (don't discard incurred spend); ≥ cap×1.5 → **kill**. Per-tenant monthly budget +
  prepaid credit balance gate at the **claim** step (`canTenantRun`) — a depleted prepaid tenant
  claims no work.
- **When it MUST hit the Approvals inbox:** any irreversible/side-effecting tool under
  `propose`/`execute_safe`; any spend over the soft cap; **always** for the can't-fail list
  (compliance, tenant-isolation, security, contracts, pricing, offers, discounts, decision memos,
  reinvestment, risk register, code-writing) and the **workforce mutations** (spawn/pause/archive/
  reactivate agents). Approvals render to Slack + the dashboard with `{1A allow once, 1B always this
  run, none deny}` options.

---

## 2. THE DATA-RELAY CONTRACT (unified telemetry = internal + GenX pixel, one schema)

**Principle (the brief's non-negotiable):** internal agent telemetry and the external GenX "pixel"
are **ONE event pipeline with ONE schema, identical at the source.** The "pixel" is just the external
SDK/brand that emits the *same envelope* over HTTP; an internal agent emits the *same envelope*
in-process. **One emitter, one schema, two ingress doors.**

> **This is a net-new platform contract** (see §0 conflict #3/#4). Today's `run_activity` /
> `autonomy_events` / `audit_log` / `usage_events` are four un-unified tables. This section defines
> the spine that subsumes/relates them. I am specifying the contract; building it is §5 work.

### 2.1 The single event envelope (every event, internal or pixel, has exactly this shape)

```
RelayEvent {
  event_id      uuid          # client-generated; idempotency key (dedupe on this)
  schema_version int          # start at 1; events are versioned, never silently reshaped
  tenant_id     uuid          # ≡ org_id. REQUIRED. the isolation boundary.
  source        text          # 'agent' | 'pixel' | 'connector' | 'system'
  source_id     text          # agent key (internal) OR pixel install id / site id (external)
  session_id    text          # run sdk_session_id (internal) OR pixel session (external)
  run_id        uuid|null      # links agent events to a run; null for external pixel hits
  actor         text|null      # the human/agent/end-user that caused it (for attribution)
  event_type    text          # dotted vocabulary, registered (see 2.3). e.g. 'run.started',
                               #   'tool.called', 'gate.proposed', 'lead.qualified', 'page.viewed'
  occurred_at   timestamptz    # when it happened (emitter clock)
  received_at   timestamptz    # when ingest got it (server clock; skew detection)
  props         jsonb          # type-specific payload, schema-checked per event_type (2.3)
  cost          jsonb|null     # {tokens_in,tokens_out,cost_usd} when applicable
  context       jsonb|null     # {agent_key, model, autonomy, trigger_source, chain_id, parent_event_id}
}
```

Stored in **one append-only table `relay_events`** (partition by `received_at`, indexed by
`(tenant_id, event_type, occurred_at)` and `(tenant_id, run_id)`), RLS by `tenant_id`. The existing
specialized tables become **typed projections/materialized views** off this spine (or keep writing in
parallel during migration, then derive). Key identity: **`usage_events` = the `cost.*` projection;
`autonomy_events` = the `gate.*` projection; `audit_log` = the `tool.*` projection; `run_activity` =
the human-readable stream.** One source of truth, many read shapes.

### 2.2 What EVERY agent emits, and exactly when (the mandatory minimum)

Emitted by the **runtime/hooks** (not trusted to the prompt), so it's uniform across all agents:

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
| **Run ends (terminal)** | `run.completed` \| `run.failed` \| `run.skipped` | **the run-summary contract** + cost | runs.summary (unstructured) |
| Billable usage | `cost.metered` | tokens, raw_usd, billable_usd, credits | usage_events |

**The run-summary contract** (the most important payload, currently missing as structured data):
`{ what_i_did, what_i_produced (paths/refs), what_i_learned, what_next, verification_result }`. This
is both the `run.completed` event `props` **and** the persistent-memory row (§1.5) — write once,
serve both. **Canonical: no run reaches a terminal state without emitting this.** (SessionEnd hook +
`run_summaries`/relay = §5.)

### 2.3 Event vocabulary + schema governance (so 100s of agents don't drift)

- **Registered event types.** A `relay_event_types` registry (event_type, schema_version, json-schema
  for `props`, owner, status). This is the unification of the existing `event-schema-guardian` +
  `tool.event-schema-registry` — **but now it governs internal agent events too, not just the Meta
  pixel.** Unregistered `event_type` → ingest **quarantines** (accepts but flags) and `event-schema-
  guardian` alerts; never silently drops, never auto-registers (new events need an engineer + a
  schema PR — already the doctrine rule, now applied to the unified spine).
- **Versioning.** `schema_version` per event_type; readers tolerate old versions; producers bump on
  change. No in-place reshape.
- **Validation at the source.** The emitter library validates `props` against the registered schema
  before emit (mirrors `_schema.ts`'s fail-loud posture). Same library, internal and pixel.

### 2.4 Internal vs GenX pixel — identical at the source

- **Internal agent:** the runtime hooks call `emit(RelayEvent)` in-process → direct insert to
  `relay_events` (same transaction boundary as the run where it matters).
- **GenX pixel (external SDK/brand):** the pixel is a thin client that builds the **same RelayEvent**
  and POSTs it to `/api/relay/ingest` with a **tenant-scoped ingest key** (maps to `tenant_id`,
  `source='pixel'`). Server validates envelope + `props` schema + tenant key, stamps `received_at`,
  dedupes on `event_id`, inserts to the same table.
- **The only differences are ingress (in-process vs HTTP) and `source`/auth.** Envelope, schema,
  vocabulary, validation, and storage are byte-identical. A GenX pixel `page.viewed` and an internal
  `lead.qualified` are the same kind of row — which is exactly what lets `attribution-reconciler`,
  `funnel-monitor`, and `pixel-watcher` join agent actions to real-world outcomes without a second
  pipeline.

### 2.5 Privacy / tenancy on the relay

- `tenant_id` is mandatory and the RLS boundary; a pixel ingest key can only write its own tenant.
- PII in `props` is minimized + the emitter supports hashing fields flagged PII in the registry
  (the pixel must be GDPR/consent-aware — `tool.13` Quiz/Form already encodes A2P consent norms).
- Cross-tenant analytics (e.g. `intel` spotting a winning creative across tenants) reads an
  **explicitly aggregated, de-identified** view, never raw cross-tenant rows. (Open question #4.)

### 2.6 Emitter conformance is part of the canonical spec

Extend `validateAgent` (§1.1) so an agent cannot ship unless: it inherits the runtime emitter (free —
it's in the hooks), and any **custom** event types it emits are registered in `relay_event_types`.
This keeps "emit back what you did" a structural guarantee, not a per-prompt promise.

---

## 3. EXISTING AGENTS — inventory + improvement plan

**93 agents seeded as data** across the doctrine's 8 domains, all on Hermes 4 405B, exported to
`exports/agents/*.md` + `managed-agents-registry.json`. They share the anatomy already (prompt +
skills + tools + MCPs + triggers + autonomy/budget). Divergence from canonical is **mostly at the
telemetry + chaining layer**, not per-agent.

### 3.1 Representative groups (what they do today)

| Group | Examples | Today | Canonical divergence |
|---|---|---|---|
| **Always-on monitors** (T-cheap) | connector-health-monitor, pixel-watcher, funnel-monitor, rate-limit-guardian, cash-position-monitor | cron/webhook; cheap up/down + triage | Emit only `run_activity`; no structured `run.completed`/relay events. High run volume → biggest telemetry-cost win from the spine. |
| **Reasoning workhorses** (T-reason) | intel, forecast-runner, expansion-finder, market-signal-scanner, vertical-scout | multi-step synthesis | Need `run-summary` continuity (read prior summaries) — currently stateless across runs. |
| **Can't-fail** (Claude per doctrine; Hermes per operator override) | ad-claim-compliance, tenant-isolation-tester, security-anomaly-watchdog, contract-drafter, pricing-architect, offer-validator, cliently.dev | autonomy gated; eval cases seeded | **Model-policy conflict:** operator override runs these on Hermes; CLAUDE.md says "NEVER Hermes" for can't-fail. Per-agent eval evidence should decide; flag explicitly (Open Q #3). |
| **Chain participants** | E.1 spine (lead-triage→…→billing-runner), E.2 creative→launch, E.4 churn fan-in | triggers seeded in `agent_triggers` | **Events are not emitted/routed at runtime** — the chain is declared, not executed (§4). #1 functional gap. |
| **Meta-layer** | agent-architect (new), agent-onboarder, agent-evaluator, agent-retirer, skill-librarian, memory-consolidator, knowledge-curator | org-design + lifecycle + learning loop | agent-evaluator reads `agent_metrics` (works); the learning loop (E.6) depends on event routing (gap). |
| **Client-facing** (Cliently) | cliently.dev/qa/docs/support, weekly-report, client-comms, onboarding-runner | per-tenant via template clone | These are the GenX pixel's natural consumers — need the relay to attribute client outcomes. |

### 3.2 Prioritized improvement work (bring the fleet into spec)

**P0 — platform, lifts all 93 at once (do these before adding agents):**
1. **Build `run_summaries` + the SessionEnd hook** → every agent gets structured persistent memory +
   the `run.completed` relay event. (Closes §1.5 + §2.2 gaps; build-spec promised it.)
2. **Build the Relay spine** (`relay_events` + emitter in the hooks + `relay_event_types` registry +
   `/api/relay/ingest`). Re-point `autonomy_events`/`audit_log`/`usage_events`/`run_activity` as
   projections. (Closes §2.)
3. **Feed recent run-summaries into `buildBundle`** → continuity for reasoning agents. (Closes §1.3 #1.)
4. **RLS audit** of every table (esp. 0009/0010 additions) + re-run the cross-tenant zero-rows
   acceptance test fleet-wide. (Closes §0 #5.)

**P1 — chaining (unlocks series-of-agents):**
5. **Event router** (Inngest or a Postgres-backed event loop): emit chain events from agent actions →
   route to subscribed `agent_triggers` → materialize the next run. Turns `_chains.ts` from data into
   behavior. (Closes §0 #6, §4.)
6. **`tool_key → runtime SDK tool-name` map** → enforce `allowedTools` at the SDK boundary + fully
   registry-driven gating for MCP tools. (Closes §1.3 #3 residual.)

**P2 — per-agent polish:**
7. Author `allowed-tools` frontmatter on more SKILL.md files (least privilege is currently uneven).
8. Add/expand eval cases beyond the 12 critical ones, esp. for chain participants and high-volume
   monitors, so promotion is evidence-driven at scale.
9. Resolve the model-policy question for can't-fail agents (Open Q #3) with eval data, not by default.

---

## 4. SCALE-TO-HUNDREDS READINESS

### 4.1 Concurrency
- **Today:** one runner loop, `claimNextRun` with `FOR UPDATE SKIP LOCKED` (safe for *many* runners
  already — the claim is collision-free). `RUNNER_AGENT_IDS` pins which agents a worker serves.
- **To scale:** run **N stateless runner workers** (horizontal) each claiming from the shared `runs`
  queue; partition by agent set or let any worker claim any run. The DB queue is the coordinator;
  no new infra needed for the claim path. **Add: a durable executor (Inngest)** for step-level
  retries, long runs surviving restarts, and event-driven fan-out (the chain router).
- **Backpressure:** per-tenant + per-agent **concurrency caps** (new config) so one tenant or one hot
  agent can't starve the fleet; the prepaid balance gate + budget caps already provide economic
  backpressure.

### 4.2 Isolation between tenants
- **Structural:** `tenant_id` on every row + RLS + per-tenant vault credentials + per-tenant MCP
  rows + tenant-namespaced vector store. The bundle only ever resolves one tenant's run.
- **Must prove, not assume:** the build-spec's zero-cross-tenant-rows test **fleet-wide incl.
  0009/0010 tables** (P0 #4). `tenant-isolation-tester` is a **hard gate** before external launch —
  no external multi-tenant Cliently until it passes. The Relay's pixel ingest key is the new
  external surface → it must be tenant-scoped and rate-limited (`rate-limit-guardian`).

### 4.3 Cost control
- **Per run:** `budget_cap_usd` (pause at soft cap, kill at ×1.5). **Per tenant:** monthly budget +
  prepaid credits (claim-gate enforcement). **Per fleet:** model tiering (70B carries volume, 405B
  carries thinking) — *note the operator override currently runs everything on 405B; the tier table
  is the fallback policy.* **Metering** turns every run into billable usage + credits (the Cliently
  revenue path). At hundreds of agents, the **volume monitors dominate run count** → the cheapest
  safe tier + the Relay (so we can *see* cost per event/agent/tenant) is what keeps it affordable.

### 4.4 Observability
- The Relay **is** the observability layer: one queryable event spine → per-agent/per-tenant/per-chain
  dashboards, cost attribution, drift detection (`agent-evaluator`), schema drift
  (`event-schema-guardian`), infra health (`runner-ops`, `incident-responder`). **Canonical: if it
  isn't an emitted event, it didn't happen** — debugging hundreds of agents requires the event trail
  to be complete and uniform, which is why §2 is P0.

### 4.5 Series-of-agents: safe handoff + shared state
- **Handoff = events, not direct calls.** Agent A emits a chain event (`lead.qualified`) → router →
  Agent B's trigger materializes a run. No agent invokes another directly (keeps them decoupled,
  independently testable, independently autonomous). `_chains.ts` already declares the vocabulary and
  the subscriber wiring; **the router is the missing executor.**
- **Shared state = the knowledge store + run-summaries + chain context**, never shared mutable memory.
  A chain carries `chain_id` + `parent_event_id` in the envelope (`context`) so the whole series is
  reconstructable and attributable. Hand-off payloads are written to knowledge/files and **referenced
  by path** in the event — not stuffed into the next agent's context.
- **Gates inside chains are first-class:** E.1 cannot start onboarding before `first_payment.received`;
  E.2 cannot launch before `ad-claim-compliance` passes. These are **event preconditions**, enforced
  by the router refusing to materialize the downstream run until the gate event exists.
- **Loop/failure safety:** chains need cycle detection + a max-depth on `parent_event_id` so a
  misconfigured series can't fan out infinitely; a stalled chain is surfaced by the owner agent
  (`briefing` owns spine-health today).

---

## 5. HONEST GAP LIST (what's solid / fragile / missing before we 10×)

**Solid (trust it):**
- Agents-as-data: 93 agents, versioned prompts, skills/tools/MCPs/triggers, idempotent seeders,
  record validation. The anatomy is real.
- The autonomy gate + cost caps + approvals + vault credential resolution — pure, hook-enforced,
  unit-tested, backend-agnostic. Safety doesn't depend on prompt compliance.
- The claim queue (`FOR UPDATE SKIP LOCKED`) — already concurrency-safe for many workers.
- Metering → credits, model fallback, workforce lifecycle (recent, tested).
- Template-clone tenant provisioning.

**Fragile (works, but won't survive 10× as-is):**
- **Telemetry is four un-unified tables with no envelope or versioned vocabulary.** Debugging/billing/
  attribution across hundreds of agents needs the §2 spine.
- **RLS coverage is partial / unproven on newer tables.** The isolation guarantee is the whole product
  bet; it must be tested fleet-wide, not assumed.
- **Single runner process; no durable executor.** Fine for the current fleet, not for hundreds of
  concurrent + long-running + event-chained runs.
- **Tool gating stops at the autonomy gate + prompt**, not the SDK boundary (no tool_key→SDK-name map).
- **Model policy contradiction** for can't-fail agents (Hermes override vs "never Hermes").

**Missing (must build before 10×):**
1. **`run_summaries` + SessionEnd hook** — structured persistent memory + `run.completed` event. (P0)
2. **The Relay** — unified event spine + emitter + type registry + pixel ingest endpoint; internal
   and GenX identical at source. (P0)
3. **Run-summary continuity into the bundle.** (P0)
4. **Fleet-wide RLS audit + cross-tenant acceptance test.** (P0)
5. **Event router / durable executor (Inngest)** — turns declared chains into executed series. (P1)
6. **Per-tenant + per-agent concurrency caps + backpressure.** (P1)
7. **tool_key → SDK tool-name map** for boundary-level tool restriction. (P1)
8. **GenX pixel SDK** (the external client over the relay envelope) + tenant-scoped ingest keys +
   consent/PII handling. (P1, gated with external launch.)

**Sequencing:** P0 (1–4) lifts all 93 agents and is the precondition for *seeing* what hundreds of
agents do; P1 (5–8) is the precondition for *running* hundreds safely as series. Adding more agents
before P0 multiplies an un-observable, partially-isolated fleet — **don't 10× the count until the
Relay + RLS audit land.**

---

## Open questions for you

1. **The two missing docs.** `AGENT-OS-PLAN.md` and `CLIENTLY-2.0-RESOLVED-DIRECTION.md` aren't in
   this repo. Do they exist elsewhere (paste/point me)? This plan must be re-reconciled against them —
   especially if CLIENTLY-2.0 changes the tenancy model, the pixel/GenX direction, or the product
   surface.
2. **`org_id` vs `tenant_id`.** I'm treating them as identical and keeping `tenant_id` (the whole
   codebase + RLS uses it). Confirm we keep `tenant_id` internally and use "org" only as the product
   word — or do you actually want a rename migration?
3. **Can't-fail model policy.** Operator override runs the whole fleet (incl. ad-claim-compliance,
   tenant-isolation-tester, contracts, pricing, code-writing) on Hermes 405B; CLAUDE.md says these
   must be Claude. Do we (a) keep all-Hermes and let eval evidence promote specific agents to Claude,
   or (b) carve the can't-fail list back to Claude now? I recommend (a) — decide per-agent on eval
   data — but this is a risk call that's yours.
4. **GenX pixel scope + cross-tenant analytics.** Two sub-questions: (a) Is the GenX pixel for
   **client end-users' sites** (external web telemetry) or also an **internal** agent SDK, or both?
   (b) How aggressive is cross-tenant learning allowed to be — only de-identified aggregates, or
   richer (with consent)? This sets the privacy posture of the whole relay.
5. **Durable executor choice.** The doctrine names **Inngest**; we haven't adopted it. Green-light
   Inngest for the event router + retries, or do you want a Postgres-only event loop first (less infra,
   slower to scale)?
6. **Scale target + order.** Is "hundreds" *more distinct agent types*, or *the same agents across
   hundreds of tenants* (template clones), or both? The first needs the doctrine/architect + evals;
   the second needs the RLS audit + concurrency caps first. Tell me which is the near-term goal so I
   sequence P0/P1 accordingly.
