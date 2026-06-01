# AGENT-OS-PLAN

> Planning document — no production code. Sibling docs `AGENTS-PLAN.md` and `GENX-PLAN.md` consume Section 8 (the telemetry contract) as their load-bearing input.
>
> **Reading map.** This plan reconciles five canonical sources in the repo:
> - `/home/user/agent-os/CLAUDE.md` (project non-negotiables, model tiers, can't-fail list).
> - `/home/user/agent-os/docs/main-acqu-agent-doctrine.md` (the machinery layer — **wins over v1/v2 on machinery**).
> - `/home/user/agent-os/docs/acqu-agent-doctrine-v2.md` (8 domains, 26+10 functions, handoff chains).
> - `/home/user/agent-os/docs/acqu-agent-doctrine.md` (v1 — original 14 function prompts).
> - `/home/user/agent-os/docs/acqu-os-build-spec.md` (control-plane / runner / safety hooks build sequence).
> Plus operating refs: `acqu-os-session-runbook.md`, `HANDOFF-other-session.md`, `agent-manager-spec.md`, `specs/agent-architect.md`, `superpowers/specs/2026-05-25-agent-os-design.md`, and the 4 phase manifests under `docs/acqu-phase-{1,2,3,4}-agent-manifest.md`.
>
> Codebase ground truth: the migrations `/home/user/agent-os/supabase/migrations/0001_init.sql` … `0010_security_findings.sql` and the Drizzle mirror at `/home/user/agent-os/packages/db/src/schema.ts:1-416`.
>
> Two docs the operator named **do not exist in this repo**: `CLIENTLY-BRAIN.md` and `CLIENTLY-2.0-RESOLVED-DIRECTION.md`. They are flagged in Open Questions; nothing in this plan invents content from their assumed-but-absent direction.

---

## 1. Platform purpose and the three-stages mapping

### 1.1 Purpose

A multi-tenant Agent OS — the control plane that runs Acqu on agents and that is productized externally as Cliently and (per the operator's framing) the public/white-label stage **GenX**. Per the mandate: *GenX is the public stage of this platform, not a separate codebase, repo, or Supabase project.* One monorepo (`agent-os/`), one Supabase project, one event pipeline, one set of registries — tenant rows and feature flags differentiate the stages.

The OS exists to enforce one rule (`CLAUDE.md`): **agents are DATA, not code**. The substrate is registries (agents/tools/MCP/skills/tenants) + knowledge (pgvector) + scheduler + orchestrator + safety hooks + observability. The runtime is swappable behind a `Runner` interface; v1 is the Claude Agent SDK over OpenRouter (`main` §1.2). Adding an agent is normally a configuration operation — usually zero new application code (`acqu-os-build-spec.md` §0).

### 1.2 The three stages — *one platform, three modes*

| Stage | Who runs it | `tenants.type` | Auth | Connector OAuth | Telemetry consumer | Hard gates that must pass |
|---|---|---|---|---|---|---|
| **Internal (Acqu)** | Us, for ourselves (tenant #1) | `internal` (the existing `tenants.type` enum value — see `0001_init.sql:58`) | Supabase Auth + `tenant_members` (`0001_init.sql:65`) | Built-in `oauth_credentials` vault (`0001_init.sql:270`, `AOS_VAULT_KEY`) | `/apps/platform` events → internal dashboards | None — Acqu pays the cost of mistakes |
| **White-label (Cliently for paying clients)** | DFY clients we sell to | `client` (already exists in `0001_init.sql:58`'s check constraint) | Supabase Auth + `tenant_members`; admin API key per tenant | Nango behind the same connector interface (Main §2.4); vault stays as fallback during connector-by-connector migration | Same event pipeline; events tagged `tenant.type=client`, surfaced to client via white-labelled dashboard | `ad-claim-compliance`, `dunning-manager`, `tenant-isolation-tester` (the three hard gates, `v2` §F) |
| **Public / GenX (self-serve)** | Anyone with a sign-up | A new value — **proposed: `public`** added to the `tenants.type` check constraint (open question on the name) | Supabase Auth signup; first-class `tenant_members.role='owner'` on org creation | Nango required (no operator hand-holds OAuth at signup) | Same event pipeline + the *external* "GenX pixel" SDK (Section 8) | All three hard gates **plus** D5.3 security agents green, all four telemetry consent boundaries enforced |

The discriminator in Postgres is one column (`tenants.type` in `0001_init.sql:58` / `packages/db/src/schema.ts:29`). Stage-specific behavior is feature flags + config, **not** different tables, schemas, or code paths.

### 1.3 What changes per stage, table by table

The list below is exhaustive for every tenant-scoped table that exists today. *Per-stage* changes are limited to: who can read/write the row, which OAuth backend stores the credential, which model override is applied, and which telemetry tags emit.

| Table (migration · schema line) | Internal (Acqu) | White-label (Cliently / `client`) | Public (GenX / `public`) |
|---|---|---|---|
| `tenants` (`0001_init.sql:54` · `schema.ts:25`) | One row, `type='internal'`. `monthly_budget_usd` set by founder. `default_model_override` (added `0009`) NULL or set to `nousresearch/hermes-4-405b` per `HANDOFF-other-session.md` §2 directive. | One row per client. `type='client'`. `monthly_budget_usd` becomes the billing meter. Tenant-wide model override usually unset (run can't-fail agents on Opus). | One row per signup. `type='public'`. `monthly_budget_usd` defaults from plan tier; **hard cap enforced** (Open Q on enforcement table). |
| `tenant_members` (`0001_init.sql:65`) | Founder + ops humans. Roles: `owner`, `admin`, `member`, `viewer`. | Client primary user is `owner`; account managers from Acqu can be added with `admin` role for support. | Public signups: signup creates an `owner` row. Self-serve invite UX adds `admin`/`member`. |
| `projects` (`0001_init.sql:85` · `schema.ts:49`) | Acqu's internal projects (Ad-Ops, Founder Ops, etc., per `acqu-os-build-spec.md` §3). | Each client's project structure mirrors their service tier — config-driven from `kb:onboarding/dfy-sequence.md`. | Each public org starts with one default project; user creates more. |
| `agents` (`0001_init.sql:112` · `schema.ts:73`) | Seeded by `scripts/seed/acqu-*.ts` (Phases 1-4 done; manifests at `docs/acqu-phase-{1,2,3,4}-agent-manifest.md`). | Subset of Acqu agents seeded per client based on service tier; client cannot create agents directly. | Tenants build their own via the Architect (`POST /api/admin/architect/propose`, `docs/specs/agent-architect.md`). All new agents land `autonomy='propose'`, `enabled=false`, `lifecycle_state='draft'` (`0009`). |
| `agent_prompts` (`0004`) | Versioned by hash inside `packages/core/src/seed/seedAgent.ts`. | Same — clients see read-only history. | Architect writes v1; remix writes v2+. |
| `agent_triggers` (`0005`) | Cron + event triggers from doctrine. | Cron schedules may differ per client timezone (TZ stored on `tenants` — Open Q). | Public users edit triggers from the UI; UI gates impossible schedules. |
| `agent_skills`, `agent_mcps`, `agent_tools` (joins) | Doctrine-defined bindings. | Bindings tied to that client's connected MCPs only — least-privilege per `access-auditor` D5.3. | Same; UI prevents binding to an MCP the tenant hasn't connected. |
| `skills` (`0001_init.sql:234` · `schema.ts:196`) | `scope='global'` rows from the Superpowers + custom-ops library; on-disk `SKILL.md` (per Main §3.1). | Same global rows visible (`scope='global'`); per-client overrides go to `scope='project'`. | Same. The `skill-librarian` (D6.2) proposes new ones across all stages. |
| `mcps` (`0001_init.sql:254` · `schema.ts:211`) | Internal MCPs (Close, Pipeboard, Slack, Drive, GitHub, n8n) — one row per Acqu account. | One row per *client's* connection. `oauth_credentials.vault_ref` may point to Nango at productization (Main §2.4). | Same — Nango required from day one. |
| `tools` (`0007`) | All custom + MCP tools registered; `requires_approval` per doctrine. | Same registry; agents bind by `tool_key`. | Same. `tools.tenant_id` is the *registry* tenant — Open Q on global-vs-tenant registries (Section 4). |
| `oauth_credentials` (`0001_init.sql:270`) | Always internal vault. | Vault initially; per-connector migration to Nango (Main §2.4). Never rip out vault. | Nango from the start (no operator does the OAuth dance). |
| `env_vars` (`0001_init.sql:281`) | Founder-managed; `pinned=true` carries org-wide secrets. | Per-client env vars set by account manager. | Per-tenant env vars set in the UI; encrypted via `AOS_VAULT_KEY`. |
| `knowledge_folders`, `documents`, `doc_chunks` (`0001_init.sql:293-326`) | `kb:` tree per Main §5 + doctrine; folders shared inside Acqu. | Each client has its own `kb:` tree; cross-client retrieval is RLS-impossible (see §2). | Each public tenant starts empty; their docs are theirs. **Cross-tenant retrieval must return zero rows** even via the vector path. |
| `runs`, `run_activity` (`0001_init.sql:181-215`) | All runs visible to founder. | Visible to client (their data). Acqu support sees with `admin` role. | Visible to tenant only. |
| `approvals` (`0001_init.sql:347`) | Slack mirror to Acqu channel. | Slack mirror per client (per-client connected Slack workspace MCP). | In-app inbox + optional email/Slack per tenant config. |
| `autonomy_events` (`0003`) | Always-on audit. | Same. | Same. |
| `audit_log` (`0001_init.sql:363`) | Append-only. | Same. | Same. **Public's audit is the trust surface — never editable.** |
| `architect_blueprints` (`0006`) | Founder uses Architect for "remix" runs. | Account managers use Architect to propose teams for clients. | The primary "build your team" surface — every public tenant starts here. |
| `security_findings` (`0010`) | Acqu's own posture. | Per-client; client sees a redacted view. | Per-tenant; **must be empty / acknowledged before public launch** (gate per `09-CONTEXT.md`). |
| `architect_blueprints.agentsJson`, `proposedSkillsJson`, `proposedMcpsJson` | Internal use. | Same. | The *primary self-serve surface* — most public users only ever see this. |
| **NEW** `events` (proposed — Section 8) | All Acqu instrumentation. | Client app + agents instrument. | External "GenX pixel" SDK ships to the same table, tagged `tenant.type=public`. |
| **NEW** `event_destinations`, `event_sinks` (Section 8) | Internal Slack/email/Snowflake. | Per-client outbound destinations. | Per-tenant outbound destinations (the productized "send my events to my warehouse" feature). |

Three things to call out about this table:

1. **`tenants.type` is the entire stage discriminator.** No separate schemas, no Cliently fork, no GenX repo. This is the operator's non-negotiable, and the data model already supports it; the only change needed is widening the check constraint to allow `'public'`.
2. **Per-tenant model override (`0009`) is the per-stage knob for cost.** Acqu can run on `nousresearch/hermes-4-405b` for everything via the override (`HANDOFF-other-session.md` §2). Cliently keeps Opus on can't-fail agents. Public starts on the cheap tier matrix from `CLAUDE.md` and promotes per eval results.
3. **Architect is the productized seed path for stages 2 and 3.** The Acqu doctrine seeds (Phases 1-4) are *internal only*. Cliently and GenX tenants get agents either by tiered template-copy (Cliently) or by Architect (GenX). The doctrine isn't a UX — Architect is.

---

## 2. Multi-tenant data model

### 2.1 The two enforcement layers

The platform has **two** independent fences. Both must hold; a hole in either is a breach.

**Layer 1 — Postgres RLS via `is_tenant_member()`.** Implemented in `supabase/migrations/0001_init.sql:74` as a `security definer` function that resolves `auth.uid()` against `tenant_members`. Every tenant-scoped table is wrapped in an `enable row level security` + `tenant_rw` policy that calls `is_tenant_member(tenant_id)`; join tables without a `tenant_id` column (`job_refs`, `agent_skills`, `agent_mcps`) authorize via a `select 1 from <parent>` exists-check. See `0001_init.sql:409-453` for the full list and the per-policy wiring.

This layer covers every read or write that flows through a connection authenticated as a Supabase user. The acceptance test the build-spec demands (`acqu-os-build-spec.md` §3) — *a query authenticated as tenant A returns zero rows from tenant B across every table including the vector store* — is exactly what `tool.isolation-test-suite` (Phase 9, `packages/tool-rls-test`) automates and what `tenant-isolation-tester` (D5.3) runs daily.

**Layer 2 — server-side allowlist in the Runner.** RLS is bypassed by the service-role connection the runner uses (`DATABASE_URL` in `apps/runner`). The runner must therefore enforce tenant scope in code:

- `claimNextRun(db, agentId, tenantId, runner)` (`packages/core/src/claim.ts:24`) requires both `agentId` *and* `tenantId` in the SQL `where` clause; an agent claim never crosses tenants.
- `buildBundle(db, runId, baseUrl, opts)` (`packages/core/src/bundle.ts:76`) hydrates everything from `run.tenantId` — knowledge retrieval is scoped via the agent's `knowledge_scope_json` folders (`bundle.ts:107`) but the underlying `retrieve()` call in `packages/core/src/knowledge.ts:93` is constrained `where tenant_id = ${args.tenantId}`. The vector retrieval cannot cross tenants by construction.
- The runner's `/next` endpoint refuses work for any agent whose `lifecycle_state !== 'active'` (`HANDOFF-other-session.md` §1; `apps/api/src/index.ts` near line 119). The lifecycle check is per-request.

### 2.2 The RLS test infrastructure already in the repo

`packages/tool-rls-test/` exists (per `09-CONTEXT.md` D-02). It opens a **separate** non-service-role connection (`RLS_TEST_DATABASE_URL`) and sets `auth.uid()` per-test via `SET LOCAL`. This is the only correct way to verify RLS — running the test against the service-role connection would make every cross-tenant query trivially succeed (Pitfall 1 in `09-CONTEXT.md` D-01).

The test infrastructure is the *load-bearing gate* for going public. From `09-CONTEXT.md` D-06: "an isolation-test run dispatched against live Supabase with 2+ tenants returns ZERO cross-tenant leaks" is the Phase-10 entry gate, and per `CLAUDE.md` non-negotiable #5 it is the second of the three hard gates.

### 2.3 What is shared (global registries) vs tenant-scoped

This is genuinely under-decided in the codebase today and worth surfacing. The current state in `0001_init.sql`:

- **`skills.tenant_id NOT NULL`** (line 234) — every skill row is per-tenant. `scope='global'` is a column on the row but the row itself is tenant-owned. Today, the seed scripts insert one skill row per tenant for "global" skills.
- **`mcps.tenant_id NOT NULL`** (line 254) — every MCP connection is per-tenant. Good (credentials live per-tenant).
- **`tools.tenant_id NOT NULL`** (`0007_tools_registry.sql`) — every tool *registration* is per-tenant. The *definition* (input schema, what it does) is tenant-invariant.
- **`architect_blueprints.tenant_id NOT NULL`** (`0006`) — correctly per-tenant.

**The unresolved question (an Open Question below):** should the *definitions* of skills and tools — name, description, input schema, repo path — be *one row* in a global registry table (e.g. `skill_defs`, `tool_defs`) and have `skills`/`tools` join to it? Two reasons it matters:

1. **Maintenance.** A bug fix in `skill:verification-before-completion` should propagate to every tenant. Today, it's an N-row update.
2. **Public surface.** GenX users will see "the Cliently skill library" — that's marketing, but the data model should make it cheap. A `skill_defs` global table with public read access (the row is *not* tenant-scoped; RLS allows read for any authenticated user, write only for platform admins) is the clean shape.

**Recommendation.** Keep `skills.tenant_id` as the *binding* row (tenant subscribes to / has enabled the skill); add a `skill_defs` global table for the definition. Same for `tools` → `tool_defs`. Don't ship this in the same migration as anything else; it's a substantive refactor that touches the seed scripts. See Open Questions.

### 2.4 What the runner sees

The runner is `apps/runner/`. It runs per a `RUNNER_AGENT_IDS` env-var allowlist (`apps/runner/src/config.ts:17`) — each runner process is bound to a specific set of agents in a specific tenant. The bundle it builds for each run (`bundle.ts:7`) carries an `agent.runnerKind` field (`local|remote`) for the future split between Acqu-internal runners and per-client runners. For the multi-tenant case, the operational shape is:

- One **shared** runner fleet for Acqu's agents (`runnerKind='local'`).
- One runner pool per high-value client (`runnerKind='remote'`, dedicated process) — gives per-client cost attribution and blast-radius isolation.
- Public/GenX: one large shared pool, autoscaled, with hard per-tenant concurrency caps (Section 7 — Open Q on enforcement).

The `claim_next_run()` SQL function in `0001_init.sql:391` (also wrapped in `packages/core/src/claim.ts:24`) uses `FOR UPDATE SKIP LOCKED` so concurrent runners never collide on the same row.

---

## 3. Agent runtime

### 3.1 The loop, with file cites

The scheduler → claim → bundle → runner loop is implemented and shipped (Phases 1-8.5, per `HANDOFF-other-session.md`). Trace through the existing code:

1. **Materialization** — `packages/core/src/scheduler.ts:18` `evaluateDueJobs(db, now)` walks every enabled job, computes the previous cron tick (`packages/core/src/cron.ts`), and inserts a `runs` row with `status='scheduled'`. Idempotent via the `gte(runs.scheduledFor, tick)` dedupe check.
2. **Inngest delivery** — `packages/inngest/src/functions/runScheduled.ts:21` listens for `agent/scheduled.run` events emitted by pg_cron (migration `0008_pg_cron_to_inngest.sql`) and dispatches them in parallel. This replaces the original Postgres-table worker loop (Main §2.1).
3. **Claim** — `packages/core/src/claim.ts:24` `claimNextRun(db, agentId, tenantId, runner)` updates the row to `status='running'` under `FOR UPDATE SKIP LOCKED`. Pending (resumed-from-approval) rows are claimed before scheduled ones — that's how the approval bridge resumes.
4. **Bundle** — `packages/core/src/bundle.ts:76` `buildBundle(db, runId, baseUrl, opts)` assembles: the agent row, the job row, scoped docs, skills, MCPs (with fresh short-TTL credentials via `opts.resolveToken`), tools, knowledge chunks (via `opts.retrieveKnowledge`), env vars (decrypted via `opts.decryptEnv` from the vault — never plaintext at rest), and an `api.{statusUrl,activityUrl,approvalsUrl}` set the runner uses to call back.
5. **Execute** — `apps/runner/src/execute.ts:1` constructs a system prompt from the bundle (`buildSystemPrompt`, line 16) and dispatches to the Claude Agent SDK (live path) or the dry-run simulator (line 42). The Anthropic gateway is OpenRouter via `ANTHROPIC_BASE_URL=https://openrouter.ai/api` (Main §1.2; `HANDOFF-other-session.md` §6).
6. **Safety hooks** — `apps/runner/src/hooks.ts`. PostToolUse writes `audit_log` and an `allow` autonomy event (line 18). PreToolUse runs `autonomyGate({toolName, autonomy, escalationPolicy})` from `packages/core/src/autonomy.ts:50`; a `propose` decision creates an `approvals` row, posts an autonomy event, and parks the run in `status='waiting'` with the `sdkSessionId` recorded for resume. Stop / SessionEnd writes the run summary and finalizes cost (`packages/core/src/lifecycle.ts`).

### 3.2 Sandboxing

The doctrine names "sandbox_name" on the agent registry row (`acqu-os-build-spec.md` §3) but the current schema in `0001_init.sql:112-133` does **not** carry a sandbox field. The runner runs the agent as a child process of the runner process; there is no hard OS sandbox. The defenses today are:

- The Agent SDK's permissions model — `permissionMode` set per autonomy in `apps/runner/src/execute.ts:34`: `bypassPermissions` for `execute_full`, `acceptEdits` for `execute_safe`, `plan` for `propose`.
- `deriveAllowedTools` in `apps/runner/src/custom-tools.ts` constrains the SDK's `allowedTools` to exactly the bundle's bound tools.
- The SSRF guard in `packages/tool-browser/src/index.ts` (Main §2.2).
- The approval gate (the SDK can never *complete* an irreversible call without an `approvals` row decision when autonomy is `propose|execute_safe`).

For Cliently and GenX, this is sufficient *only because the runner process never holds a multi-tenant credential*. Each runner is per-tenant-scoped (via `RUNNER_AGENT_IDS`); cross-tenant blast radius from a compromised runner is one tenant. Open Question: should public-stage runners run inside ephemeral Browserbase sandboxes (Main §2.2) or Cloud Run jobs for per-run isolation? — flagged.

### 3.3 Retry, cost cap, concurrency

- **Retry.** Inngest provides step-level retry (Main §2.1). A stuck run is killed and requeued once by `runner-ops` (`v2` D5.2); a second stall quarantines (`v2` E.5 routing).
- **Cost cap (per run).** `agents.budget_cap_usd` (column `0001_init.sql:126`) is the per-run cap. The Stop hook (`packages/core/src/lifecycle.ts`) writes the final `runs.cost_usd`; the PreToolUse hook in `autonomy.ts` (Open Q — projection is currently approximate) blocks further tool calls if projected cost exceeds the cap. **Gap to flag:** `checkBudget` in `packages/core/src/cost.ts:46` checks the *monthly tenant* budget against `runs.cost_usd` sum; per-run budget enforcement during a live run is the doctrine intent but the code path is partial. See Section 7.
- **Concurrency.** Per-tenant concurrency caps don't exist as a column. The implicit limit is the number of runners times the `RUNNER_AGENT_IDS` per runner. For hundreds of agents per tenant × N tenants, the missing primitive is a `tenants.max_concurrent_runs` column + a count check in `/next`. Flagged.

### 3.4 Scaling envelope — hundreds of agents per tenant × many tenants

Each agent is a row in `agents`. Each run is a row in `runs`. The cron/Inngest path is O(jobs × tenants). The bottlenecks, in order:

1. **Postgres connection ceiling** — `claim_next_run` is `FOR UPDATE SKIP LOCKED` so it scales lockless, but every runner needs a connection. Solution: Supabase Postgres connection pooling (PgBouncer) is on by default; runners use the transaction-pooler endpoint.
2. **Model spend per tenant** — far more likely the binding constraint than DB. Tier matrix in `CLAUDE.md` plus the per-tenant model override (`0009`) is the lever.
3. **Inngest step volume** — has its own per-step pricing (`HANDOFF-other-session.md` §8 Open Q #4). Profile early.
4. **`is_tenant_member()` join cost** — a `security definer stable` function on every RLS query. Indexed via `tenant_members_user_idx` (`0001_init.sql:71`). Already optimized; flag if EXPLAIN shows otherwise.

---

## 4. Registries

### 4.1 Skill registry

- **Schema.** `skills` (`0001_init.sql:234`, `schema.ts:196`) with `tenant_id`, `key` (unique per tenant), `source ∈ {github,builtin,custom}`, `repo_path`, `scope ∈ {global,project}`, `version`.
- **Binding.** `agent_skills` join (`0001_init.sql:144`) — per-agent skill list.
- **Discovery — current.** `packages/core/src/seed/seedAgent.ts` resolves SKILL.md files from a `skillSource` (file-disk path under `external/acqu-skills/`). When the file is missing, the row is still registered with `version='0.0.0'` (`HANDOFF-other-session.md` §7 — tolerated by design so prompts can reference skills before authors land them).
- **Discovery — future.** GitHub sync (Main §3.1 + the original superpowers spec). `skills.source='github'` and `repo_path` are wired in the schema; the sync worker isn't built. A `skill-librarian` (D6.2) is the agent that watches usage stats and proposes new skills.

### 4.2 MCP registry

- **Schema.** `mcps` (`0001_init.sql:254`, `schema.ts:211`) + `oauth_credentials` (line 270).
- **Binding.** `agent_mcps` (line 150).
- **Discovery.** `ensureMcp` shape mirrors `ensureTool` (Main §2.5). Each MCP knows its `auth_type ∈ {none, api_key, oauth}` and `endpoint`.
- **Credential resolution at run time.** `buildBundle` calls `opts.resolveToken(mcpId)` (`bundle.ts:151`) — a runner-injected resolver that hits the vault (or Nango at productization) and returns a fresh short-TTL token. **A long-lived token in the bundle is a finding** for `secrets-rotation` (D5.3).
- **Stage 2/3 swap.** The connector interface is intact (Main §2.4 "the interface is the asset"). Internal stays vault; client/public stage switches `resolveToken` to a Nango-backed implementation per connector. Migrate connector-by-connector; vault stays as fallback. **Don't rip out the vault.**

### 4.3 Tool registry

- **Schema.** `tools` (`0007_tools_registry.sql`, `schema.ts:226`) + `agent_tools` join.
- **Kinds.** `kind ∈ {custom, mcp}`. Custom tools are deterministic functions registered in the runner's `customToolDispatch` (Phase 7); MCP tools are projections of MCP server-exposed tools.
- **Discovery.** `ensureTool(db, spec)` in `packages/core/src/seed/` upserts by `(tenantId, key)`.
- **Approval flags.** `requires_approval` + `reversible` are columns on `tools` (`schema.ts:235-236`); `autonomyGate` reads them.

### 4.4 OAuth vault

- **Today.** `oauth_credentials.vault_ref` (`schema.ts:245`) points to an entry encrypted with `AOS_VAULT_KEY` (env). Per-tenant scoping by FK to `mcps`.
- **At productization (Main §2.4).** Nango behind the same connector interface. The decision rule from Main: *internal-only speed → Composio acceptable; anything client-facing → Nango.* The vault stays as fallback; migration is per-connector, never rip-and-replace.

---

## 5. Knowledge store + retrieval

### 5.1 Tables and lineage

- `knowledge_folders` (`0001_init.sql:293`) — folder tree, parent_id is self-referential for nesting.
- `documents` (`0001_init.sql:303`) — name, type, `source ∈ {upload, drive-sync, agent-generated, call-transcript}`, `vector_indexed` flag.
- `doc_chunks` (`0001_init.sql:319`) — `embedding vector(1536)`, with `vector_namespace` for the agent-scope filter.
- All three tables carry `tenant_id` and are RLS-protected via `tenant_rw` (`0001_init.sql:432`).

### 5.2 Indexing path

`packages/core/src/knowledge.ts:63` `indexDocument(db, embedder, args)` chunks (`chunkText` line 36 — paragraph/sentence boundaries, default 1200 char with 150 overlap) and writes `doc_chunks` rows. The dev embedder is a deterministic hashed bag-of-words (`hashEmbedder`, line 16) — no API key needed for local. In production swap to Voyage or OpenAI (Main §5 mentions; Open Q on selection).

### 5.3 Retrieval path — and the Rerank 4 Pro lever (Main §1.4)

`retrieve(db, embedder, args)` at `knowledge.ts:93` does cosine-distance search constrained to `tenant_id` + optional `namespaces` (the agent's `knowledge_scope_json.folders` from `agents.knowledge_scope_json`). The bundle assembles knowledge via `opts.retrieveKnowledge` (`bundle.ts:111`) using the agent's persona+job-instructions as the query.

**Rerank 4 Pro slot.** Per `CLAUDE.md` model tiering note and Main §1.4: after vector retrieval, candidates pass through Rerank 4 Pro and the top-K reranked chunks land in the bundle. This is a quality lever on every retrieval and **independent of the chat-tier plan**. It is currently **not implemented** — a `rerank` hook on the `retrieve()` return is the cleanest insertion point.

### 5.4 Write-back: agents grow the KB

`packages/core/src/lifecycle.ts` already writes each terminal run's summary as a `run-summary_*` document under a memory namespace (file:lifecycle.ts, function searching `kb:run-logs/`). This is the inbound side of the learning loop (`v2` §E.6). The `memory-consolidator` (D6.2) is the agent that reads those summaries and proposes durable lessons. Today the consolidator agent is *seeded as data* (Phase 4 manifest); the consolidation engine (`tool.memory-consolidation-engine`, `v2` C/D6.2) is **not yet a deterministic tool** — it's prompted from the agent. That works but isn't ideal; tooling it deterministically is the path to higher-quality consolidation.

### 5.5 Tenant scoping is enforced at three layers

1. RLS on `documents` and `doc_chunks` (`0001_init.sql:432`).
2. The `where tenant_id = ${args.tenantId}` filter in `retrieve()` (`knowledge.ts:108`).
3. The `tool.isolation-test-suite` (Phase 9) tests cross-tenant vector retrieval explicitly (D-06 in `09-CONTEXT.md`).

A prompt-injection attack from one tenant's data trying to make an agent retrieve another tenant's chunks is foreclosed by the runner-side scope (the agent never sees a query function that accepts an arbitrary `tenant_id` — only the bundle's resolver, hard-wired to `run.tenantId`).

---

## 6. Governance

### 6.1 Autonomy tiers

Three values on `agents.autonomy` (`0001_init.sql:123` check constraint): `propose | execute_safe | execute_full`. Decided in `packages/core/src/autonomy.ts:50` `autonomyGate({toolName, autonomy, escalationPolicy})`:

- `execute_full` → `allow` (caller is trusted to have pre-approved scopes).
- `execute_safe` and `propose` → `allow` for reversible (read-only verb prefix list at `autonomy.ts:7`), `propose` for irreversible.
- `escalation_policy` can carry `always_allow: tool1, tool2` to whitelist specific irreversible tools (`autonomy.ts:32`).

New agents always seed at `autonomy='propose'` (`docs/specs/agent-architect.md` Non-goals). Promotion is **earned from eval/approval-rate metrics**, not granted by the prompt (`CLAUDE.md` non-negotiable #1).

### 6.2 Approvals inbox

- **Schema.** `approvals` (`0001_init.sql:347`, `schema.ts:307`) — `context`, `proposed_action`, `options_json`, `status ∈ {open,decided,expired}`, `decided_by`, `decided_at`.
- **Lifecycle.** PreToolUse hook posts an approval, parks the run in `status='waiting'` with the `sdkSessionId` recorded. The dashboard inbox + Slack mirror render `options_json`. On decision, the run resumes (the `claim_next_run` query prefers `pending` over `scheduled` — `claim.ts:35`).
- **Always-gated actions (Main §5 / doctrine 3.3):** money, contracts, Meta kills/publishes, scope changes, hiring, pricing, cross-tenant access.

### 6.3 Audit log

- **Schema.** `audit_log` (`0001_init.sql:363`) — `tool_name`, `input_hash`, `result`, `ts`.
- **Writer.** `writeAudit` in `packages/core/src/cost.ts:62`, called from PostToolUse (`apps/runner/src/hooks.ts:35`).
- **Companion:** `autonomy_events` (`0003`) records every `propose|allow|deny` decision with `tool_name` and `rationale` — the trail of how each tool got greenlit.

### 6.4 Lifecycle states (added `0009`)

`agents.lifecycle_state ∈ {draft, active, paused, archived}`. APIs at `apps/api/src/index.ts` `POST /api/admin/agents/:id/{activate,pause,archive,draft}` (`HANDOFF-other-session.md` §1). The runner refuses work for any agent that isn't `active`. This is what makes the *autonomous team* primitive work — the Agent Manager (`docs/agent-manager-spec.md`) hires/fires by flipping these states.

### 6.5 Security findings (added `0010`)

`security_findings` (`0010_security_findings.sql`, `schema.ts:401`) — durable artifact for every D5.3 agent. `category ∈ {isolation, rotation, access, anomaly}`, `severity ∈ {low, medium, high, critical}`, `status ∈ {open, acknowledged, resolved, suppressed}`. Per-category structure in `payload` JSONB. RLS-protected per tenant.

---

## 7. Cost / credit metering

### 7.1 What exists today

- **Per-run cost.** `runs.cost_usd numeric(12,4)` (`0001_init.sql:197`) + `tokens_in`/`tokens_out`. Written at run end by the SessionEnd hook (`packages/core/src/lifecycle.ts`).
- **Per-tenant aggregation.** `costSummary(db, tenantId, sinceDays)` in `packages/core/src/cost.ts:11` produces by-day and by-agent rollups via SQL `sum(cost_usd)`.
- **Monthly budget check.** `checkBudget(db, tenantId)` in `packages/core/src/cost.ts:46` sums month-to-date `runs.cost_usd` against `tenants.monthly_budget_usd` (`0001_init.sql:60`) and returns `level ∈ {ok, warn, over}` at 0/80/100%.
- **Per-run cap.** `agents.budget_cap_usd` (`0001_init.sql:126`) is the per-run ceiling.

### 7.2 What is missing for tenant-level billing aggregation

The platform is designed for *cost accounting* but the *billing meter* primitives are partial. Specifically:

1. **No reserve/commit pattern.** Cost is written at run end. There is no pre-flight reservation; a run that goes over the per-run cap can overshoot during the in-flight tool calls. (`checkBudget` returns `over` only after the fact.) For Cliently/GenX billing, the production-grade shape is: reserve the projected max at run start, commit the actual at run end, release the difference. **Recommendation:** add `runs.reserved_usd` + a SQL trigger that decrements a per-tenant available budget on insert, increments on commit.

2. **No price catalog per provider.** The cost-tracking module trusts whatever the runner records. Main §5 specifically calls out that *cost reporting must not assume OpenRouter for everything* — pricing should be table-driven per provider. **Recommendation:** a `model_prices` global table (model_slug, provider, in_per_mtoken, out_per_mtoken, effective_from) and a `priceRun(tokensIn, tokensOut, model)` helper. Today the runner approximates.

3. **No usage → invoice rollup.** No `invoices`, `invoice_lines`, `usage_meters` tables. For Cliently white-label this is OK (out-of-band billing). For public GenX self-serve it's essential. Out of scope for *this* plan but the contract is: per-tenant per-month aggregate from `runs.cost_usd` is the input; output goes to Stripe Billing (which is the `tool.billing-engine` from `v2` D4.1).

4. **No per-tenant active-agent cap.** `HANDOFF-other-session.md` §"What to push back on" calls this out: "spin up 100 agents in parallel" is cost-linear in active agent count × cron frequency. The missing primitive is `tenants.max_active_agents` + a check on `lifecycle_state` transitions. Flagged.

### 7.3 Per-run vs per-tool token accounting

`runs.tokens_in` and `runs.tokens_out` are per-run aggregates. There is no per-tool-call token accounting. Per-tool granularity would help eval-driven model promotion (which tool's prompt blew the budget?), but is not in today's schema. Open Q on priority.

---

## 8. Telemetry / pixel ingestion layer — THE CONTRACT

> Section 8 is the most concrete section in this plan because two sibling plans (`AGENTS-PLAN.md` and `GENX-PLAN.md`) consume it as a contract. Tables, columns, ingestion path, consent boundary. This is `/apps/platform/` per the mandate.

### 8.1 Position statement

**One pipeline. Two faces.** Internal product analytics ("are agents healthy?") and the external GenX "pixel" SDK ("did the user's website convert?") write to the **same `events` table** in the **same Supabase project**, tagged differently. The pipeline is `/apps/platform/` per the operator's mandate. Branding diverges externally; the data path does not.

### 8.2 Canonical event schema (proposed)

A new migration (proposed `0011_events.sql`). All columns required unless marked nullable.

```sql
create table events (
  -- Identity / routing
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  project_id      uuid references projects(id) on delete set null,        -- nullable: not every event is project-scoped

  -- Provenance — which face is writing
  source          text not null check (source in (
                    'agent',        -- a runner/agent emitted this (every tenant, every stage)
                    'platform',     -- the OS itself (scheduler tick, hook fire, approval decision)
                    'app',           -- the control-plane web app (user action)
                    'pixel',         -- the external GenX SDK (browser/server beacons from a public tenant's site)
                    'connector',    -- an MCP / Nango webhook fired through
                    'system'         -- background jobs, migrations, deploys
                  )),
  source_version  text,                                                    -- SDK or service version

  -- The event
  event_name      text not null,                                           -- dotted namespace: 'agent.run.completed', 'pixel.page.view', 'app.approval.decided'
  event_id        text,                                                    -- idempotency key (client-supplied for pixel events)

  -- Subject — what or who the event is about
  actor_kind      text check (actor_kind in ('user','agent','run','tool','external','anonymous')),
  actor_id        text,                                                    -- uuid for internal kinds; opaque for pixel (anon visitor id)
  subject_kind    text,                                                    -- 'run','agent','document','approval','session', ...
  subject_id      text,

  -- Context
  run_id          uuid references runs(id) on delete set null,             -- if generated during an agent run
  agent_id        uuid references agents(id) on delete set null,
  approval_id     uuid references approvals(id) on delete set null,
  audit_log_id    uuid references audit_log(id) on delete set null,

  -- Payload
  properties      jsonb not null default '{}'::jsonb,                       -- the event-specific payload
  metrics         jsonb not null default '{}'::jsonb,                       -- numeric counters/durations for fast rollups
  context         jsonb not null default '{}'::jsonb,                       -- request/session/device metadata
                                                                              -- includes ip_hash, user_agent_hash, locale, page, referrer for pixel events

  -- Consent (Section 8.5)
  consent_level   text not null default 'analytics' check (consent_level in (
                    'none',         -- do not persist (event dropped at ingest if consent missing)
                    'analytics',    -- aggregate analytics only — must scrub PII before storage
                    'product',      -- product-level instrumentation, no third-party share
                    'full'           -- the tenant has explicit consent for vendor-level outbound (Section 8.6)
                  )),
  pii_scrubbed    boolean not null default false,                          -- set true after the scrubbing pass

  -- Time
  occurred_at     timestamptz not null,                                    -- when the event happened (client clock for pixel; server for agent/platform)
  ingested_at     timestamptz not null default now(),                      -- when we wrote it
  ingest_skew_ms  integer                                                  -- abs(ingested_at - occurred_at) for pixel clock-skew monitoring
);

create index events_tenant_time_idx on events(tenant_id, occurred_at desc);
create index events_tenant_name_time_idx on events(tenant_id, event_name, occurred_at desc);
create index events_run_idx on events(run_id) where run_id is not null;
create index events_agent_idx on events(agent_id) where agent_id is not null;
create index events_source_idx on events(source);
create index events_event_id_unique on events(tenant_id, event_id) where event_id is not null; -- idempotency

-- RLS — same pattern as every other tenant-scoped table.
alter table events enable row level security;
create policy events_rw on events
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
```

**Companion tables:**

```sql
-- Where a tenant wants events forwarded (warehouses, webhooks, Slack, email).
create table event_destinations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  kind            text not null check (kind in ('webhook','slack','email','snowflake','bigquery','s3','postgres')),
  config          jsonb not null,                       -- destination-specific (URL, channel, dataset...)
  filter          jsonb not null default '{}'::jsonb,    -- event_name / source filter
  consent_required text not null default 'product',     -- minimum consent_level to forward to this destination
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table event_destinations enable row level security;
create policy event_destinations_rw on event_destinations
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- The delivery log — every outbound attempt.
create table event_sinks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  destination_id  uuid not null references event_destinations(id) on delete cascade,
  status          text not null check (status in ('queued','sent','failed','dropped_consent')),
  attempts        integer not null default 0,
  last_error      text,
  sent_at         timestamptz
);
alter table event_sinks enable row level security;
create policy event_sinks_rw on event_sinks
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
```

### 8.3 Ingestion path

The pipeline shape, in the order events flow:

```
Source                            → Endpoint                       → Validator           → Enricher          → Writer        → Forwarder
─────────────────────────────────   ──────────────────────────────   ─────────────────    ────────────────    ────────────    ───────────────────
Agent runner (any tenant)          POST /events (server-key auth)   schema + tenancy     run_id/agent_id     events table    (queue → event_sinks)
Platform (hooks, scheduler)        in-process emit()                schema-only          implicit            events table    (queue → event_sinks)
Control-plane app (user actions)   POST /events (session auth)      schema + user-tenant approval_id...      events table    (queue → event_sinks)
GenX pixel SDK (public tenant)     POST /pixel  (public site key)   consent + signature  ip_hash/ua_hash     events table    (queue → event_sinks)
MCP / Nango webhooks               POST /events (HMAC)              schema + signature   mcp_id              events table    (queue → event_sinks)
```

**Implementation, file by file:**

- `apps/platform/` — the new sub-app. Hono routes mirror `apps/api/`'s shape.
- `apps/platform/src/routes/events.ts` — internal endpoint. Accepts an array of events; rate-limited per tenant; validates tenant membership via the server-side API key (`api_keys`, `0001_init.sql:377`).
- `apps/platform/src/routes/pixel.ts` — public endpoint. Accepts events keyed by `tenant_id` + a tenant-public site key (new field on `tenants` — Open Q on table). CORS-open with origin validation against `tenants.allowed_origins` (proposed nullable column). Validates an HMAC signature for server-side beacons; browser beacons rely on origin + consent_level enforcement.
- `apps/platform/src/ingest.ts` — write to `events`. Idempotency check via `(tenant_id, event_id)` unique index. PII scrubber runs synchronously for `consent_level='analytics'` rows.
- `apps/platform/src/forwarder.ts` — Inngest worker that fans events into `event_sinks` per `event_destinations` config. Outbound delivery is best-effort with exponential backoff; `event_sinks.status='dropped_consent'` when a destination's `consent_required` exceeds the row's `consent_level`.

### 8.4 Canonical event names (the dotted namespace)

Both faces share the namespace. Examples (non-exhaustive — the seed list):

- `platform.scheduler.tick`, `platform.run.materialized`, `platform.run.claimed`, `platform.run.completed`, `platform.run.failed`, `platform.run.cost.overshoot`, `platform.budget.warn`, `platform.budget.over`, `platform.lifecycle.changed`.
- `agent.tool.proposed`, `agent.tool.executed`, `agent.tool.denied`, `agent.knowledge.retrieved`, `agent.summary.written`.
- `app.user.signed_in`, `app.tenant.switched`, `app.approval.decided`, `app.architect.proposed`, `app.architect.seeded`.
- `connector.health.degraded`, `connector.health.recovered`, `connector.auth.expiring`, `connector.auth.expired`.
- `security.finding.opened`, `security.finding.resolved`, `security.isolation.failed` (P0 — always alerts).
- `pixel.page.view`, `pixel.session.start`, `pixel.form.submit`, `pixel.conversion.recorded`, `pixel.identify`.
- `genx.signup.started`, `genx.signup.completed`, `genx.architect.proposal.viewed`, `genx.team.activated`, `genx.first_value.reached`.

**Rule.** New event names go through a code-reviewed seed list (a file under `apps/platform/src/events/registry.ts`) that enumerates canonical names + expected `properties` shape. `event-schema-guardian` (`v2` D3.1, `acqu-phase-3` manifest) is the agent that audits the table for unknown event names and flags drift.

### 8.5 The consent boundary

The non-negotiable: `consent_level` is enforced at *ingest* (dropped before storage when `'none'`), at *storage* (PII scrubber runs for `'analytics'`), and at *forwarding* (`event_destinations.consent_required` floor). The four levels mean:

- `none` — never persist. (The pixel SDK fires this when a visitor has rejected cookies; we still get the *count* via a separate aggregate counter but no row lands.)
- `analytics` — persist, but scrub anything that could identify a person: `properties` / `context` go through the scrubber, `ip_hash` replaces raw IP, `user_agent_hash` replaces raw UA. **No PII at rest.**
- `product` — persist with full context for internal product analytics; not eligible for outbound forwarding to third parties.
- `full` — explicit consent given (signed terms, etc.) — eligible for outbound forwarding to vendor destinations.

**The consent boundary is the load-bearing trust surface for stages 2 and 3.** A breach of it (PII landing in a row that shouldn't have it, or forwarding to a destination above its consent_level) is the same magnitude as a tenant-isolation failure. Recommendation: add an `event-consent-tester` agent under D5.3 alongside `tenant-isolation-tester`. Open Q.

### 8.6 Why the same pipeline for both faces

1. **Operational economy.** Two pipelines means two schedulers, two outbound delivery paths, two PII scrubbers, two consent enforcements. A single pipeline is half the surface area.
2. **Cross-face joins are free.** "Did this `pixel.page.view` from tenant X lead to a `genx.signup.completed` from the same anon→identified user?" requires the events to live in the same table.
3. **The schema captures provenance.** `source ∈ {agent, platform, app, pixel, connector, system}` is the only thing that distinguishes "Acqu emitted this internally" from "a GenX customer's pixel emitted this." Filtering for one face is `WHERE source = 'pixel'`.
4. **One PII scrubber, one consent gate.** Both faces share. The pixel face *demands* a strict consent gate; the agent face is internal. Same gate, two strictness configs.

### 8.7 Backward-compat with existing observability tables

`audit_log`, `autonomy_events`, `run_activity`, `security_findings` already exist and are well-shaped. They are *not* replaced by `events` — they remain the system-of-record for their specific concerns (audit, decisions, run trace, security). `events` is the *firehose* for analytics and outbound. Each operational write to those tables also emits a corresponding event row (the PostToolUse hook writes `audit_log` *and* emits `agent.tool.executed`). Duplication is fine — they serve different consumers (SQL queries vs analytics warehouses).

### 8.8 What sibling plans consume from this section

- `AGENTS-PLAN.md` reads §8.4 for the agent-side event names it must emit and §8.5 for the consent rules.
- `GENX-PLAN.md` reads §8.2 (the pixel SDK ships data that fits this schema), §8.3 `/pixel` endpoint contract, §8.5 (the consent boundary it must respect at the SDK layer), and §8.6 (why one pipeline).

---

## 9. Build sequence with gates + honest exists-today / missing list

### 9.1 What exists today (the platform substrate is shipped through Phase 8.5 + Phase 9 in progress)

Per `HANDOFF-other-session.md` + the phase summaries in `.planning/phases/`:

**Shipped:**
- Phase 0/1 — Foundation, monorepo, Supabase migrations `0001-0005`, RLS via `is_tenant_member()`, safety hooks 1a/1b/1c.
- Phase 2 — Doctrine batch seed Phase-1 + the 8-agent Phase-2 batch including `ad-claim-compliance` (`docs/acqu-phase-{1,2}-agent-manifest.md`).
- Phase 3/4 — Architect (plain-English → blueprint → seed), `architect_blueprints` table (`0006`), 33/33 unit tests.
- Phase 5 — `ad-claim-compliance` T-critical gate landed; 12-agent Phase-3 batch (`acqu-phase-3-agent-manifest.md`).
- Phase 6 — 22-agent Phase-4 batch (`acqu-phase-4-agent-manifest.md`).
- Phase 7 — `tools` registry (`0007`), `@agent-os/inngest` package, pg_cron → Inngest (`0008`), `@agent-os/tool-browser` with SSRF guard.
- Phase 8 — same as Phase 6 (Phase-4 batch).
- Phase 8.5 — `agents.lifecycle_state` + `tenants.default_model_override` (`0009`); lifecycle API endpoints.
- Phase 9 (in progress on `claude/exciting-davinci-yvptm`) — `security_findings` (`0010`), four D5.3 security agents (`tenant-isolation-tester`, `secrets-rotation`, `access-auditor`, `security-anomaly-watchdog`), `packages/tool-rls-test/`.

**The runtime path works end-to-end** (scheduler → claim → bundle → execute → safety hooks → run summary) per `acqu-os-build-spec.md` §4-5 acceptance tests.

### 9.2 What is missing relative to doctrine

- **Telemetry layer (`/apps/platform`)** — not yet created. This plan's Section 8 is the spec.
- **Live Browserbase backend** for `tool.browser` — Phase 7 ships SSRF + a Node-fetch fallback (`HANDOFF-other-session.md` §7). Stagehand-on-Browserbase is the swap.
- **Nango connector layer** — vault works; the Nango adapter behind the connector interface is queued for client launch (Main §6 build delta #6).
- **Rerank 4 Pro in the retrieval path** — `CLAUDE.md` and Main §1.4 call for it; no code path exists today.
- **Per-provider model pricing table** — `Main §5` warns: cost reporting *must not* assume OpenRouter for everything. Today, `runs.cost_usd` trusts the runner-supplied number.
- **Reserve/commit budget pattern** — only after-the-fact `checkBudget` exists; per-run reservation does not.
- **Per-tenant active-agent cap and concurrency cap** — flagged in HANDOFF §"push back on."
- **Agent Manager** — spec exists (`docs/agent-manager-spec.md`); seed script does not (HANDOFF §3).
- **GitHub-sync skill registry** — `skills.source='github'` and `repo_path` are wired; the sync worker isn't.
- **Globalized skill / tool definitions** — see §2.3.
- **`agent_metrics` table** (the scorecard from `acqu-os-build-spec.md` §3) — does not exist. Promotion/demotion is currently manual.

### 9.3 The three hard gates that override sequence (from `v2` §F, `CLAUDE.md` non-negotiable #5)

1. **No client ad launches before `ad-claim-compliance` (D6.1) is live.** Status: shipped (Phase 2/5). Gate passable.
2. **No external multi-tenant Cliently/GenX before `tenant-isolation-tester` (D5.3) passes.** Status: agent + tool in progress on `claude/exciting-davinci-yvptm`. **This is the gate that blocks public launch.** Acceptance: a live-Supabase run with 2+ tenants reports zero cross-tenant leaks (`09-CONTEXT.md` D-06).
3. **No recurring billing before `dunning-manager` (D4.1) is live.** Status: agent seeded; the underlying `tool.billing-engine` + `tool.dunning-engine` (Stripe Billing wrapper) is *not yet shipped*. Gate **not** passable for billing until these tools land.

### 9.4 Recommended next sequence (after the in-progress Phase 9 merges)

| Order | Deliverable | Why now | Acceptance test |
|---|---|---|---|
| A | Merge Phase 9 (`claude/exciting-davinci-yvptm`) to `main`. Run `tool.isolation-test-suite` against a live Supabase with 2+ tenants. | Hard gate #2 evidence collected before any external work begins. | Zero cross-tenant rows across every table, including the vector store. |
| B | Build `apps/platform/` (this plan's Section 8). Migration `0011_events.sql` + `event_destinations` + `event_sinks`. Internal ingest first. | Lands the contract `AGENTS-PLAN.md` and `GENX-PLAN.md` need. Internal-first means we trust it before the pixel ships. | Existing safety hooks emit `agent.*` events alongside their existing writes; an event-name drift test passes. |
| C | Model-price table + per-provider pricing in `packages/core/src/cost.ts`. | Closes the Main §5 gap before Cliently billing depends on it. | A run on Hermes-70B costs differently from a run on Sonnet-4.6 in `runs.cost_usd`; backed by `model_prices`, not a runner constant. |
| D | Stripe Billing wrapper (`tool.billing-engine`) + `dunning-manager`'s `tool.dunning-engine`. | Closes hard gate #3. Required before any recurring billing. | A failed payment fires `connector.*` event; `dunning-manager` opens an approval; recovery confirmed end-to-end. |
| E | Nango adapter behind the connector interface (one connector first — Close per Main §6). | Closes Main §6 build delta #6. Required for white-label Cliently. | A Cliently-stage tenant connects Close via Nango; `oauth_credentials.vault_ref` resolves; runner gets a short-TTL token. |
| F | The Agent Manager (`docs/agent-manager-spec.md`). | Closes HANDOFF §3. Makes the autonomous-team loop real. | Manager runs daily at 10:00, opens 0-3 proposals, operator approves; lifecycle endpoint flips. |
| G | GenX SDK + `/pixel` endpoint (sibling `GENX-PLAN.md` covers this; the contract from §8 is the input). | Public stage prerequisite. | A demo public tenant fires `pixel.page.view` from a real browser, lands in `events`, respects consent. |
| H | Public/GenX launch — open signups. | All three hard gates green; security agents green; telemetry green. | Gate matrix below all green. |

### 9.5 The gate matrix (the only gates that block stage progression)

| Stage transition | Required to pass |
|---|---|
| Acqu only → first Cliently DFY client | Hard gates #1 (ad-claim-compliance) + #3 (dunning-manager + Stripe). Nango adapter for the connectors that client needs. |
| First Cliently client → multi-client white-label | Hard gate #2 (tenant-isolation-tester live + zero leaks). All D5.3 agents on `execute_safe`. Per-tenant model override audited. |
| White-label → public/GenX self-serve | Hard gate #2 still green on growing tenant set. `apps/platform/` shipped with consent boundary enforced. Per-tenant active-agent cap + concurrency cap in `tenants`. Rate-limit-guardian (D5.2) live. Architect cost cap per tenant (HANDOFF §7). |

---

## Open Questions for the operator

1. **`tenant_id` vs `org_id` rename.** The mandate names the column `org_id`; the codebase uses `tenant_id` everywhere (39 tables/columns, every RLS policy, every Drizzle entity in `packages/db/src/schema.ts`). Renaming is a large mechanical refactor that touches every file. Recommendation: **keep `tenant_id` in the code; surface "Organization" in the UI copy.** Decision needed; flagging as #1 per the mandate.
2. **The missing source docs `CLIENTLY-BRAIN.md` and `CLIENTLY-2.0-RESOLVED-DIRECTION.md`.** Operator named these — they don't exist in this repo. Are they in another repo, a Notion / Drive, or a still-being-written brain dump? Until they're in `/docs`, the strategic direction in this plan is *reconciled from what is in the repo*, not from those.
3. **The third stage's `tenants.type` value name.** Mandate calls it "GenX" externally but doesn't pin the column value. Proposal: `'public'`. Alternatives: `'genx'` (couples the column to a brand), `'self_serve'` (functional). Need pick before migration to widen the check constraint.
4. **Global skill/tool definition tables.** Section 2.3 proposes `skill_defs` and `tool_defs` global registries with `skills.tenant_id` becoming the binding. Real refactor; touches the seed scripts. Go/no-go?
5. **Per-tenant active-agent cap + concurrency cap on `tenants`.** Section 7.2 #4 + Section 3.3. Recommend `tenants.max_active_agents` and `tenants.max_concurrent_runs`. Both default-unlimited for Acqu, plan-derived for Cliently/GenX. Confirm.
6. **Reserve/commit budget pattern.** Section 7.2 #1 — `runs.reserved_usd` + a SQL trigger. Confirm priority before E (billing) ships.
7. **Per-provider `model_prices` table.** Section 9.2 + 9.4 C. Confirm shape (one row per `(model_slug, effective_from)`) before C ships.
8. **Embedder for production knowledge.** `hashEmbedder` is dev-only. Voyage, OpenAI, Cohere? Cost/quality tradeoff per `CLAUDE.md` model tier discipline. Cross-check this against the Rerank 4 Pro slot from Main §1.4.
9. **Public/GenX runner isolation level.** Section 3.2 — same Node child process as Acqu, or per-run ephemeral sandboxes (Browserbase / Cloud Run job)? Cost + isolation tradeoff.
10. **`event-consent-tester` agent in D5.3.** Section 8.5 — if GenX pixel ships with PII, a continuous test on the consent boundary is the same magnitude as `tenant-isolation-tester`. Add to the doctrine?
11. **Hermes-vs-Opus on can't-fail agents.** Carry-over from `HANDOFF-other-session.md` §2 — the operator set the tenant override to `nousresearch/hermes-4-405b` knowing it rewrites the 7 T-critical Opus agents. Re-confirm at each stage transition; the operator's decision was eyes-open and reversible.
12. **Architect cost cap per tenant.** `HANDOFF-other-session.md` §7 — Architect's per-proposal budget exists; tenant-wide cumulative cap does not. Required before the Agent Manager (deliverable F) gets autonomy to hire on its own.
13. **Inngest cost at scale.** Per-step pricing; cron volumes across hundreds of tenants. Profile before deliverable H (public launch).
14. **`tenants` should carry `timezone` and `allowed_origins`.** Implicit in stages 2/3 (cron schedule TZ; pixel CORS). Not in schema today. Confirm.
15. **`audit_log_id` FK on `events`.** §8.2 includes it; FK constraint creates a circular dependency if the audit row writes the event row and vice versa. Open Q on tightening the constraint to a soft reference vs a hard FK.
