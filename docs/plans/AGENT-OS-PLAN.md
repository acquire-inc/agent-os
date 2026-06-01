# AGENT-OS-PLAN

> Planning document — no production code. Sibling docs `AGENTS-PLAN.md` and `GENX-PLAN.md` consume §8 (the Relay contract) and §2 (tenant isolation model) as their load-bearing inputs.
>
> **Reading map.** This plan reconciles the canonical sources in the repo:
> - `/home/user/agent-os/CLAUDE.md` — project non-negotiables, model tiers, can't-fail list.
> - `/home/user/agent-os/docs/main-acqu-agent-doctrine.md` — the machinery layer. **Precedence: main wins over v1/v2 on machinery.**
> - `/home/user/agent-os/docs/acqu-agent-doctrine-v2.md` — 8 domains, 26+10 functions, handoff chains (architecture/prompts only; machinery superseded by main).
> - `/home/user/agent-os/docs/acqu-agent-doctrine.md` — v1 detailed prompts (architecture/prompts only; machinery superseded by main).
> - `/home/user/agent-os/docs/acqu-os-build-spec.md` — control-plane / runner / safety hooks build sequence.
> - `/home/user/agent-os/docs/acqu-os-session-runbook.md` and `/home/user/agent-os/docs/HANDOFF-other-session.md` — operating refs.
> - `/home/user/agent-os/docs/agent-manager-spec.md`, `/home/user/agent-os/docs/specs/agent-architect.md`, `/home/user/agent-os/docs/superpowers/specs/2026-05-25-agent-os-design.md`.
> - The four phase manifests: `/home/user/agent-os/docs/acqu-phase-{1,2,3,4}-agent-manifest.md`.
>
> Codebase ground truth: migrations `0001_init.sql` … `0010_security_findings.sql` and the Drizzle mirror at `/home/user/agent-os/packages/db/src/schema.ts`.
>
> **Scope.** AgentOS, agents, and the GenX surface only. Where naming or scope in older drafts conflicts with the corrections below, this version is authoritative. The code uses `tenant_id` everywhere — this document does too. There is one internal telemetry contract: the **Relay**. (The word "pixel" in this stack always means the literal Meta Conversions API pixel used by ad-ops agents. The external GenX SDK is a *thin wrapper over the Relay*, defined in `GENX-PLAN.md`.)

---

## 1. Platform purpose and the three-stages mapping

### 1.1 Purpose

A multi-tenant Agent OS — the control plane that runs Acqu on agents and that is productized externally for paying tenants and (per the operator's framing) the public/white-label stage **GenX**. One monorepo (`agent-os/`), one Supabase project, one event pipeline (the Relay), one set of registries. Tenant rows and feature flags differentiate the stages.

The OS exists to enforce one rule (`CLAUDE.md`): **agents are DATA, not code.** The substrate is registries (agents/tools/MCP/skills/tenants) + knowledge (pgvector) + scheduler + orchestrator + safety hooks + observability. The runtime is swappable behind a `Runner` interface; v1 is the Claude Agent SDK over OpenRouter (`main` §1.2). Adding an agent is normally a configuration operation — usually zero new application code (`acqu-os-build-spec.md` §0).

### 1.2 The three stages — *one platform, three modes*

| Stage | Who runs it | `tenants.type` | Auth | Connector OAuth | Telemetry posture | Hard gates that must pass |
|---|---|---|---|---|---|---|
| **Internal (Acqu)** | Us, for ourselves (tenant #1) | `internal` (existing value — `0001_init.sql:58`) | Supabase Auth + `tenant_members` (`0001_init.sql:65`) | Built-in `oauth_credentials` vault (`0001_init.sql:270`, `AOS_VAULT_KEY`) | Relay events → internal dashboards. `consent_scope='tenant_only'` for all rows. | None — Acqu pays the cost of mistakes |
| **White-label (paying tenants)** | DFY clients we sell to | `client` (existing value, `0001_init.sql:58` check constraint) | Supabase Auth + `tenant_members`; admin API key per tenant | Nango behind the same connector interface (Main §2.4); vault stays as fallback during connector-by-connector migration | Same Relay; events tagged `tenant_id`, surfaced to tenant via white-labelled dashboard. Tenant opts in per-event to `cross_tenant_aggregated`. | `ad-claim-compliance`, `dunning-manager`, `tenant-isolation-tester` (the three hard gates, `v2` §F) |
| **Public / GenX (self-serve)** | Anyone with a sign-up | A new value — **proposed: `public`** added to the `tenants.type` check constraint (open question on the name) | Supabase Auth signup; first-class `tenant_members.role='owner'` on org creation | Nango required (no operator hand-holds OAuth at signup) | Same Relay + the external **GenX SDK** that wraps the Relay's ingest endpoint with a tenant API key. Consent fields are mandatory at ingest. | All three hard gates plus D5.3 security agents green, consent boundary enforced end-to-end |

The discriminator in Postgres is one column (`tenants.type` — `0001_init.sql:58` / `packages/db/src/schema.ts:29`). Stage-specific behavior is feature flags + config, **not** different tables, schemas, or code paths.

### 1.3 What changes per stage, table by table

Exhaustive for every tenant-scoped table that exists today. *Per-stage* changes are limited to: who can read/write the row, which OAuth backend stores the credential, which model override is applied, and which Relay consent tags emit.

| Table (migration · schema line) | Internal (Acqu) | White-label (`client`) | Public (GenX / `public`) |
|---|---|---|---|
| `tenants` (`0001_init.sql:54` · `schema.ts:25`) | One row, `type='internal'`. `monthly_budget_usd` set by founder. `default_model_override` (added `0009`) NULL or set to `nousresearch/hermes-4-405b` per `HANDOFF-other-session.md` §2 (see Open Q on Hermes/can't-fail contradiction). | One row per client. `type='client'`. `monthly_budget_usd` becomes the billing meter. Tenant-wide model override usually unset (run can't-fail agents on Opus). | One row per signup. `type='public'`. `monthly_budget_usd` defaults from plan tier; hard cap enforced. |
| `tenant_members` (`0001_init.sql:65`) | Founder + ops humans. Roles: `owner`, `admin`, `member`, `viewer`. | Client primary user is `owner`; Acqu account managers can be added with `admin`. | Signup creates `owner`; self-serve invite UX adds `admin`/`member`. |
| `projects` (`0001_init.sql:85` · `schema.ts:49`) | Acqu's internal projects (Ad-Ops, Founder Ops, etc., per `acqu-os-build-spec.md` §3). | Each client's project structure mirrors their service tier. | Each public tenant starts with one default project. |
| `agents` (`0001_init.sql:112` · `schema.ts:73`) | Seeded by `scripts/seed/acqu-*.ts` (Phases 1-4; manifests at `docs/acqu-phase-{1,2,3,4}-agent-manifest.md`). | Subset of Acqu agents seeded per tenant based on service tier. Tenant cannot create agents directly. | Tenants build their own via the Architect (`POST /api/admin/architect/propose`, `docs/specs/agent-architect.md`). All new agents land `autonomy='propose'`, `enabled=false`, `lifecycle_state='draft'` (`0009`). |
| `agent_prompts` (`0004`) | Versioned by hash inside `packages/core/src/seed/seedAgent.ts`. | Same — tenants see read-only history. | Architect writes v1; remix writes v2+. |
| `agent_triggers` (`0005`) | Cron + event triggers from doctrine. | Cron schedules may differ per client timezone (Open Q on `tenants.timezone`). | Public users edit triggers from the UI; UI gates impossible schedules. |
| `agent_skills`, `agent_mcps`, `agent_tools` (joins) | Doctrine-defined bindings. | Bindings tied to that tenant's connected MCPs only — least-privilege per `access-auditor` D5.3. | Same; UI prevents binding to an MCP the tenant hasn't connected. |
| `skills` (`0001_init.sql:234` · `schema.ts:196`) | `scope='global'` rows from the Superpowers + custom-ops library; on-disk `SKILL.md` (Main §3.1). | Same global rows visible (`scope='global'`); per-tenant overrides go to `scope='project'`. | Same. `skill-librarian` (D6.2) proposes new ones across all stages. |
| `mcps` (`0001_init.sql:254` · `schema.ts:211`) | Internal MCPs (Close, Pipeboard, Slack, Drive, GitHub, n8n) — one row per Acqu account. | One row per *tenant's* connection. `oauth_credentials.vault_ref` may point to Nango at productization (Main §2.4). | Same — Nango required from day one. |
| `tools` (`0007`) | All custom + MCP tools registered; `requires_approval` per doctrine. | Same registry; agents bind by `tool_key`. | Same. See §4 on global-vs-tenant registry definitions. |
| `oauth_credentials` (`0001_init.sql:270`) | Always internal vault. | Vault initially; per-connector migration to Nango (Main §2.4). Never rip out vault. | Nango from the start. |
| `env_vars` (`0001_init.sql:281`) | Founder-managed; `pinned=true` carries org-wide secrets. | Per-tenant env vars set by account manager. | Per-tenant env vars set in the UI; encrypted via `AOS_VAULT_KEY`. |
| `knowledge_folders`, `documents`, `doc_chunks` (`0001_init.sql:293-326`) | `kb:` tree per Main §5 + doctrine. | Each tenant has its own `kb:` tree; cross-tenant retrieval is RLS-impossible (see §2). | Each public tenant starts empty. Cross-tenant retrieval must return zero rows even via the vector path. |
| `runs`, `run_activity` (`0001_init.sql:181-215`) | All runs visible to founder. | Visible to tenant. Acqu support sees with `admin`. | Visible to tenant only. **Migration target for the Relay (§8).** |
| `approvals` (`0001_init.sql:347`) | Slack mirror to Acqu channel. | Slack mirror per tenant. | In-app inbox + optional email/Slack per tenant config. |
| `autonomy_events` (`0003`) | Always-on audit of `propose`/`allow`/`deny`. | Same. | Same. **Migration target for the Relay (§8).** |
| `audit_log` (`0001_init.sql:363`) | Append-only PostToolUse audit. | Same. | Same. **Migration target for the Relay (§8).** |
| `architect_blueprints` (`0006`) | Founder uses Architect for "remix" runs. | Account managers use Architect to propose teams for tenants. | The primary "build your team" surface — every public tenant starts here. |
| `security_findings` (`0010`) | Acqu's own posture. | Per-tenant; tenant sees a redacted view. | Per-tenant; must be empty / acknowledged before public launch (gate per `09-CONTEXT.md`). |
| **NEW** `relay_events` (§8 — P0) | All Acqu instrumentation; `consent_scope='tenant_only'` by default. | Tenant agents + app emit. Tenant opts in row-level to `cross_tenant_aggregated`. | External GenX SDK writes here via a tenant API key. |
| **NEW** `run_summaries` (§8 — P0, explicit deliverable) | One row per terminal run; canonical outcome envelope. | Same. | Same. |

Three things to call out:

1. **`tenants.type` is the entire stage discriminator.** The only schema change needed is widening the check constraint to allow `'public'`. No separate fork, no separate Supabase project.
2. **Per-tenant model override (`0009`) is the per-stage knob for cost on NON-CRITICAL tiers.** The override is a seed-time rewrite (`packages/core/src/seed/seedAgent.ts` reads `tenants.default_model_override`). It applies to T-cheap / T-reason / T-work agents only. **T-critical (can't-fail) agents are EXEMPT** — the seed function MUST skip the override when `isCantFail(spec.key)` is true, and the runner MUST emit a `cantfail.model_violation` Relay event and fail closed if a T-critical agent is ever dispatched on a non-Opus model. Tier wins, override loses. See Open Question #1 (RESOLVED) for the implementation contract.
3. **Architect is the productized seed path for stages 2 and 3.** The Acqu doctrine seeds (Phases 1-4) are *internal only*. Other tenants get agents either by tiered template-copy or by Architect. The doctrine isn't a UX — Architect is.

---

## 2. Multi-tenant data model

### 2.1 The two enforcement layers

The platform has **two** independent fences. Both must hold; a hole in either is a breach.

**Layer 1 — Postgres RLS via `is_tenant_member()`.** Implemented in `supabase/migrations/0001_init.sql:74` as a `security definer stable` function that resolves `auth.uid()` against `tenant_members`. Every tenant-scoped table is wrapped in `enable row level security` + a `tenant_rw` policy that calls `is_tenant_member(tenant_id)`; join tables without their own `tenant_id` (`job_refs`, `agent_skills`, `agent_mcps`) authorize via a `select 1 from <parent>` exists-check. See `0001_init.sql:409-453` for the per-policy wiring.

This layer covers every read or write that flows through a connection authenticated as a Supabase user. The acceptance test the build-spec demands (`acqu-os-build-spec.md` §3) — *a query authenticated as tenant A returns zero rows from tenant B across every table including the vector store* — is exactly what `tool.rls-test` (Phase 9 — `packages/tool-rls-test/`) automates and what `tenant-isolation-tester` (D5.3) runs daily.

**Layer 2 — server-side allowlist in the Runner.** RLS is bypassed by the service-role connection the runner uses (`DATABASE_URL` in `apps/runner`). The runner must therefore enforce tenant scope in code:

- `claimNextRun(db, agentId, tenantId, runner)` (`packages/core/src/claim.ts:24`) requires both `agentId` *and* `tenantId` in the SQL `where`. An agent claim never crosses tenants.
- `buildBundle(db, runId, baseUrl, opts)` (`packages/core/src/bundle.ts:76`) hydrates everything from `run.tenantId`. Knowledge retrieval is scoped via the agent's `knowledge_scope_json` folders (`bundle.ts:107`); the underlying `retrieve()` in `packages/core/src/knowledge.ts:93` is constrained `where tenant_id = ${args.tenantId}`. The vector retrieval cannot cross tenants by construction.
- `deriveAllowedTools(bundle)` in `apps/runner/src/custom-tools.ts:122` derives the explicit SDK `allowedTools` list from the agent's bindings. Pitfall 5 from `09-PATTERNS.md`: never leave `allowedTools` unset — that lets the model call ANY tool. The runner enforces this on every session.
- The runner's `/next` endpoint refuses work for any agent whose `lifecycle_state !== 'active'` (`HANDOFF-other-session.md` §1; `apps/api/src/index.ts`). The lifecycle check is per-request.

### 2.2 The RLS test infrastructure already in the repo

`packages/tool-rls-test/` (per `09-CONTEXT.md` D-02) opens a **separate** non-service-role connection (`RLS_TEST_DATABASE_URL`) and sets `auth.uid()` per-test via `SET LOCAL`. This is the only correct way to verify RLS — running against the service-role connection would make every cross-tenant query trivially succeed (Pitfall 1 in `09-CONTEXT.md` D-01). 32 attack vectors are registered in `packages/tool-rls-test/src/attack-vectors.ts` and exercised by `tenant-isolation-tester` (D5.3).

This is the **load-bearing gate** for white-label and public launch. Per `CLAUDE.md` non-negotiable #5 and `09-CONTEXT.md` D-06: "an isolation-test run dispatched against live Supabase with 2+ tenants returns ZERO cross-tenant leaks." This is hard gate #2.

The runner-dispatched `tool.rls-test` (registered in `customToolDispatch` at `apps/runner/src/custom-tools.ts:90`) uses the service-role connection for cron sanity-checking only; HARD GATE verification uses `scripts/verify/isolation-live.ts` with `RLS_TEST_DATABASE_URL` (plan 09-06). False-pass is caught by positive controls in `attack-vectors.ts`.

### 2.3 What is shared (global registries) vs tenant-scoped

Current state in `0001_init.sql`:

- **`skills.tenant_id NOT NULL`** (line 234) — every skill row is per-tenant. `scope='global'` is a column but the row is tenant-owned. Seed scripts insert one skill row per tenant for "global" skills.
- **`mcps.tenant_id NOT NULL`** (line 254) — every MCP connection is per-tenant. Correct (credentials live per-tenant).
- **`tools.tenant_id NOT NULL`** (`0007_tools_registry.sql`) — every tool *registration* is per-tenant. The *definition* (input schema, what it does) is tenant-invariant.
- **`architect_blueprints.tenant_id NOT NULL`** (`0006`) — correctly per-tenant.

The maintenance question: should the *definitions* of skills and tools live in a global `skill_defs` / `tool_defs` table and have `skills`/`tools` join to it? A bug fix in `skill:verification-before-completion` is currently an N-row update across tenants. This refactor is real and touches the seed scripts — see Open Question. It is **P1, not P0** — the existing registries work for the 50+ seeded agents. Expansion is not the blocker.

### 2.4 What the runner sees — and the "hundreds of agents" model

The runner is `apps/runner/`. It runs per a `RUNNER_AGENT_IDS` env-var allowlist (`apps/runner/src/config.ts:17`) — each runner process is bound to a specific set of agents in a specific tenant.

**"Hundreds of agents" means the same agents × many tenants** (white-label fulfillment), NOT hundreds of novel agent types. The operational shape:

- One **shared** runner fleet for Acqu's agents (`runnerKind='local'`).
- Optionally a runner pool per high-value tenant (`runnerKind='remote'`) for cost attribution and blast-radius isolation.
- For public/GenX: one large shared pool with hard per-tenant concurrency caps (§7 — Open Q on enforcement).

A single Inngest function instance (`packages/inngest/src/functions/runScheduled.ts`) safely handles many tenants because every step in the chain — claim, bundle, execute, hooks — is keyed by `(agentId, tenantId)` and `runId`. The `claim_next_run()` SQL function in `0001_init.sql:391` uses `FOR UPDATE SKIP LOCKED` so concurrent runners never collide on the same row.

This sequencing matters for §9: scaling to "hundreds of agents" doesn't require expanding the registry — the registry already works for the 50+ seeded agents. It requires (a) proving fleet-wide RLS isolation (Phase 9 in progress) and (b) the Relay (§8 — P0). The two P0 gates are what unblock the multi-tenant scale.

---

## 3. Agent runtime

### 3.1 The loop, with file cites

The scheduler → claim → bundle → runner loop is implemented and shipped (Phases 1-8.5, per `HANDOFF-other-session.md`):

1. **Materialization** — `packages/core/src/scheduler.ts:18` `evaluateDueJobs(db, now)` walks every enabled job, computes the previous cron tick (`packages/core/src/cron.ts`), and inserts a `runs` row with `status='scheduled'`. Idempotent via `gte(runs.scheduledFor, tick)`.
2. **Inngest delivery** — `packages/inngest/src/functions/runScheduled.ts` listens for `agent/scheduled.run` events emitted by pg_cron (migration `0008_pg_cron_to_inngest.sql`) and dispatches them in parallel. This replaces the original Postgres-table worker loop (Main §2.1). **Confirmed decision: Inngest carries both the Relay event bus AND the agent chain routing.**
3. **Claim** — `packages/core/src/claim.ts:24` `claimNextRun(db, agentId, tenantId, runner)` updates the row to `status='running'` under `FOR UPDATE SKIP LOCKED`. Pending (resumed-from-approval) rows are claimed before scheduled ones.
4. **Bundle** — `packages/core/src/bundle.ts:76` `buildBundle(db, runId, baseUrl, opts)` assembles the agent row, job row, scoped docs, skills, MCPs (with fresh short-TTL credentials via `opts.resolveToken`), tools, knowledge chunks (via `opts.retrieveKnowledge`), env vars (decrypted via `opts.decryptEnv` from the vault), and an `api.{statusUrl,activityUrl,approvalsUrl}` set the runner uses to call back.
5. **Execute** — `apps/runner/src/execute.ts` builds the system prompt (`buildSystemPrompt`) and dispatches to the Claude Agent SDK (live path) or the dry-run simulator. The Anthropic gateway is OpenRouter via `ANTHROPIC_BASE_URL=https://openrouter.ai/api` (Main §1.2; `HANDOFF-other-session.md` §6). `allowedTools` is set via `deriveAllowedTools(bundle)`.
6. **Safety hooks** — `apps/runner/src/hooks.ts`. PostToolUse writes `audit_log` and an `allow` autonomy event. PreToolUse runs `autonomyGate({toolName, autonomy, escalationPolicy})` from `packages/core/src/autonomy.ts`; a `propose` decision creates an `approvals` row, posts an autonomy event, and parks the run in `status='waiting'` with `sdkSessionId` recorded for resume. Stop / SessionEnd writes the run summary and finalizes cost (`packages/core/src/lifecycle.ts`).

### 3.2 Sandboxing

The doctrine names `sandbox_name` on the agent registry row (`acqu-os-build-spec.md` §3) but the current schema in `0001_init.sql:112-133` does **not** carry a sandbox field. The runner runs the agent as a child process; there is no hard OS sandbox. Defenses today:

- The Agent SDK's `permissionMode` per autonomy: `bypassPermissions` for `execute_full`, `acceptEdits` for `execute_safe`, `plan` for `propose`.
- `deriveAllowedTools` constrains `allowedTools` to exactly the bundle's bound tools.
- The SSRF guard in `packages/tool-browser/src/index.ts` (Main §2.2).
- The approval gate (the SDK cannot *complete* an irreversible call without an `approvals` row decision when autonomy is `propose|execute_safe`).

Each runner is per-tenant-scoped via `RUNNER_AGENT_IDS`; cross-tenant blast radius from a compromised runner is one tenant. Open Q on whether public-stage runners run inside ephemeral Browserbase sandboxes or Cloud Run jobs.

### 3.3 Retry, cost cap, concurrency

- **Retry.** Inngest provides step-level retry (Main §2.1). A stuck run is killed and requeued once by `runner-ops` (`v2` D5.2); a second stall quarantines.
- **Cost cap (per run).** `agents.budget_cap_usd` (`0001_init.sql:126`) is the per-run cap. SessionEnd writes the final `runs.cost_usd`. **Gap:** `checkBudget` in `packages/core/src/cost.ts:46` checks the *monthly tenant* budget against `runs.cost_usd` sum; in-flight per-run enforcement is partial. See §7.
- **Concurrency.** Per-tenant concurrency caps don't exist as a column. The implicit limit is the number of runners × `RUNNER_AGENT_IDS`. The missing primitive is `tenants.max_concurrent_runs` + a count check in `/next`. Flagged.

### 3.4 Scaling envelope

Each agent is a row in `agents`. Each run is a row in `runs`. Cron/Inngest path is O(jobs × tenants). Bottlenecks, in order:

1. **Postgres connection ceiling** — `claim_next_run` is lockless (`FOR UPDATE SKIP LOCKED`); use Supabase transaction-pooler endpoint.
2. **Model spend per tenant** — almost always the binding constraint before DB. Tier matrix in `CLAUDE.md` + per-tenant override (`0009`) is the lever.
3. **Inngest step volume** — per-step pricing. Profile early.
4. **`is_tenant_member()` join cost** — `security definer stable` function on every RLS query. Indexed via `tenant_members_user_idx` (`0001_init.sql:71`).

---

## 4. Registries (P1 — the existing layer already works for the 50+ seeded agents)

The registry layer is shipped. This section documents what exists; expanding it is **P1**, not the blocker. The blockers (P0) are §8 (Relay) and the fleet-wide RLS audit (§2.2).

### 4.1 Skill registry

- **Schema.** `skills` (`0001_init.sql:234`, `schema.ts:196`) with `tenant_id`, `key` (unique per tenant), `source ∈ {github,builtin,custom}`, `repo_path`, `scope ∈ {global,project}`, `version`.
- **Binding.** `agent_skills` (`0001_init.sql:144`).
- **Discovery — current.** `packages/core/src/seed/seedAgent.ts` resolves SKILL.md files from a `skillSource` (disk path under `external/acqu-skills/`). Missing files still register with `version='0.0.0'` (tolerated by design — `HANDOFF-other-session.md` §7).
- **Discovery — future.** GitHub sync (Main §3.1 + original superpowers spec) — schema fields wired, worker not built. `skill-librarian` (D6.2) proposes new skills.

### 4.2 MCP registry

- **Schema.** `mcps` (`0001_init.sql:254`, `schema.ts:211`) + `oauth_credentials` (line 270).
- **Binding.** `agent_mcps` (line 150).
- **Discovery.** `ensureMcp` mirrors `ensureTool` (Main §2.5).
- **Credential resolution at run time.** `buildBundle` calls `opts.resolveToken(mcpId)` (`bundle.ts:151`) — runner-injected resolver hits the vault (or Nango) and returns a fresh short-TTL token. A long-lived token in the bundle is a finding for `secrets-rotation` (D5.3).
- **Stage 2/3 swap.** Internal stays vault; client/public switches `resolveToken` to a Nango-backed implementation per connector. Migrate connector-by-connector; vault stays as fallback.

### 4.3 Tool registry

- **Schema.** `tools` (`0007_tools_registry.sql`, `schema.ts:226`) + `agent_tools` join.
- **Kinds.** `kind ∈ {custom, mcp}`. Custom tools are deterministic functions in `customToolDispatch` (`apps/runner/src/custom-tools.ts:79`); MCP tools are projections.
- **Discovery.** `ensureTool(db, spec)` in `packages/core/src/seed/` upserts by `(tenantId, key)`.
- **Approval flags.** `requires_approval` + `reversible` are columns; `autonomyGate` reads them.

### 4.4 OAuth vault

- **Today.** `oauth_credentials.vault_ref` (`schema.ts:245`) points to an entry encrypted with `AOS_VAULT_KEY` (env). Per-tenant scoping by FK to `mcps`.
- **At productization (Main §2.4).** Nango behind the same connector interface. Decision rule: internal-only speed → Composio acceptable; anything client-facing → Nango. Vault stays as fallback; migration per-connector.

---

## 5. Knowledge store + retrieval

### 5.1 Tables and lineage

- `knowledge_folders` (`0001_init.sql:293`) — folder tree, self-referential parent.
- `documents` (`0001_init.sql:303`) — name, type, `source ∈ {upload, drive-sync, agent-generated, call-transcript}`, `vector_indexed`.
- `doc_chunks` (`0001_init.sql:319`) — `embedding vector(1536)`, with `vector_namespace`.
- All three carry `tenant_id` and are RLS-protected via `tenant_rw` (`0001_init.sql:432`).

### 5.2 Indexing path

`packages/core/src/knowledge.ts:63` `indexDocument(db, embedder, args)` chunks via paragraph/sentence boundaries (1200 char default, 150 overlap) and writes `doc_chunks`. Dev embedder is deterministic hashed bag-of-words. Production swap pending (Open Q — Voyage / OpenAI / Cohere).

### 5.3 Retrieval path — and the Rerank 4 Pro lever (Main §1.4)

`retrieve(db, embedder, args)` at `knowledge.ts:93` does cosine-distance search constrained to `tenant_id` + optional `namespaces` (the agent's `knowledge_scope_json.folders`). The bundle assembles knowledge via `opts.retrieveKnowledge` (`bundle.ts:111`).

**Rerank 4 Pro slot.** Per `CLAUDE.md` model tiering + Main §1.4: after vector retrieval, candidates pass through Rerank 4 Pro and the top-K reranked chunks land in the bundle. Independent of the chat-tier plan. **Currently not implemented** — a `rerank` hook on the `retrieve()` return is the cleanest insertion point.

### 5.4 Write-back: agents grow the KB

`packages/core/src/lifecycle.ts` already writes each terminal run's summary as a `run-summary_*` document under a memory namespace. This is the inbound side of the learning loop (`v2` §E.6). `memory-consolidator` (D6.2) reads those summaries and proposes durable lessons. Today the consolidator is seeded as data; the consolidation engine (`tool.memory-consolidation-engine`) is **not yet a deterministic tool** — it's prompted from the agent.

### 5.5 Tenant scoping is enforced at three layers

1. RLS on `documents` and `doc_chunks` (`0001_init.sql:432`).
2. The `where tenant_id = ${args.tenantId}` filter in `retrieve()` (`knowledge.ts`).
3. The `tool.rls-test` (`packages/tool-rls-test/`) tests cross-tenant vector retrieval explicitly.

A prompt-injection attempt from one tenant's data trying to make an agent retrieve another tenant's chunks is foreclosed by the runner-side scope — the agent never sees a query function that accepts an arbitrary `tenant_id`.

---

## 6. Governance — *part of the Relay migration; remains legacy until cutover*

### 6.1 Autonomy tiers

Three values on `agents.autonomy` (`0001_init.sql:123`): `propose | execute_safe | execute_full`. Decided in `packages/core/src/autonomy.ts:50` `autonomyGate({toolName, autonomy, escalationPolicy})`:

- `execute_full` → `allow`.
- `execute_safe` and `propose` → `allow` for reversible (read-only verb prefix list), `propose` for irreversible.
- `escalation_policy` can carry `always_allow: tool1, tool2` to whitelist irreversible tools.

New agents seed at `autonomy='propose'`. Promotion is **earned from eval/approval-rate metrics**, not granted by the prompt (`CLAUDE.md` non-negotiable #1).

### 6.2 Approvals inbox

- **Schema.** `approvals` (`0001_init.sql:347`, `schema.ts:307`) — `context`, `proposed_action`, `options_json`, `status ∈ {open,decided,expired}`, `decided_by`, `decided_at`.
- **Lifecycle.** PreToolUse hook posts an approval, parks the run in `status='waiting'` with `sdkSessionId` recorded. On decision, the run resumes (the `claim_next_run` query prefers `pending` over `scheduled`).
- **Always-gated actions** (Main §5 / doctrine 3.3): money, contracts, Meta kills/publishes, scope changes, hiring, pricing, cross-tenant access.

### 6.3 Audit log → Relay migration

- **Schema.** `audit_log` (`0001_init.sql:363`) — `tool_name`, `input_hash`, `result`, `ts`.
- **Writer.** `writeAudit` in `packages/core/src/cost.ts:62`, called from PostToolUse (`apps/runner/src/hooks.ts`).
- **Companion:** `autonomy_events` (`0003`) records every `propose|allow|deny` decision with `tool_name` and `rationale`.
- **Migration posture.** `audit_log` and `autonomy_events` are two of the four legacy telemetry tables the Relay unifies (§8). They remain as legacy spines until cutover — agents will emit both to legacy tables and to `relay_events` during the mirror phase. Existing readers continue working until reads are switched over.

### 6.4 Lifecycle states (added `0009`)

`agents.lifecycle_state ∈ {draft, active, paused, archived}`. APIs at `apps/api/src/index.ts` `POST /api/admin/agents/:id/{activate,pause,archive,draft}`. The runner refuses work for any agent that isn't `active`. This is what makes the *autonomous team* primitive work — the Agent Manager (`docs/agent-manager-spec.md`) hires/fires by flipping these states.

### 6.5 Security findings (added `0010`)

`security_findings` (`0010_security_findings.sql`, `schema.ts:401`) — durable artifact for every D5.3 agent. `category ∈ {isolation, rotation, access, anomaly}`, `severity ∈ {low, medium, high, critical}`, `status ∈ {open, acknowledged, resolved, suppressed}`. RLS-protected per tenant.

---

## 7. Cost / credit metering

### 7.1 What exists today

- **Per-run cost.** `runs.cost_usd numeric(12,4)` (`0001_init.sql:197`) + `tokens_in`/`tokens_out`. Written at run end by SessionEnd (`packages/core/src/lifecycle.ts`).
- **Per-tenant aggregation.** `costSummary(db, tenantId, sinceDays)` in `packages/core/src/cost.ts:11` — by-day and by-agent rollups via SQL `sum(cost_usd)`.
- **Monthly budget check.** `checkBudget(db, tenantId)` in `cost.ts:46` sums month-to-date `runs.cost_usd` against `tenants.monthly_budget_usd` (`0001_init.sql:60`); returns `level ∈ {ok, warn, over}` at 0/80/100%.
- **Per-run cap.** `agents.budget_cap_usd` (`0001_init.sql:126`).

### 7.2 Gaps for tenant-level billing

Surveyed honestly. The platform is designed for *cost accounting*; *billing meter* primitives are partial:

1. **No reserve/commit pattern.** Cost is written at run end. `checkBudget` returns `over` only after the fact. Production-grade shape: reserve the projected max at run start, commit actual at run end, release the diff. **Proposal:** `runs.reserved_usd` + a SQL trigger that decrements a per-tenant available budget on insert, increments on commit.
2. **No price catalog per provider.** Cost-tracking trusts whatever the runner records. Main §5 calls this out — pricing should be table-driven. **Proposal:** a `model_prices` global table (model_slug, provider, in_per_mtoken, out_per_mtoken, effective_from) and a `priceRun(tokensIn, tokensOut, model)` helper.
3. **No usage → invoice rollup.** No `invoices`, `invoice_lines`, `usage_meters` tables. **Out of scope for this plan** — `GENX-PLAN.md` owns the billing model. Here we specify the columns/aggregation views the billing layer will need:
   - The `run_summaries` table (§8) carries `cost_actual_usd`, `tokens_in`, `tokens_out` per run.
   - A view `tenant_monthly_usage` aggregating `sum(cost_actual_usd) group by tenant_id, date_trunc('month', ended_at)` is the input to Stripe Billing.
4. **No per-tenant active-agent cap.** "Spin up 100 agents in parallel" is cost-linear. Missing primitive: `tenants.max_active_agents` + a check on `lifecycle_state` transitions.

### 7.3 Per-run vs per-tool token accounting

`runs.tokens_in` / `runs.tokens_out` are per-run aggregates. No per-tool-call token accounting today. Per-tool granularity would help eval-driven model promotion but is not in the schema. Open Q on priority — the Relay's `relay_events` row for `tool.result` could carry it as a `metrics` field.

---

## 8. THE RELAY — Telemetry / event spine (P0)

> The most concrete section. `AGENTS-PLAN.md` and `GENX-PLAN.md` consume this as a contract. Tables, columns, ingestion path, consent boundary, migration plan, event-name namespace.

### 8.1 Why a unified spine

The codebase already has **four legacy un-unified telemetry tables**, each well-shaped for its specific concern but divergent in column shape and write paths:

| Table | Migration / line | What it captures | Writer |
|---|---|---|---|
| `runs` | `0001_init.sql:181` | The run row itself — status, schedule, cost, tokens, summary | Scheduler (insert), claim (update), SessionEnd (finalize) |
| `run_activity` | `0001_init.sql:207` | Free-form `(kind, message)` log lines during a run | Runner-side activity calls via `api.activityUrl` |
| `autonomy_events` | `0003` | `propose / allow / deny` decisions with `tool_name` + `rationale` | PreToolUse and PostToolUse hooks (`apps/runner/src/hooks.ts`) |
| `audit_log` | `0001_init.sql:363` | PostToolUse tool-call audit (`tool_name`, `input_hash`, `result`) | PostToolUse hook via `writeAudit` (`packages/core/src/cost.ts:62`) |

(`security_findings` also exists but is correctly its own durable artifact for D5.3, not a telemetry table — it stays out of the Relay merge.)

The consequence of four tables: there is **no canonical "what happened in this run" surface**. Any consumer that needs to assemble that view today joins four tables with different time grains and `tenant_id` plumbing. The spec called for a `run_summaries` row per run that compositionally answers "what did this agent just do?" — it was specced but never built. **`run_summaries` is the explicit P0 deliverable of the Relay.**

The Relay is **net-new**, not a reconciliation of the four tables. It sits alongside them. During migration, both spines write; readers cut over table by table.

### 8.2 The Relay schema

A new migration (proposed `0011_relay.sql`).

```sql
-- ------------------------------------------------------------------------
-- relay_events — the unified event bus row.
-- Every meaningful state change in the OS lands here exactly once.
-- ------------------------------------------------------------------------
create table relay_events (
  id              uuid primary key default gen_random_uuid(),

  -- Tenancy (NOT NULL, RLS-enforced)
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- Provenance / subject
  agent_id        uuid references agents(id) on delete set null,
  run_id          uuid references runs(id) on delete cascade,
  actor           text not null check (actor in ('agent','system','human','external')),
  actor_id        text,                          -- internal: uuid; external (GenX SDK): opaque

  -- The event itself
  event_name      text not null,                 -- canonical dotted namespace (§8.4)
  payload         jsonb not null default '{}'::jsonb,

  -- Causal chain — these are how chains/handoffs reconstruct
  correlation_id  uuid,                          -- ties a multi-step workflow / handoff
  causation_id    uuid,                          -- the relay_events.id that caused this one

  -- Idempotency
  event_key       text,                          -- client-supplied; unique with tenant_id

  -- Privacy posture (§8.5 — schema-enforced contract)
  consent_scope   text not null default 'tenant_only'
                    check (consent_scope in ('tenant_only','cross_tenant_aggregated')),
  pii_class       text not null default 'none'
                    check (pii_class in ('none','internal_id','client_pii')),

  -- Time
  occurred_at     timestamptz not null,
  ingested_at     timestamptz not null default now()
);

create index relay_events_tenant_time_idx on relay_events(tenant_id, occurred_at desc);
create index relay_events_run_idx on relay_events(run_id) where run_id is not null;
create index relay_events_agent_idx on relay_events(agent_id) where agent_id is not null;
create index relay_events_name_idx on relay_events(event_name);
create index relay_events_correlation_idx on relay_events(correlation_id) where correlation_id is not null;
create unique index relay_events_idempotency_idx on relay_events(tenant_id, event_key) where event_key is not null;

-- RLS — same is_tenant_member() pattern as the rest of the schema.
alter table relay_events enable row level security;
create policy relay_events_rw on relay_events
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ------------------------------------------------------------------------
-- run_summaries — the P0 outcome surface.
-- One row per terminal run. Composed at SessionEnd.
-- ------------------------------------------------------------------------
create table run_summaries (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy + run identity
  tenant_id         uuid not null references tenants(id) on delete cascade,
  run_id            uuid not null unique references runs(id) on delete cascade,
  agent_id          uuid not null references agents(id) on delete cascade,

  -- Outcome envelope (canonical)
  status            text not null check (status in ('done','failed','escalated','skipped','quarantined')),
  deliverable_kind  text,                          -- e.g. 'document','approval_request','tool_action','no_op'
  deliverable_ref   text,                          -- path / uuid / external URI to the deliverable
  evidence_paths    jsonb not null default '[]'::jsonb,   -- list of file paths (CLAUDE.md non-neg #4)

  -- Cost + tokens (commit values — match runs.cost_usd at SessionEnd)
  cost_actual_usd   numeric(12,4) not null default 0,
  tokens_in         bigint not null default 0,
  tokens_out        bigint not null default 0,

  -- Activity rollups
  finding_count     integer not null default 0,    -- security_findings opened during this run
  tool_call_count   integer not null default 0,
  approval_count    integer not null default 0,    -- approvals raised during this run

  -- Denormalized snippet for fast querying without joining payload jsonb
  summary_text      text,                          -- the one-paragraph human-readable summary
  highlights        jsonb not null default '{}'::jsonb,  -- key fields the agent class wants exposed

  -- Time
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  duration_ms       integer not null,

  -- Privacy posture (mirrors the row's run consent for fast aggregation queries)
  consent_scope     text not null default 'tenant_only'
                      check (consent_scope in ('tenant_only','cross_tenant_aggregated')),

  created_at        timestamptz not null default now()
);

create index run_summaries_tenant_time_idx on run_summaries(tenant_id, ended_at desc);
create index run_summaries_agent_idx on run_summaries(agent_id);
create index run_summaries_status_idx on run_summaries(status);

alter table run_summaries enable row level security;
create policy run_summaries_rw on run_summaries
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ------------------------------------------------------------------------
-- Cross-tenant aggregation view — the ONLY path out of the per-tenant RLS box.
-- Filters consent + aggregates. No raw row egress across tenants.
-- ------------------------------------------------------------------------
create view relay_events_xtenant_agg as
  select
    date_trunc('hour', occurred_at) as bucket,
    event_name,
    count(*) as event_count,
    count(distinct tenant_id) as tenant_count,
    count(distinct agent_id) as agent_count
  from relay_events
  where consent_scope = 'cross_tenant_aggregated'
  group by date_trunc('hour', occurred_at), event_name;
-- This view is read by the cross-tenant pattern-mining agents (`v2` D6 lineage).
-- Access via service-role + a Hono route that gates by an internal "platform_admin" role.
```

### 8.3 Canonical event-name namespace

The initial set, with one-line semantics. New event names land via a code-reviewed seed list under `apps/platform/src/relay/registry.ts` (proposed). `event-schema-guardian` (`v2` D3.1) audits drift.

| Event name | Emitted by | Semantics |
|---|---|---|
| `run.started` | runner @ claim | Run row flipped to `running`. |
| `run.completed` | runner @ SessionEnd, status=done | Run finished successfully; `run_summaries` row composed. |
| `run.failed` | runner @ SessionEnd, status=failed | Run errored; `run_summaries` row composed with status=failed. |
| `run.escalated` | runner @ SessionEnd, status=waiting | Run parked for human approval. |
| `tool.dispatched` | PreToolUse hook | Decision was `allow`; SDK is about to invoke the tool. |
| `tool.result` | PostToolUse hook | Tool returned; carries `tool_name`, `input_hash`, `result`, `tokens`, `duration_ms` in `payload`. |
| `approval.requested` | PreToolUse hook (decision=propose) | Approvals row created; run parked. |
| `approval.resolved` | approval-decision endpoint | Human decided; carries decision + decided_by. |
| `autonomy.escalated` | autonomy gate (decision=propose on irreversible) | Decision was to require human review. |
| `autonomy.allowed` | autonomy gate (decision=allow) | Decision was to proceed. |
| `autonomy.denied` | autonomy gate (decision=deny) | Decision was to block. |
| `budget.warn` | `checkBudget` reports `warn` | Monthly cost crossed 80%. |
| `budget.cap_hit` | `checkBudget` reports `over` OR per-run cap exceeded | Monetary stop; run quarantines. |
| `finding.recorded` | D5.3 agents @ write of `security_findings` | New finding opened; carries category + severity. |
| `cred.rotated` | `tool.vault-rotate` | A credential was rotated. |
| `cred.expiring` | secrets-rotation agent | Credential is within rotation window. |
| `lifecycle.changed` | lifecycle endpoint | Agent flipped between draft/active/paused/archived. |
| `connector.health.degraded` | connector-health agent | MCP healthcheck failed. |
| `connector.health.recovered` | connector-health agent | MCP healthcheck recovered. |
| `knowledge.retrieved` | bundle build | Knowledge chunks selected for a run; carries chunk count + namespaces. |
| `knowledge.written` | lifecycle.ts run-summary writer | New `kb:` document written by an agent. |
| `architect.proposed` | architect endpoint | New blueprint proposed. |
| `architect.seeded` | architect seed step | Blueprint converted to agent rows. |
| `cantfail.model_violation` | runner @ SessionStart pre-dispatch | A T-critical agent was about to dispatch on a non-Opus model; run fail-closed. Payload `{ agent_key, resolved_model, expected }`. Triggers `run.failed` terminal event. Per Open Q #1 (RESOLVED). |
| `architect.refused` | `hydrate.ts` @ `assertNotCraProhibited` | The architect refused to assemble a blueprint because it tripped the CRA blocklist (credit / employment / housing / insurance / government benefits). Payload `{ category, fragment_hash, blueprint_id }`. Per `GENX-PLAN.md` Open Q #8 (RESOLVED mechanism). |
| `cantfail.cra_violation` | runner @ SessionStart pre-dispatch | A manually-authored agent that bypassed the architect was about to dispatch but its name/systemPrompt trips the CRA blocklist. Payload `{ agent_key, category, fragment_hash }`. Triggers `run.failed`. Belt-and-suspenders for `architect.refused`. |

The namespace is **closed** at write time — `event-schema-guardian` opens a finding when an unknown `event_name` lands. (External GenX SDK events are validated against this same registry at the ingest endpoint.)

### 8.4 Ingestion path

```
Source                              → Endpoint                       → Validator           → Writer (Inngest fn)   → Postgres
─────────────────────────────────     ──────────────────────────────   ─────────────────    ──────────────────     ────────────
Agent runner (hooks: Pre/Post/Stop)   in-process emitRelay()           schema + name         relay-writer            relay_events (+ run_summaries on SessionEnd)
Platform code (scheduler, lifecycle)  in-process emitRelay()           schema + name         relay-writer            relay_events
Control-plane app (user actions)      POST /relay/events (session)     schema + tenancy      relay-writer            relay_events
GenX SDK (public tenant — §GENX)      POST /relay/ingest (api key)     schema + signature    relay-writer            relay_events
MCP / Nango webhooks                  POST /relay/webhook (HMAC)       schema + signature    relay-writer            relay_events
```

**File-by-file:**
- `apps/platform/` — proposed new sub-app. Hono routes mirror `apps/api/`'s shape.
- `apps/platform/src/routes/relay.ts` — internal `/relay/events`. API-key auth via `api_keys` (`0001_init.sql:377`). Rate-limited per tenant.
- `apps/platform/src/routes/ingest.ts` — external `/relay/ingest`. Tenant API key. Validates `consent_scope` and `pii_class` are present and well-formed.
- `apps/platform/src/relay/emit.ts` — in-process emit helper used by `apps/runner/src/hooks.ts`, `packages/core/src/scheduler.ts`, `packages/core/src/lifecycle.ts`, etc.
- `packages/inngest/src/functions/relayWriter.ts` — the writer step. Idempotency check via `(tenant_id, event_key)`; PII validation against the row's `pii_class`.
- `packages/core/src/relay/composeRunSummary.ts` — assembles a `run_summaries` row from `runs` + recent `relay_events` for that `run_id` at SessionEnd. Called by `lifecycle.ts`.

**What each runner hook emits:**
- PreToolUse → `tool.dispatched` (decision=allow) OR `approval.requested` + `autonomy.escalated` (decision=propose) OR `autonomy.denied` (decision=deny).
- PostToolUse → `tool.result` (alongside the existing `audit_log` write).
- Stop / SessionEnd → `run.completed` | `run.failed` | `run.escalated`, AND triggers `composeRunSummary` which writes `run_summaries`.

### 8.5 The consent boundary (schema-enforced)

The non-negotiable: every `relay_events` row carries `consent_scope` and `pii_class`. The contract:

- **`consent_scope='tenant_only'`** (default) — the row is queryable only within the owning tenant. RLS enforces this. Even service-role queries that aggregate across tenants must use the `relay_events_xtenant_agg` view.
- **`consent_scope='cross_tenant_aggregated'`** — the tenant has opted into being included in cross-tenant pattern aggregation. Even then, no raw row egress — only aggregations via the view.
- **`pii_class='client_pii'`** — drives the egress redaction policy at outbound forwarding (any sink, including admin dashboards, redacts these fields per the destination's allowance).

**Enforcement at three layers:**
1. **Schema** — `consent_scope` and `pii_class` are NOT NULL with check constraints.
2. **Ingest** — `apps/platform/src/routes/ingest.ts` rejects rows missing either field.
3. **Aggregation** — the only cross-tenant query path is the view (which hard-codes the consent filter). Service-role connections can read raw rows of a single tenant but must call the view to cross tenants; any direct cross-tenant aggregate query is a code-review violation flagged by `event-schema-guardian`.

A breach of this boundary is the same magnitude as a tenant-isolation failure. Recommendation: a `consent-boundary-tester` agent under D5.3 alongside `tenant-isolation-tester`. Open Q.

### 8.6 Migration path from the four legacy tables

The Relay does not replace `runs`, `run_activity`, `autonomy_events`, or `audit_log`. It coexists. Order:

1. **Coexist.** Migration `0011_relay.sql` adds `relay_events` and `run_summaries`. No legacy writes are removed. The runner gains the `emitRelay()` helper; hooks call it alongside their existing writes.
2. **Mirror.** Every PostToolUse writes `audit_log` AND emits `tool.result`. Every PreToolUse/`autonomyGate` writes `autonomy_events` AND emits `autonomy.*`. Scheduler writes `runs` AND emits `run.started`. SessionEnd writes `runs.summary` AND composes `run_summaries`. This phase runs until the new tables have parity coverage in a live tenant.
3. **Read-cutover.** Internal dashboards switch reads to `relay_events` / `run_summaries`. Legacy tables continue accepting writes for rollback.
4. **Write-cutover.** Hook implementations stop writing the legacy tables; `audit_log`/`autonomy_events`/`run_activity` become read-only. `runs` keeps its existing writes (it remains the queue row).

Risk profile: low, because mirror-phase doubles writes only (Postgres handles the volume; tables are append-only); reads are tested before legacy is shut off.

### 8.7 Contract for `AGENTS-PLAN.md`

`AGENTS-PLAN.md` is responsible for, per agent class, the **payload contract** — what fields agents put into `payload`/`highlights` when they emit each of the events in §8.3. Specifically, agent specs must enumerate:
- The set of events the agent emits (must be subset of §8.3 namespace).
- The `payload` schema for each event the agent emits.
- The `highlights` projection it expects in its `run_summaries.highlights` (the denormalized snippet).
- Its `consent_scope` default (most agents will emit `tenant_only`; cross-tenant aggregation is per-event opt-in).
- Its `pii_class` discipline — which payload fields are `client_pii` and require redaction at egress.

This document does NOT enumerate per-agent payloads — that belongs in `AGENTS-PLAN.md`.

### 8.8 Contract for `GENX-PLAN.md`

`GENX-PLAN.md` is responsible for the external SDK that wraps the Relay's ingest endpoint:
- The SDK is a thin HTTP wrapper that POSTs to `/relay/ingest` with a per-tenant API key (`api_keys` row, `kind='external'`).
- Every event the SDK emits validates against the same §8.3 namespace at ingest time. The SDK does not define new event names; it consumes the same registry.
- The SDK is responsible for capturing `consent_scope` and `pii_class` from the embedding site's consent state and including them in every event. The ingest endpoint rejects events without them.
- The SDK never reads from the Relay; it is write-only.
- The Meta Conversions API pixel (the *literal* pixel used by ad-ops agents) is unrelated to the GenX SDK and continues to live behind its connector MCP.

---

## 9. Build sequence with gates + honest exists-today / missing list

### 9.1 What exists today

Per `HANDOFF-other-session.md` + the phase summaries in `.planning/phases/`:

**Shipped:**
- Phase 0/1 — Foundation, monorepo, migrations `0001-0005`, RLS via `is_tenant_member()`, safety hooks 1a/1b/1c.
- Phase 2 — Phase-1 + 8-agent Phase-2 batch including `ad-claim-compliance` (`docs/acqu-phase-{1,2}-agent-manifest.md`).
- Phase 3/4 — Architect (plain-English → blueprint → seed), `architect_blueprints` (`0006`).
- Phase 5 — `ad-claim-compliance` T-critical gate landed; 12-agent Phase-3 batch.
- Phase 6 — 22-agent Phase-4 batch.
- Phase 7 — `tools` registry (`0007`), `@agent-os/inngest`, pg_cron → Inngest (`0008`), `@agent-os/tool-browser` with SSRF guard.
- Phase 8.5 — `agents.lifecycle_state` + `tenants.default_model_override` (`0009`); lifecycle API endpoints.
- Phase 9 (in progress on `claude/exciting-davinci-yvptm`) — `security_findings` (`0010`), four D5.3 security agents (`tenant-isolation-tester`, `secrets-rotation`, `access-auditor`, `security-anomaly-watchdog`), `packages/tool-rls-test/` with 32 attack vectors, runner-side dispatch for `tool.rls-test`, `tool.vault-rotate`, `tool.access-audit`, `tool.access-log-analyzer`.

**The runtime path works end-to-end** (scheduler → claim → bundle → execute → safety hooks → run summary).

### 9.2 What is missing / stubbed / deferred

- **The Relay (`/apps/platform`, `0011_relay.sql`, `run_summaries`)** — P0, not yet created. This plan's §8 is the spec.
- **Fleet-wide live-Supabase RLS audit with 2+ tenants** — P0, partial. Tool ships; the live-run sweep that produces the artifact for the public-launch gate is the merge target of Phase 9.
- **Live Browserbase backend** for `tool.browser` — Phase 7 ships SSRF + Node-fetch fallback. Stagehand-on-Browserbase is the swap.
- **Nango connector layer** — vault works; the Nango adapter behind the connector interface is queued for white-label launch (Main §6 build delta #6).
- **Rerank 4 Pro in the retrieval path** — `CLAUDE.md` and Main §1.4 call for it; no code path exists today.
- **Per-provider model pricing table** — Main §5: cost reporting must not assume OpenRouter for everything. Today `runs.cost_usd` trusts runner-supplied numbers.
- **Reserve/commit budget pattern** — only after-the-fact `checkBudget` exists.
- **Per-tenant active-agent cap + concurrency cap.**
- **Agent Manager** — spec exists (`docs/agent-manager-spec.md`); seed script does not.
- **GitHub-sync skill registry** — fields wired, sync worker not built.
- **Globalized skill / tool definitions** — see §2.3.
- **`agent_metrics` table** (the scorecard from `acqu-os-build-spec.md` §3) — does not exist. Promotion/demotion is currently manual.
- **`run_summaries`** — the explicit P0 deliverable of the Relay.

### 9.3 The three hard gates that override sequence

From `v2` §F + `CLAUDE.md` non-negotiable #5:

1. **No client ad launches before `ad-claim-compliance` (D6.1) is live.** Status: shipped (Phase 2/5). Gate passable.
2. **No external multi-tenant before `tenant-isolation-tester` (D5.3) passes against a live 2+ tenant Supabase.** Status: agent + tool in progress on `claude/exciting-davinci-yvptm`. **Blocks public launch.**
3. **No recurring billing before `dunning-manager` (D4.1) is live.** Status: agent seeded; the underlying `tool.billing-engine` + `tool.dunning-engine` (Stripe Billing) is not yet shipped. Gate not passable until those tools land.

### 9.4 Sequencing — *Relay + fleet-wide RLS land before scaling the fleet*

The sequencing rule is hard: **the two P0 gates (Relay + fleet-wide RLS audit) ship before the fleet expands beyond Acqu's seeded set, before white-label, and before public launch.** Scaling agent count on partially-proven isolation and with no event spine is the failure mode this sequencing prevents.

| Order | Deliverable | Gate it unblocks | Acceptance test |
|---|---|---|---|
| **A — P0** | Merge Phase 9 (`claude/exciting-davinci-yvptm`) to `main`. Run `tool.rls-test` against a live Supabase with 2+ tenants. Generate the artifact. | Hard gate #2 evidence; fleet-wide RLS audit P0. | Zero cross-tenant rows across every table, including the vector store, across all 32 attack vectors. Artifact committed to `.planning/`. |
| **B — P0** | Migration `0011_relay.sql` (`relay_events` + `run_summaries` + the xtenant view). Build `apps/platform/`. Wire the runner hooks to emit via `emitRelay()` alongside legacy writes (mirror phase). Wire `composeRunSummary` at SessionEnd. | Relay P0; consent boundary is now schema-enforced. | A test run on a single tenant produces: a `run.started` + N × `tool.*` + a `run.completed` event row, plus exactly one `run_summaries` row carrying `cost_actual_usd` matching `runs.cost_usd`. |
| C | Model-price table + per-provider pricing in `packages/core/src/cost.ts`. | Closes Main §5 gap before billing. | A run on Hermes-70B costs differently from a run on Sonnet-4.6 in `runs.cost_usd`; backed by `model_prices`. |
| D | Stripe Billing wrapper (`tool.billing-engine`) + `dunning-manager`'s `tool.dunning-engine`. | Hard gate #3. | A failed payment fires a `connector.*` event; `dunning-manager` opens an approval; recovery confirmed end-to-end. |
| E | Nango adapter behind the connector interface (one connector first — Close per Main §6). | White-label connector readiness. | A white-label-stage tenant connects Close via Nango; `oauth_credentials.vault_ref` resolves; runner gets a short-TTL token. |
| F | Agent Manager (`docs/agent-manager-spec.md`). | Autonomous-team loop is real. | Manager runs daily at 10:00, opens 0-3 proposals, operator approves; lifecycle endpoint flips. |
| G | Read-cutover: internal dashboards read `relay_events` + `run_summaries`. Legacy tables remain write-only fallback. | Relay migration step 3. | Dashboards render from Relay only; legacy tables can be paused for 24h without UX impact. |
| H | Fleet expansion: instantiate the existing Acqu agents per white-label tenant. (Same agents × many tenants — not new agent types.) | First white-label rollout. | A second tenant has the white-label-tier subset of agents seeded; each runs without spillover into tenant #1; the Relay shows per-tenant event streams cleanly separated. |
| I | GenX SDK + `/relay/ingest` endpoint (sibling `GENX-PLAN.md` covers this; the contract from §8.4 + §8.8 is the input). | Public-stage prerequisite. | A demo public tenant fires `pixel.page.view`-equivalent events via the SDK, lands in `relay_events`, respects consent. |
| J | Public/GenX launch — open signups. | All three hard gates green; security agents green; Relay consent boundary enforced. | Gate matrix below all green. |

### 9.5 The gate matrix

| Stage transition | Required to pass |
|---|---|
| Acqu only → first white-label tenant | A (Relay P0 + fleet-wide RLS audit P0) + B + C + D + E. Hard gates #1 + #3. Nango adapter for the connectors that tenant needs. |
| First white-label tenant → multi-tenant white-label | Hard gate #2 still green on growing tenant set. All D5.3 agents on `execute_safe`. Per-tenant model override audited. H complete. |
| White-label → public/GenX self-serve | Hard gate #2 still green on a much larger tenant set. `apps/platform/` shipped with the consent boundary schema-enforced. Per-tenant active-agent cap + concurrency cap in `tenants`. Rate-limit-guardian (D5.2) live. Architect cost cap per tenant (`HANDOFF-other-session.md` §7). I complete. |

---

## Open Questions for the operator

1. **Hermes vs Opus on can't-fail agents — RESOLVED 2026-06-01 + REFRAMED 2026-06-01 (Model Router).**

   **Original resolution (verbatim):** "Tier wins, override loses. T-critical agents always run Opus and are EXEMPT from tenant `default_model_override`. Hermes 405B is the default ONLY for non-critical tiers."

   **Reframe (verbatim operator clarification):** "Hermes is a model but also a framework. We need to choose what models are the best at that time to give Hermes and have it run on it. Hermes is the plan and the models is the fuel. We need to decide which model is the best depending on the specific tasks and actions it is taking as well as optimizing price and usage but we are focused on the best output."

   **Architectural resolution (Step 2.5 — the Model Router):** `packages/core/src/router/` resolves an agent's *tier intent* (`spec.modelTier`) into a *concrete model slug* at seed time. Models are interchangeable fuel; tiers are the routing axis. T-critical pins to Opus regardless of any override (hardcoded floor); non-critical tiers resolve via `tenants.tier_overrides jsonb` → `DEFAULT_TIER_MODELS[tier].primary`. When new fuel ships (next Hermes, next Claude, next DeepSeek), operators edit one constant + PR-review + re-seed. T-critical safety floor is unchanged.

   **Implementation (shipped 2026-06-01, commit `f2678e3` + the Model Router commit):**

   - **Router module** `packages/core/src/router/` — `resolveModel(args)` with 4-level precedence: T-critical exemption → explicit `spec.model` (eval-promotion) → `tenants.tier_overrides[tier]` → `DEFAULT_TIER_MODELS[tier].primary`. Closed `MODEL_TIERS` enum, `isModelTier` type guard, `tierFromLegacyModel` heuristic for backfill.
   - **Schema** (migration `0013_model_router.sql`): `agents.model_tier text CHECK IN (...)` + `tenants.tier_overrides jsonb DEFAULT '{}'`. `tenants.default_model_override` retained for back-compat (deprecation comment + warning at seed time).
   - **Drizzle mirror** updated for both columns. `AgentSpec` gains `modelTier?: ModelTier` (optional for back-compat; required for new seeds).
   - **`seedAgent` integration**: legacy `default_model_override` still applies to non-critical agents as a blunt fallback (back-compat); `tier_overrides` wins when set. `resolveModel()` runs server-side, emits `model.routed` Relay event for every resolution (audit trail).
   - **Runtime assertion (unchanged)**: `apps/runner/src/execute.ts` SessionStart `assertCantFailModel` reads `T_CRITICAL_ALLOWLIST` from the router module, emits `cantfail.model_violation` + fails run closed on drift.
   - **Relay namespace**: 28 events (added `model.routed`).
   - **Regression tests**: `packages/core/src/router/router.test.ts` (25 passing) — locks the four-level precedence + the empty T-critical fallback chain + the operator's intent (T-cheap=hermes-4-70b, T-reason=hermes-4-405b). `seedAgent.cantfail.test.ts` (10 passing) — unchanged, still proves persisted `agents.model` resolves to Opus under a Hermes override. `cantfail.test.ts` runner test (7 passing) — unchanged, still proves runtime fail-closed.
   - **Mechanical**: all 56 existing acqu-*.ts agent seeds gained `modelTier:` derived from their legacy `model:` literal (12 T-critical / 30 T-work / 9 T-cheap / 5 T-reason).

   **Doctrine alignment**: `CLAUDE.md` model tiering section rewritten to describe the Model Router; precedence rules + operator levers documented inline. `HANDOFF-other-session.md` §2's Hermes-on-can't-fail drift is now mechanically impossible (router pins T-critical, the runtime asserts, the regression tests lock).
2. **The third stage's `tenants.type` value name.** Proposal: `'public'`. Alternatives: `'genx'` (couples to brand), `'self_serve'` (functional). Need pick before migration to widen the check constraint.
3. **Global skill/tool definition tables.** §2.3 proposes `skill_defs` and `tool_defs` global registries with `skills.tenant_id` / `tools.tenant_id` becoming the binding row. Real refactor; touches seed scripts. P1, not P0 — confirm priority.
4. **Per-tenant active-agent cap + concurrency cap on `tenants`.** §3.3 + §7.2 #4. Recommend `tenants.max_active_agents` and `tenants.max_concurrent_runs`. Default-unlimited for Acqu, plan-derived for white-label/GenX. Confirm.
5. **Reserve/commit budget pattern.** §7.2 #1 — `runs.reserved_usd` + a SQL trigger. Confirm priority before deliverable D (billing) ships.
6. **Per-provider `model_prices` table.** §7.2 #2 + §9.4 C. Confirm shape (one row per `(model_slug, effective_from)`) before C ships.
7. **Embedder for production knowledge.** `hashEmbedder` is dev-only. Voyage, OpenAI, Cohere? Cross-check against the Rerank 4 Pro slot from Main §1.4.
8. **Public/GenX runner isolation level.** §3.2 — same Node child process as Acqu, or per-run ephemeral sandboxes (Browserbase / Cloud Run job)? Cost + isolation tradeoff.
9. **`consent-boundary-tester` agent in D5.3.** §8.5 — if the Relay carries `pii_class='client_pii'` and feeds aggregation, a continuous test on the consent boundary is the same magnitude as `tenant-isolation-tester`. Add to the doctrine?
10. **Architect cost cap per tenant.** `HANDOFF-other-session.md` §7 — per-proposal budget exists; tenant-wide cumulative cap does not. Required before the Agent Manager (deliverable F) gets autonomy to hire on its own.
11. **Inngest cost at scale.** Per-step pricing across hundreds of tenants. Profile before deliverable J (public launch).
12. **`tenants.timezone` and `tenants.allowed_origins`.** Implicit in stages 2/3 (cron schedule TZ; GenX SDK CORS). Not in schema today.
13. **`run_summaries.highlights` schema enforcement.** §8.2 makes `highlights` a free-form jsonb. Should there be a per-agent-class schema registry (`agent_summary_schemas`) that validates the projection at write time? `event-schema-guardian` could enforce.
14. **Causal chain semantics for handoffs.** §8.2 introduces `correlation_id` and `causation_id`. For the doctrine's handoff chains (`v2` §E), is the correlation root the originating run, or a higher-level "workflow" entity that doesn't exist as a row yet? Decision affects whether `correlation_id` is a `runs.id`, a new `workflows.id`, or just a synthetic uuid the originating agent mints.
