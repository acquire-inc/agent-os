# GENX-PLAN

> Planning document — no production code. Sibling to `AGENT-OS-PLAN.md` (the platform) and `AGENTS-PLAN.md` (the canonical agent anatomy + Relay emission contract). This doc **consumes**:
> - The Relay schema (`relay_events`, `run_summaries`, the `relay_events_xtenant_agg` view) from `AGENT-OS-PLAN.md` §8.
> - The two-fence tenant-isolation model (RLS via `is_tenant_member()` + runner allowlist) from `AGENT-OS-PLAN.md` §2.
> - The canonical AGENT ANATOMY + per-agent Relay emission contract from `AGENTS-PLAN.md` §1–§2.
> - The 56-agent fleet inventory + the three anatomy divergences from `AGENTS-PLAN.md` §3.
> - The non-negotiables and three hard gates from `/home/user/agent-os/CLAUDE.md`.
> - The Nango-at-white-label-launch decision from `/home/user/agent-os/docs/main-acqu-agent-doctrine.md` §2.4.
>
> **Hard scope boundary.** AgentOS, agents, and GenX only. **Cliently is out of scope** — this document does not reconcile against any Cliently doc and does not mention Cliently below this line.
>
> **The one rule that governs every section.** GenX is **not** a new product, a new repo, a new Supabase project, or a new event pipeline. GenX is **this same platform** (`agent-os/`) exposed publicly via feature flags, config, theming, billing, and onboarding. Internal/Acqu is tenant #1 (`type='internal'`); white-label clients are tenants 2…N (`type='client'`, existing value); public open-signup users are tenants M…∞ (`type='public'`, the **one new value** proposed). Every recommendation below is framed as **a delta on the existing platform** — a new column, a new feature flag, a new HTTP route, a new SPA surface. If anything reads like a separate app or a separate DB, it is wrong and should be re-read.
>
> **The "Pixel" is the external SDK over the internal Relay.** There is **one** telemetry pipeline (`relay_events`) and **one** schema. The external "Pixel" SDK is a thin HTTP wrapper that POSTs into the same `relay_events` table via a tenant-API-key endpoint (`/relay/ingest`, owned by this plan and specced against `AGENT-OS-PLAN.md` §8.4). It is not a second telemetry system. Name collision with the Meta Conversions API "pixel" is acknowledged and surfaced in Open Questions; in this doc, capital-P **Pixel** means the GenX external SDK only.
>
> **The wedge.** Vertical depth (the 56-agent fleet, the doctrine, the can't-fail discipline) + the proprietary consented outcome dataset (`run_summaries` per tenant; cross-tenant aggregation only via the `relay_events_xtenant_agg` view, gated by `consent_scope='cross_tenant_aggregated'`). Not training an LLM; not competing as a horizontal agent CLI. The Pixel is the harvest mechanism; `run_summaries` is the proprietary outcome store; the cross-tenant view is the only legal egress.

---

## 1. The staging model — flags, config, surfaces. Table by table.

### 1.1 The three stages on one platform

| Stage | `tenants.type` | Who | Auth surface | Connector OAuth | Billing posture | Consent posture |
|---|---|---|---|---|---|---|
| **Internal (Acqu)** | `'internal'` (existing, `0001_init.sql:58`) | Us, tenant #1 | Supabase Auth + `tenant_members` (`0001_init.sql:65`) | Internal vault (`oauth_credentials` + `AOS_VAULT_KEY`, `0001_init.sql:270`) | None — Acqu pays | `tenant_only` by default; can opt in to `cross_tenant_aggregated` per-event |
| **White-label (paying tenants)** | `'client'` (existing, `0001_init.sql:58`) | DFY fulfillment clients | Supabase Auth + `tenant_members`; admin API key per tenant | Nango behind same connector interface (Main §2.4); vault stays as per-connector fallback | Contract-bound (`tenants.subscription_tier='white_label'` — proposed) | `tenant_only` default; opt-in cross-tenant via tenant settings UI |
| **Public (GenX self-serve)** | `'public'` (**NEW** value, requires widening the check constraint in `0001_init.sql:58`) | Anyone with a signup | Supabase Auth public signup; `tenant_members.role='owner'` minted on org creation | Nango from day one (no operator hand-holds OAuth at signup) | Free + paid tiers metered against `run_summaries.cost_actual_usd` | Same default `tenant_only`; cross-tenant opt-in surfaced in onboarding |

The discriminator is **one column** (`tenants.type`). Stage-specific behavior is feature flags + config, not separate tables, separate codebases, or separate Supabase projects. This is the same conclusion `AGENT-OS-PLAN.md` §1.2 lands on; restated here so a future contributor reading this doc in isolation does not drift.

### 1.2 Column-level deltas on existing tables

The exhaustive table-by-table audit lives in `AGENT-OS-PLAN.md` §1.3 (every tenant-scoped table; what changes per stage). **Most tables change nothing — that's the whole point.** This section enumerates only the *column-level deltas* that productization requires. Each delta is framed as "delta to an existing table" — never "new replacement table."

| Table (existing) | Delta required for productization | Cite |
|---|---|---|
| `tenants` (`0001_init.sql:54-63`, `schema.ts:25-36`) | **Widen `type` check constraint** to add `'public'` — currently `check (type in ('internal','client'))` (`0001_init.sql:58`). | New migration. Trivial; one `alter constraint`. |
| `tenants` | **Add `feature_flags jsonb not null default '{}'::jsonb`.** Does NOT exist today (grep on `feature_flag` against `/packages/db/src/schema.ts` + `/supabase/migrations/` returns zero). Keys proposed below in §1.3. Stage-specific behavior is gated by reading these. | NEW column on existing table. |
| `tenants` | **Add `subscription_tier text not null default 'internal' check (subscription_tier in ('internal','free','paid_T1','paid_T2','white_label'))`.** Drives billing meter behavior + onboarding default. `'internal'` for Acqu; `'white_label'` for clients; `'free' | 'paid_T1' | 'paid_T2'` for public. | NEW column on existing table. |
| `tenants` | **Add `max_active_agents int` and `max_concurrent_runs int`** (nullable = unlimited). The fairness primitive flagged as Open Q #4 in `AGENT-OS-PLAN.md` and §4.6 in `AGENTS-PLAN.md`. Stage-1 public free tier requires these to enforce caps. | NEW columns. |
| `tenants` | **Add `timezone text` and `allowed_origins text[]`** (Open Q #12 in `AGENT-OS-PLAN.md`). Timezone for cron schedule UX (white-label clients in different TZs); `allowed_origins` for the GenX Pixel SDK CORS at `/relay/ingest`. | NEW columns. |
| `tenants` | **Reuse existing `default_model_override text`** (Migration 0009; `schema.ts:34`). No delta. White-label and public tenants get a stage-appropriate default model override in the onboarding seeder (e.g. public-free → Hermes-70B at `T-cheap`). |
| `tenants` | **Reuse existing `monthly_budget_usd numeric(12,2)`** (`0001_init.sql:60`). No delta. The billing meter's hard-cap is this column; the meter compares `sum(run_summaries.cost_actual_usd)` against it. |
| `tenant_members` (`0001_init.sql:65`) | No delta. Role enum (`owner|admin|member|viewer`) already covers self-serve invite UX. |
| `api_keys` (`0001_init.sql:377`) | No delta — existing `kind in ('runner','external','admin')` already includes `'external'`, which is what the GenX Pixel SDK uses. **The Pixel reuses this table** — the per-tenant API key for `/relay/ingest` is a row in `api_keys` with `kind='external'`. |
| `agents` (`0001_init.sql:112`) | No delta. The lifecycle + budget + autonomy fields (`0009`) already support per-tenant gating. White-label tenants' agents start `enabled=false, lifecycle_state='draft', autonomy='propose'` — same as Architect-generated agents do today. |
| `runs`, `run_activity`, `autonomy_events`, `audit_log` | No delta — these are legacy spines. The Relay is `AGENT-OS-PLAN.md` §8's deliverable; this plan **does not redefine it**. |
| `oauth_credentials` (`0001_init.sql:270`) | No delta on schema. Behavior change: white-label + public tenants always resolve via Nango (Main §2.4). The vault stays as fallback per connector. |
| `knowledge_folders`, `documents`, `doc_chunks` | No delta. Public tenants start empty; cross-tenant retrieval is RLS-impossible (`AGENT-OS-PLAN.md` §2.1). |
| **NEW** `tenant_billing_meters` | **NEW table** (justified). Per `(tenant_id, billing_period_start)`, carries `reserved_usd`, `committed_usd`, `cap_usd`, `status ∈ {open,closed,exceeded}`. Tied to the reserve/commit pattern parked as Open Q #5 in `AGENT-OS-PLAN.md`. Rationale: the billing meter is a strictly different lifecycle from `tenants.monthly_budget_usd` (which is a static cap); the meter row is mutable per run and per billing period. Without this row, the per-run-reserve / commit transition has no atomic carrier. | NEW table. |
| **NEW** `tenant_pixel_keys` | **NOT NEEDED.** Resist the temptation to add this. Reuse `api_keys` with `kind='external'`. Add a `metadata jsonb` column on `api_keys` if Pixel-specific config (rate limits, allowed event-name subset) needs to live somewhere — that one new column is the only delta. | NEW column on `api_keys`, not a new table. |
| **NEW** `tenant_brand_config` | **NOT NEEDED as a separate table.** Add `tenants.brand jsonb not null default '{}'::jsonb`. Holds `{ name, logo_url, primary_color, secondary_color, support_email, custom_domain }`. Theming is a per-tenant configuration, not a separate aggregate; one jsonb column on `tenants` keeps the data model honest. | NEW column on `tenants`. |

**Net delta to the platform's data model for productization:** seven new columns on `tenants` (`feature_flags`, `subscription_tier`, `max_active_agents`, `max_concurrent_runs`, `timezone`, `allowed_origins`, `brand`), one widened check constraint (`type` adds `'public'`), one new column on `api_keys` (`metadata`), one new table (`tenant_billing_meters`). Everything else is unchanged.

This is what "GenX is the same platform" means concretely: no new schema, no new app, ~10 column-level edits.

### 1.3 The `tenants.feature_flags` key set

A closed key set. New keys land via code-reviewed migration of a TypeScript constant in `packages/shared/src/feature-flags.ts` (proposed). The keys, all booleans unless noted:

| Key | What it controls | Default per stage |
|---|---|---|
| `theming_enabled` | Whether the SPA reads `tenants.brand` and renders the white-label theme. | internal=false, client=true, public=false |
| `pixel_ingest_enabled` | Whether the `/relay/ingest` endpoint accepts events for this tenant. | internal=false, client=false, public=true |
| `architect_self_serve` | Whether the tenant's `owner|admin` users can call `POST /api/admin/architect/propose` directly. | internal=true, client=true (gated by `subscription_tier`), public=false (Open Q) |
| `public_billing_enabled` | Whether the per-tenant billing meter (`tenant_billing_meters`) is enforced. | internal=false, client=false (contract-bound), public=true |
| `cross_tenant_consent_opt_in` | Whether the tenant has accepted being included in cross-tenant aggregation. **Default OFF, explicit accept required.** Drives whether the tenant's `relay_events` rows carry `consent_scope='cross_tenant_aggregated'` (otherwise `'tenant_only'`). | internal=false, client=false, public=false (must be explicitly accepted) |
| `autonomy_ceiling` (string enum, not boolean) | Maximum autonomy any agent in this tenant can be promoted to. Values: `'propose' | 'execute_safe' | 'execute_full'`. White-label is capped at `execute_safe`. Public is capped at `execute_safe`. | internal=`execute_full`, client=`execute_safe`, public=`execute_safe` |

The `autonomy_ceiling` flag is what makes the existing `autonomyGate` in `packages/core/src/autonomy.ts:50` a *productization* primitive without rewriting it — the gate reads `agents.autonomy` today; with the flag, it clamps to the tenant ceiling at promotion time (eval-driven promotion, `CLAUDE.md` non-negotiable #1, never proceeds past the tenant ceiling).

### 1.4 What stage-specific behavior reduces to

Concretely:

- **Internal tenants** skip the billing meter cap (`public_billing_enabled=false`), enable Architect self-serve, run the full Acqu doctrine. Same code as today.
- **White-label tenants** read `tenants.brand` for SPA theming, route approvals to *their* Slack workspace (via their own MCP), enforce `autonomy_ceiling='execute_safe'`. Their agents are seeded from a curated subset of the 56-agent fleet (§3.2). Billing meter is informational — contract-bound, not enforced.
- **Public tenants** enforce hard caps via `max_active_agents` / `max_concurrent_runs` / `tenants.monthly_budget_usd` checked in PreToolUse hook + SessionStart. Architect is disabled by default (Open Q). Billing meter is enforced.

All three stages run on **the same code paths** — `packages/core/src/claim.ts`, `packages/core/src/bundle.ts`, `apps/runner/`, `packages/inngest/`. The only branching is "read a column, apply behavior." This is the staging-as-config promise the doc opens with, concretely.

---

## 2. White-label layer — theming, branding, configuration vs lock

### 2.1 Theming + branding

**Lives in**: `tenants.brand jsonb` (column-level delta, §1.2). Schema (proposed, illustrative):

```
{
  "name": "Acme Growth",
  "logo_url": "kb:acme/brand/logo.svg",
  "primary_color": "#0a84ff",
  "secondary_color": "#1c1c1e",
  "support_email": "support@acmegrowth.com",
  "custom_domain": "agents.acmegrowth.com"
}
```

**Consumed by**: a new `<TenantThemeProvider>` in `apps/control-plane/src/lib/theme.tsx`. Today the SPA has a `ThemeProvider` (light/dark mode, `apps/control-plane/src/lib/theme.tsx:1`) and the `TopBar` reads it (`apps/control-plane/src/components/shell/top-bar.tsx:8`). The delta: the provider reads `tenants.brand` for the active tenant (from `/api/admin/tenants/me` — proposed extension of the existing `/api/admin/tenants/me/model-override` route at `apps/api/src/index.ts:492`) and exposes `primary_color`, `logo_url`, `name` to consuming components. Existing `<ThemeProvider>` for light/dark is preserved underneath; the new layer is on top.

**Custom domain** is the heaviest piece. It requires DNS verification + a wildcard SSL layer (the SPA today serves from one origin). Recommended: defer custom-domain to white-label launch tier-2; tier-1 white-label tenants use a sub-path (`/t/<slug>`) on the same origin. Open Q.

### 2.2 What white-label clients CAN configure

| Configurable | How | Cite |
|---|---|---|
| Agent enable/disable | Existing lifecycle endpoints: `POST /api/admin/agents/:id/{activate,pause,archive,draft}` (`apps/api/src/index.ts`, search "Agent lifecycle"). White-label `owner|admin` role hits this. | Lifecycle API shipped (Phase 8.5; `HANDOFF-other-session.md` §1). |
| Per-tenant model override | Existing endpoint: `PUT /api/admin/tenants/me/model-override` (`apps/api/src/index.ts:492`). | Shipped Phase 8.5. |
| Cron schedules / timezone | `agent_triggers` (`0005`) carries the cron expression. Per-tenant timezone (new column `tenants.timezone`) is applied at trigger projection time. | NEW column + small SPA edit. |
| Approvals routing | Per-tenant Slack MCP (`mcps` row, `tenant_id`-scoped). Approvals post to that MCP. | Existing — already per-tenant. |
| Budget caps | `tenants.monthly_budget_usd` (existing) + per-agent `agents.budget_cap_usd`. | Existing. |
| Knowledge folders | `knowledge_folders` per tenant. UI exposes folder CRUD; vector indexing happens automatically via `packages/core/src/knowledge.ts`. | Existing. |
| Branding (logo, color, name, support email) | `tenants.brand` jsonb (new column, §2.1). | NEW column. |
| Connector connections | `mcps` + `oauth_credentials` per tenant. White-label uses Nango handshake (Main §2.4). | NEW: Nango adapter (queued — `AGENT-OS-PLAN.md` deliverable E). |

### 2.3 What stays LOCKED (theming cannot override security)

The canonical agent anatomy itself. White-label tenants **cannot**:

- Mutate the agent's source-of-truth `AgentSpec` shape (`AGENTS-PLAN.md` §1.1). They get *configuration* on top of pre-shipped agents, not the ability to redefine them.
- Override the **`CANT_FAIL_KEYS`** global invariant (`packages/core/src/architect/hydrate.ts:21-37`). The 14 can't-fail agents stay locked to T-critical Opus literals; if a white-label tenant has one, it runs on Opus. The `default_model_override` for white-label tenants must respect this; the seeder warns when overriding a can't-fail default (`seedAgent.ts:380`).
- Override the Relay schema (`AGENT-OS-PLAN.md` §8.2) — `consent_scope` and `pii_class` are NOT NULL with check constraints. Theming cannot change this.
- Override the RLS policies (`0001_init.sql:409-453`). Theming cannot weaken `is_tenant_member()`. The RLS test infrastructure (`packages/tool-rls-test/`) verifies this per `tenant-isolation-tester` daily.
- Promote any agent past their `tenants.feature_flags.autonomy_ceiling`. The gate clamps at promotion.

### 2.4 The Architect's role for white-label

The Architect (`docs/specs/agent-architect.md`, `packages/core/src/architect/`) is the productized "build me a team from plain English" endpoint. The question: can a white-label tenant USE the Architect to propose new tenant-scoped agents from their doctrine, or is the Architect Acqu-internal-only?

**Recommendation:** gated by `tenants.feature_flags.architect_self_serve`. Default OFF for both `client` and `public` tenants. Enabled for individual `client` tenants on a contract basis. Rationale:

- The Architect runs on Sonnet or Opus (`docs/specs/agent-architect.md`) — cost per propose is meaningful ($0.20 default budget); a self-serve white-label tenant without a tenant-wide architect cost cap (Open Q #10 in `AGENT-OS-PLAN.md`) is unbounded spend exposure.
- The Architect's refusal list (`CANT_FAIL_KEYS`) is correct *for Acqu*; whether it is correct for an arbitrary white-label vertical is uncertain.
- Until the Architect cost cap per tenant lands (`AGENT-OS-PLAN.md` deliverable F prerequisite), keep it off by default.

**Open Q** — surfaced in §9 below.

---

## 3. Onboarding — constrained configuration, not arbitrary software generation

### 3.1 The flow (white-label + public, same code path)

The flow uses **existing primitives only**:

1. **Signup** → `apps/api` POST `/api/public/signup` (NEW route, public-tier; CSRF + rate-limited). For white-label, the Acqu account manager hits `POST /api/admin/tenants` (NEW route, admin-only) instead.
2. **Tenant row inserted** — `tenants.type = 'public' | 'client'`, `feature_flags` populated from a stage default constant, `subscription_tier` set, `monthly_budget_usd` set from plan default, `brand` minted from the signup form (white-label) or a system default (public).
3. **Owner mint** — `tenant_members` row `(tenant_id, user_id, role='owner')`.
4. **Default agent bundle seeded** — see §3.2. Reuses the **existing** `seedAgent(db, spec, { skillSource })` function from `packages/core/src/seed/seedAgent.ts`. The seeder is already idempotent per `(tenantId, key)` (`seedAgent.ts:164`). The onboarding flow is a batch call of pre-shipped seed specs scoped to the new `tenant_id`.
5. **Connector wiring step** — the tenant connects their MCPs (Close, Slack, Stripe, etc.) via Nango. Each connection writes a `mcps` row + an `oauth_credentials` row scoped to the tenant.
6. **Knowledge ingestion step** — the tenant uploads docs or syncs a Drive folder. `documents` + `doc_chunks` populate per tenant.
7. **First run** — operator or tenant manually fires `vitals` (or the vertical's equivalent monitor). The runtime path (claim → bundle → execute → safety hooks → run summary, `AGENT-OS-PLAN.md` §3.1) is unchanged.

### 3.2 Constrained configuration — vertical bundles, NOT arbitrary new agent types

Tenants pick a **vertical bundle** at signup. A bundle is a curated subset of the 56-agent fleet (`AGENTS-PLAN.md` §3.1) that maps to a recognizable use case. Proposed initial bundles (all data, not code — a TypeScript constant in `packages/shared/src/bundles.ts`):

| Bundle key | Agent keys included | Stage availability |
|---|---|---|
| `acqu-internal-full` | All 56 agents | internal only |
| `growth-paid-acquisition` | `ad-ops`, `ad-claim-compliance`, `creative-miner`, `creative-studio`, `creative-critic`, `funnel-monitor`, `launcher`, `vitals`, `intel`, `briefing` | white-label, public-paid |
| `agency-back-office` | `client-comms`, `client-health`, `case-study-builder`, `weekly-report`, `briefing`, `ea`, `vitals` | white-label |
| `ecommerce-growth-starter` (free tier) | `vitals`, `briefing`, `funnel-monitor` (3 agents — fits free-tier cap) | public-free |
| `security-pack` | `tenant-isolation-tester`, `secrets-rotation`, `access-auditor`, `security-anomaly-watchdog`, `compliance-health` | white-label only (T-critical; runs on Opus per `CANT_FAIL_KEYS`) |

Tenants **cannot** spin up arbitrary new agent types. The Architect is gated (§2.4). The doctrine is **not** a self-serve UX. The bundle catalog is the self-serve UX — picking a bundle = seeding N agents from a fixed, curated map.

### 3.3 The tenant-parameterization delta on the existing seed scripts

The 56 seed scripts hardcode `tenantId: TENANT_IDS.acqu` (confirmed: `grep "TENANT_IDS.acqu" scripts/seed/` returns every Acqu seed file; `TENANT_IDS` is defined at `packages/shared/src/fixtures.ts:28` as `{ acqu: ACQU, cliently: CLIENTLY }`).

**The delta**: extract every `acqu-<key>.ts` seed body into a `getAgentSpec(tenantId): AgentSpec` factory in `packages/registry/src/specs/<key>.ts` (NEW package surface, not a new package — `packages/registry/` already exists at `packages/registry/src/`). The Acqu seed script becomes one line: `await seedAgent(db, getAgentSpec(TENANT_IDS.acqu))`. The white-label onboarding flow batch-calls `getAgentSpec(newTenantId)` for every key in the bundle.

This refactor is mechanical — `seedAgent` is already tenant-parameterized internally (`seedAgent.ts:40`, every helper takes `tenantId`). The change is to the **wrapper scripts**, not the seeder.

**Note on stage in `AGENT-OS-PLAN.md` §9.4 sequencing:** this refactor is queued at deliverable H ("fleet expansion"). It does not block the Relay (B) or the RLS audit (A).

### 3.4 Default-tier limits — proposed values for the free tier

These values are **proposals** — the per-tenant cap fields (`max_active_agents`, `max_concurrent_runs`) are flagged as Open Q #4 in `AGENT-OS-PLAN.md` and the proposed defaults below are inputs to that decision.

| Tier | `max_active_agents` | `max_concurrent_runs` | `monthly_budget_usd` | Bundle access |
|---|---|---|---|---|
| `internal` | NULL (unlimited) | NULL (unlimited) | operator-set | all bundles |
| `free` (public) | **3** | **1** | **$5** | `ecommerce-growth-starter` only |
| `paid_T1` (public) | **10** | **3** | **$50** | most non-security bundles |
| `paid_T2` (public) | **NULL** (unlimited within budget) | **10** | tenant-set within ceiling | all bundles except `security-pack` |
| `white_label` | NULL (contract-bound) | NULL (contract-bound) | per contract | all bundles, including `security-pack` |

**Enforcement points** (existing platform; no new enforcement layer):

- `max_active_agents`: count check on `lifecycle_state='active'` transitions in `POST /api/admin/agents/:id/activate` (existing endpoint, `apps/api/src/index.ts`).
- `max_concurrent_runs`: count check in `/next` against `runs where status='running' and tenant_id=?` (existing endpoint).
- `monthly_budget_usd`: existing `checkBudget` in `packages/core/src/cost.ts:46`, returns `over` at 100%; PreToolUse hook refuses dispatch on `over`. The reserve/commit gap (`AGENT-OS-PLAN.md` §7.2.1) means actual enforcement is post-hoc until reserve/commit lands.

### 3.5 Onboarding telemetry

Every onboarding event emits to the Relay (`AGENT-OS-PLAN.md` §8.3 namespace):

- `lifecycle.changed` when each seeded agent flips to `active`.
- `architect.seeded` when bundle seeding completes (reusing the existing event name — semantically correct: a bundle seed is N architect-shaped seedings).
- A NEW event name proposal: `tenant.onboarded` — payload `{ stage, bundle_key, seeded_agent_count, brand_set, connectors_count }`. This is the input to the operator dashboard's "new tenants this week" view. Must be added to the closed registry per `AGENT-OS-PLAN.md` §8.3.

---

## 4. THE PIXEL — consented, aggregated, the wedge

### 4.1 The Pixel is NOT a separate system

Restated up front because it is the single most consequential design choice in this doc.

The Pixel is an **external HTTP SDK** that POSTs events into the same `relay_events` table the internal agents populate. One pipeline, one schema, one consent boundary. The SDK is **write-only**; it never reads from the Relay.

### 4.2 The `/relay/ingest` contract

**Endpoint**: `POST /relay/ingest` on `apps/platform/` (the new sub-app proposed in `AGENT-OS-PLAN.md` §8.4). Owned by this plan.

**Auth**: per-tenant API key in `Authorization: Bearer <key>`. The key is a row in the existing `api_keys` table (`0001_init.sql:377`) with `kind='external'`. No new auth surface.

**Rate limit**: per-tenant per-minute (proposed: 1000 req/min for free tier; 10000 req/min for paid; configurable in `tenants.feature_flags` or the new `api_keys.metadata` column). Enforced in the Hono middleware before the writer step.

**Idempotency**: the body's `event_key` field (existing column on `relay_events`, `AGENT-OS-PLAN.md` §8.2). Unique with `tenant_id` per the existing `relay_events_idempotency_idx`. Replays of the same `event_key` are no-ops.

**Request body (JSON):**

```
{
  "event_name": "<one of the closed registry per AGENT-OS-PLAN.md §8.3>",
  "occurred_at": "<ISO-8601 timestamp>",
  "event_key": "<client-supplied unique key for idempotency>",
  "payload": { ...event-specific fields per AGENTS-PLAN.md §2... },
  "consent_scope": "tenant_only" | "cross_tenant_aggregated",
  "pii_class": "none" | "internal_id" | "client_pii",
  "correlation_id": "<optional uuid>",
  "causation_id": "<optional uuid — relay_events.id that caused this>"
}
```

**One-line contract**: `POST /relay/ingest` with `Bearer <tenant_api_key>` → validate against the closed event-name registry and the `consent_scope` / `pii_class` requirements → insert one `relay_events` row with `actor='external'`, `tenant_id` from the key, and `event_key`-keyed idempotency.

**Validation rules** (rejected at the route, before the writer):

1. `event_name` MUST be in the closed registry (`AGENT-OS-PLAN.md` §8.3) OR in the GenX-extension subset that is reserved for external SDK events (see §4.5 below).
2. `consent_scope` MUST be present and in the enum.
3. `pii_class` MUST be present and in the enum.
4. `occurred_at` MUST be within ±5 minutes of server time (replay protection).
5. `tenant_id` is inferred from the API key — the body field is ignored (cannot spoof).
6. Body size limit: 16KB (matches CLAUDE.md non-negotiable #4 — anything larger must save to a file and pass `output_path` in payload).

### 4.3 The wedge: aggregated outcome data across verticals

Once N white-label tenants and M public tenants are emitting `run.completed` + composing `run_summaries`, the platform accumulates a unique pattern-level dataset that nobody else has: *"for this kind of run, with these inputs, with these tools, what worked."*

The mining target is **pattern-level intelligence**:

- Which agent configurations have the highest success rate per vertical?
- Which prompt versions correlate with low `finding_count` and high `deliverable_kind='document'` rates?
- Which tool sequences correlate with successful `run_summaries.status='done'`?

The egress mechanism is **exactly one query path**: `relay_events_xtenant_agg` (defined in `AGENT-OS-PLAN.md` §8.2). The view:

- Filters `consent_scope = 'cross_tenant_aggregated'` (hard-coded in the view body — schema-enforced; cannot be bypassed by query rewriting).
- Aggregates by hour bucket + event name. Returns counts, never row contents. No raw-row egress is possible across tenants.
- Access from the API is gated by a `platform_admin` role (a NEW role in `tenant_members.role`? Open Q — or a new `platform_admins` table, since `platform_admin` is global, not per-tenant. Likely the latter).

A second view is needed for the outcome-mining use case: `run_summaries_xtenant_agg`. Proposed shape — group by `agent_id, status, deliverable_kind, date_trunc('week', ended_at)` filtered to tenants with `feature_flags.cross_tenant_consent_opt_in = true`, returning counts + median cost + median duration. **NEW view, queued behind Relay deliverable B**. The acceptance criterion is the same: raw row egress impossible.

### 4.4 Legal guardrails — schema + SDK enforcement (not docstrings)

**First-party / consented data ONLY**. Tenants MUST accept the cross-tenant consent toggle explicitly. The default is OFF. Enforcement:
- `tenants.feature_flags.cross_tenant_consent_opt_in` defaults to `false`.
- The SDK `consent_scope` field defaults to `'tenant_only'` if the embedding site has not surfaced consent.
- The `relay_events_xtenant_agg` view's `where consent_scope = 'cross_tenant_aggregated'` excludes non-opted rows by construction.

**Aggregated / pattern-level cross-tenant ONLY**. The two cross-tenant views (`relay_events_xtenant_agg`, `run_summaries_xtenant_agg`) are the *only* path out of the per-tenant RLS box. Service-role connections that aggregate across tenants without the view are flagged by `event-schema-guardian` (`AGENTS-PLAN.md` §3.2 D3.1) and a CI lint (proposed).

**Never become a Consumer Reporting Agency (CRA)**. CRA status is triggered by furnishing consumer information for credit, employment, insurance, housing, or government-benefit decisions. The platform MUST NOT:
- Score individuals (only aggregated outcome counts).
- Identify individuals across tenants (the views drop `actor_id` and any PII-class field at aggregation).
- Generate reports about individuals for the listed decision types.

Prohibited at the agent-job level: an agent whose `deliverable_kind` or job name implies any CRA-triggering use case is refused at seed time. **Proposed:** a `cra_prohibited_keywords` blocklist in `packages/registry/src/specs/policy.ts` (NEW); the Architect's hydrate step (`packages/core/src/architect/hydrate.ts`) checks the agent's name + description against it. Same shape as `CANT_FAIL_KEYS`. Open Q on the keyword list — needs legal sign-off.

**No covert harvesting**. The Pixel SDK MUST surface its presence to end-users via a standard consent disclosure pattern. The SDK ships with a `disclose()` helper that renders the disclosure banner; embedding sites that do not call it are non-compliant (and ToS-violating). The disclosure pattern matches GDPR/CCPA cookie-banner conventions (verify against current EU + California requirements before public launch — Open Q).

**PII redaction at egress** — via `redactPayload(payload, pii_class)` (proposed location: `apps/platform/src/relay/redact.ts`, per `AGENTS-PLAN.md` §2.6). Behavior:
- For tenant-local reads, no redaction (the tenant owns the data).
- For cross-tenant view aggregation, fields tagged `client_pii` are dropped before grouping. The view itself does not project payload fields — it aggregates counts — so the egress surface is structurally narrow.

**Audit + revocability**:
- Every consent toggle change writes an `autonomy_events`-shaped row (Open Q: or a new `consent_log` table?). The history is queryable.
- A tenant flipping `cross_tenant_consent_opt_in` from true to false **immediately** stops the view from including their rows (the view is computed on read, so flag flip = effective on next read). Existing aggregated derivatives that were computed BEFORE the flip flip cannot be retroactively erased — open question on whether to add a backfill purge.

### 4.5 The GenX-extension event names

The SDK emits the same closed registry from `AGENT-OS-PLAN.md` §8.3, **plus** a small GenX-extension subset reserved for external events that have no internal analog. Proposed (added to the closed registry as a separate section so the validation namespace is closed but tiered):

| Event name | Semantics | Typical `pii_class` |
|---|---|---|
| `pixel.page.view` | An embedding-site page view. | `client_pii` if `payload.user_id` present; else `none` |
| `pixel.event.custom` | A custom event the embedding site defines (subject to size + rate limits). | per embedding-site discipline |
| `pixel.identify` | A user identity is associated with an embedding-site visitor. | `client_pii` always |
| `pixel.consent.changed` | The end-user changed consent state on the embedding site. | `none` |

Note the deliberate naming: `pixel.*` matches the existing convention for the Meta Conversions API pixel events (which are internal-only and emit through their connector MCP, not the SDK). The collision is intentional at the namespace level (`pixel.*` = "page-instrumentation events") and disambiguated by the `actor` field: internal Meta-pixel events emit with `actor='agent'` and an `agent_id`; external SDK events emit with `actor='external'` and an `actor_id` that is the embedding-site visitor identifier. The Open Q on renaming is below.

### 4.6 What the SDK does NOT do

- Does not read from the Relay. Write-only.
- Does not generate event names — emits only registered names.
- Does not decide `consent_scope` — derived from the embedding site's consent state, defaulted to `tenant_only` if absent.
- Does not store credentials — the tenant API key is generated on tenant signup and stored by the embedding site's owner.
- Is not the Meta Conversions API pixel — that is a separate, unrelated connector used by ad-ops agents. The internal name **Relay** stays; the external name **Pixel** is the GenX SDK.

---

## 5. Packaging + pricing

### 5.1 The tier definitions

| Tier | Agents | Concurrent runs | Monthly budget | Pixel ingest | Architect | Notes |
|---|---|---|---|---|---|---|
| `free` (public) | 3 | 1 | $5 | enabled (rate-limited to 1000 req/min) | disabled | Hard caps. Bundle = `ecommerce-growth-starter`. |
| `paid_T1` (public) | 10 | 3 | $50 | enabled (10000 req/min) | disabled by default; gated upgrade | Most bundles available. |
| `paid_T2` (public) | unlimited within budget | 10 | tenant-set within ceiling | enabled (50000 req/min) | enabled with tenant-wide cost cap | All bundles except security-pack. |
| `white_label` | per contract | per contract | per contract | enabled per contract | enabled with cost cap | All bundles including security-pack. |

### 5.2 Cap enforcement — leveraging existing layers

The existing `cost.ts` budget cap layer (`packages/core/src/cost.ts:46`) is already per-tenant. The **delta** for productization:

- **At PreToolUse (refuse new tool calls over cap)**: extend the autonomyGate to read `checkBudget(tenantId)`; if `over`, the gate returns `deny` with reason `budget_cap_hit`. This emits `budget.cap_hit` to the Relay and `autonomy.denied`. The check is per-tool-call, not per-run.
- **At SessionStart (refuse spawn of new runs over cap)**: the scheduler's `claim_next_run()` (`0001_init.sql:391`) is the chokepoint. NEW gate: a `before insert` trigger on `runs` that checks `tenants.monthly_budget_usd` against the sum of `run_summaries.cost_actual_usd` for the current month. If over, refuse the insert with a clean error → scheduler emits `budget.cap_hit` and skips the run.
- **At onboarding / lifecycle activation**: the existing `POST /api/admin/agents/:id/activate` endpoint gets a count-check against `tenants.max_active_agents`. If at cap, refuse the activation with a 409.

None of this requires new application logic — it is column-reads + gate-extensions on existing chokepoints.

### 5.3 Reserve/commit pattern (recommended approach)

Parked as Open Q #5 in `AGENT-OS-PLAN.md`. Recommended approach:

1. **PreToolUse**: reserve estimated cost. For a model + estimated max tokens, compute `est_cost = price(model) × est_tokens`. Insert / increment `tenant_billing_meters.reserved_usd` for the current period. If `reserved_usd > cap_usd`, deny.
2. **PostToolUse**: commit actual cost (`runs.cost_usd` delta). Move the delta from `reserved` to `committed`. If the actual is higher than the reservation, the difference is "overage" — flag in `tenant_billing_meters.status='exceeded'` and emit `budget.cap_hit`.
3. **SessionEnd**: reconcile. Any unconsumed reservation for this run is released (`reserved_usd -= unconsumed`).

The atomic carrier is the new `tenant_billing_meters` table (§1.2). The math runs in a single Postgres function called from PreToolUse / PostToolUse / SessionEnd hooks.

This is the production-grade billing meter; without it, the cap is post-hoc.

### 5.4 "They keep winning so they stay" — the outcome surface

The product surface for retention is a per-tenant dashboard view on `apps/control-plane/` that aggregates `run_summaries`. Today the SPA shows runs (`apps/control-plane/src/routes/_app/index.tsx`); the productized surface is a new view that surfaces:

- **What their fleet did this week**: `select agent_id, count(*), sum(cost_actual_usd), avg(duration_ms) from run_summaries where tenant_id = X and ended_at > now() - '7d' group by agent_id`. One query, one table — the Relay's promise (`AGENT-OS-PLAN.md` §8.1).
- **The deltas they earned**: `highlights` projections per agent class (`AGENTS-PLAN.md` §2.4) — e.g. `vitals.six_numbers` week-over-week; `dunning-manager.recoveries_today`.
- **Approval throughput**: `approval_count` rolled up; surfaces "you are approving X/week."

Location: a new SPA route `apps/control-plane/src/routes/_app/outcomes.tsx`. Reads from a new `/api/admin/run-summaries` endpoint that wraps the SQL.

This is the surface that makes the platform sticky for white-label and public tenants — they see the value they are getting in their own brand-colored dashboard.

### 5.5 Billing integration — what the platform owns vs delegates

**The platform OWNS**:
- The usage rollups: `tenant_monthly_usage` view (per `AGENT-OS-PLAN.md` §7.2 — `sum(run_summaries.cost_actual_usd) group by tenant_id, month`).
- The cap state: `tenant_billing_meters`.
- The events: `budget.warn`, `budget.cap_hit`, `tenant.onboarded`.

**The platform DELEGATES** (defer to operator):
- The invoice generator (Stripe Billing, or a metering-billing provider). The `dunning-manager` agent (hard gate #3, `AGENT-OS-PLAN.md` §9.3) uses `tool.billing-engine` + `tool.dunning-engine` — these are the tools that interact with the chosen provider. The provider choice is operator-decided.
- The payment method capture flow.
- The dunning ladder (handled by `dunning-manager`, but the actual retry+escalation tools call out to the billing provider).

**Recommended provider**: Stripe Billing via the existing connector MCP (Stripe is already in the connector catalog per Main §2.5). Rationale: the existing connector layer + `tool.billing-engine` are designed around Stripe; the dunning agent's prompt assumes Stripe semantics. Alternative metering-billing platforms (Metronome, Orb) would require a different connector. **Open Q.**

---

## 6. Naming / brand check — flag, do not decide

### 6.1 "GenX"

Collisions:
- **Demographic name** — "Generation X" is universally known; SEO + discovery suffer; users will confuse the product with anything aimed at the demographic.
- **Existing companies**: Genex Services (healthcare), Genx Wireless (telco), GenX Solutions (consulting), among others.
- **Trademark risk**: a USPTO search will return many existing GENX registrations across IT services classes.

**Recommendation**: run a USPTO + domain availability check + a Google brand-conflict scan before public launch. Do NOT pick the public-facing name in this doc.

### 6.2 "OpenClaw"

Collisions:
- **Anthropic + "Claw"** — reads as "open-source Claude / anti-Anthropic." If the runtime is Claude Agent SDK over OpenRouter (which it is), this naming is at best confusing and at worst legally risky.
- **Other "Claw"s** — Mortal Kombat character; Cat's Claw (herb); various unrelated SaaS.

**Recommendation**: do not use. The anti-Anthropic read is the dealbreaker.

### 6.3 "Pixel" (external SDK name)

Collision with the **Meta Conversions API pixel** — which is the tracking pixel ad-ops agents already use via their connector. Inside this stack the name "pixel" was previously reserved for that literal Meta pixel (cite: `AGENT-OS-PLAN.md` doc-header note + `AGENTS-PLAN.md` doc-header note). Calling the external SDK "Pixel" with a capital P creates an internal ambiguity that will trip new contributors.

**Recommendation**: keep "Pixel" as the *external brand* (it's user-facing and the metaphor is right — a pixel of telemetry per event); rename the internal Meta-pixel references to "Meta CAPI" or "conversions-pixel" so the namespace inside the repo is unambiguous. Open Q on whether to rename "Pixel" entirely for the SDK.

### 6.4 "Relay" (internal name)

Internal name — not external-facing. Collisions:
- Cloudflare Relay (an Email forwarding product).
- EmberJS Relay (a JS data layer).
- GraphQL Relay (a spec).

**Recommendation**: keep "Relay" internally. It is not customer-facing, and the internal semantics are clean enough that the collision is acceptable. The day Relay becomes external-facing, re-check.

### 6.5 Trademark + domain checks

Before public launch:
- USPTO search on the chosen public-facing name (whatever replaces or confirms "GenX").
- Domain availability + a 1-year hold on close-spelling variants.
- A Google + LinkedIn brand-conflict scan.
- An EU TMview check if launching in Europe.

This is operator + legal work, not engineering work. Flag as a launch-gate dependency.

---

## 7. Launch sequencing with gates

### 7.1 Inherited gates from CLAUDE.md + AGENT-OS-PLAN.md + AGENTS-PLAN.md

Restating the upstream gates verbatim so this doc does not silently re-litigate them:

**The three CLAUDE.md hard gates** (`CLAUDE.md` non-negotiable #5):
1. **No client ad launches before `ad-claim-compliance` exists.** Status: shipped (Phase 2/5; `AGENTS-PLAN.md` §3.2 D1). Gate **passable**.
2. **No external multi-tenant before `tenant-isolation-tester` passes against a live 2+ tenant Supabase.** Status: in progress on `claude/exciting-davinci-yvptm` (`AGENT-OS-PLAN.md` §9.3). **Blocks any white-label or public launch.**
3. **No recurring billing before `dunning-manager` exists.** Status: agent seeded, but `tool.billing-engine` + `tool.dunning-engine` are not in the registry yet (`AGENT-OS-PLAN.md` §9.3). Gate **not passable** until those tools land.

**The new P0 gates from `AGENT-OS-PLAN.md` §9**:
- **A** — Fleet-wide RLS audit green across all 32+ attack vectors live with 2+ tenants (P0).
- **B** — Migration `0011_relay.sql` shipped: `relay_events` + `run_summaries` + the xtenant view + the registry (P0).

**The AGENTS-PLAN.md gap closers** (§5):
- SKILL.md files for `verification-before-completion` + `clarify-before-acting` exist on disk under `external/acqu-skills/` (Open Q #6 there; today they register at version `0.0.0`).
- The ad-ops doctrine-numbered tool literals (`tool.1`/`tool.4`/`tool.17` in the prompt) replaced with real registry keys (`AGENTS-PLAN.md` §3.2 D1).
- `offer-architect` + `offer-validator` either shipped as seed files or removed from `CANT_FAIL_KEYS` (`AGENTS-PLAN.md` §3.2 D8 + Open Q #10 there).

### 7.2 The GenX-specific gates

**Stage 1: white-label fulfillment launch** — must be true before *any* white-label tenant lands:

| Gate | Criterion (measurable) | Owner | Artifact that proves it |
|---|---|---|---|
| Hard gate #2 (RLS) | `tenant-isolation-tester` returns zero cross-tenant leaks across all 32+ attack vectors in a live Supabase with ≥2 tenants. | Phase 9 owner. | The committed artifact in `.planning/` per `AGENT-OS-PLAN.md` §9.4 deliverable A. |
| Relay P0 | `relay_events` + `run_summaries` shipped; one test run produces the expected event sequence + one `run_summaries` row with `cost_actual_usd == runs.cost_usd`. | Platform owner. | The acceptance test from `AGENTS-PLAN.md` §2.3 (cost-equality invariant) passes in CI. |
| Hard gate #3 (billing) | `tool.billing-engine` + `tool.dunning-engine` in the registry; a failed payment triggers `dunning-manager`'s end-to-end recovery flow in a live test. | Finance + Platform. | A `relay_events` chain showing `budget.warn` → dunning approval → recovery. |
| Nango adapter | At least one connector (proposed: Close, per Main §6) wired behind the connection interface via Nango; OAuth handshake + short-TTL token resolution works end-to-end. | Connectors owner. | A white-label staging tenant successfully connects Close via Nango. |
| Theming + brand | `tenants.brand` jsonb column shipped; SPA reads it; `<TenantThemeProvider>` renders white-label colors + logo. | Frontend owner. | A staging tenant's SPA renders in their brand colors. |
| `tenants.feature_flags` shipped | Column exists with the closed key set from §1.3; flag-reads gate stage-specific behavior in the runner + SPA. | Platform owner. | Stage-1 white-label tenant has `theming_enabled=true` + `autonomy_ceiling='execute_safe'` enforced. |
| ≥1 paying white-label tenant | One paying tenant onboarded, with their own connectors, agents, knowledge, and ≥10 successful `run_summaries`. | Operator. | The `run_summaries` rows in production. |

**Stage 2: public open-signup launch** — must be true before public signups open:

| Gate | Criterion (measurable) | Owner | Artifact that proves it |
|---|---|---|---|
| All Stage 1 gates still green | The Stage 1 gates re-run weekly continue to pass. | Phase 9 owner + Platform. | Weekly `tenant-isolation-tester` run + Relay invariants test. |
| Free-tier caps in code | `max_active_agents` + `max_concurrent_runs` enforced in `/next` and lifecycle endpoints; PreToolUse + SessionStart cap-checks live. | Platform owner. | A free-tier tenant attempting a 4th agent activation gets a 409; the response is testable. |
| Reserve/commit budget landed | `tenant_billing_meters` table shipped; PreToolUse reserves, PostToolUse commits, SessionEnd reconciles. | Platform + Finance. | A run that estimates $0.10 but actually costs $0.50 reconciles correctly in the meter; a deliberate over-cap is denied at PreToolUse. |
| `/relay/ingest` endpoint shipped | The endpoint validates the closed event registry, enforces consent + PII fields, idempotency works. | Platform owner. | An external test client POSTs an event, lands in `relay_events`, replay is a no-op. |
| Consent toggle UX | The `cross_tenant_consent_opt_in` flag is exposed in the tenant settings UI; default OFF; flipping it writes a consent_log row. | Frontend + Platform. | A test tenant flips the toggle; the next emission from that tenant carries the new `consent_scope`. |
| Cross-tenant aggregation view | `relay_events_xtenant_agg` and `run_summaries_xtenant_agg` shipped + tested for raw-row-egress impossibility (a `select *` attempt fails or returns aggregates only). | Platform + Security. | A negative test: querying for raw rows across tenants returns nothing. |
| Legal disclosures shipped | The Pixel SDK ships with `disclose()`; the public signup flow has the cross-tenant consent toggle + a privacy / data-use disclosure approved by counsel. | Operator + legal. | Counsel sign-off on the disclosure language; the SDK ships v1. |
| CRA-prohibition gate | The `cra_prohibited_keywords` blocklist exists; the Architect refuses to assemble CRA-triggering agents; the bundle catalog has no CRA-triggering vertical. | Platform + legal. | A test prompt with a CRA-triggering keyword is refused at architect propose. |
| Public-tier runner sandbox | Decision on §3.2 Open Q in `AGENT-OS-PLAN.md` (ephemeral Browserbase per run, or shared pool with hard concurrency caps). | Platform owner. | A signed-off architecture decision + the implementation. |

### 7.3 The hard rule (restated from `AGENT-OS-PLAN.md` §9)

**No public launch until** the fleet-wide RLS audit is green AND the Relay is shipped AND there is outcome data from white-label tenants proving the wedge.

The "outcome data from white-label tenants proving the wedge" criterion is GenX-specific and **necessary**: launching public-tier without ≥3 white-label tenants emitting `run.completed` + `run_summaries` for ≥30 days means the cross-tenant aggregation view has nothing useful in it, the wedge is theoretical not real, and the public free-tier becomes a cost sink without a moat.

### 7.4 The sequencing — one chart

| Phase | Done when | Inherited from |
|---|---|---|
| **Now (Phase 9)** | RLS audit + D5.3 security agents merged to `main`. | `AGENT-OS-PLAN.md` §9.4 deliverable A. |
| **Next (Relay P0)** | Migration 0011 lands; runner emits to `relay_events`; `composeRunSummary` writes `run_summaries`; legacy + Relay coexist (mirror phase). | `AGENT-OS-PLAN.md` §9.4 deliverable B. |
| **Then (Model price + reserve/commit + billing tools)** | `model_prices` table; `tenant_billing_meters`; `tool.billing-engine` + `tool.dunning-engine` shipped; hard gate #3 passable. | `AGENT-OS-PLAN.md` §9.4 deliverables C + D. |
| **Then (Nango + first white-label)** | Nango adapter behind connector interface for ≥1 connector (Close); first paying white-label tenant onboarded; `tenants.brand` + theming live; bundle catalog v1. | `AGENT-OS-PLAN.md` §9.4 deliverable E + this doc §3.2. |
| **Then (Fleet expansion)** | Seed scripts refactored to factories (§3.3); ≥3 white-label tenants live; Relay shows per-tenant streams cleanly separated. | `AGENT-OS-PLAN.md` §9.4 deliverable H. |
| **Then (Pixel SDK + ingest)** | `/relay/ingest` endpoint live; SDK v1 published; consent toggle UX shipped; cross-tenant aggregation views shipped. | `AGENT-OS-PLAN.md` §9.4 deliverable I + this doc §4. |
| **Last (Public open-signup)** | All Stage 2 gates above green; legal disclosure approved; trademark / domain locked; public free-tier launches. | `AGENT-OS-PLAN.md` §9.4 deliverable J. |

---

## 8. Honest readiness list + risks

### 8.1 What is solid

- **The platform is already multi-tenant.** `tenant_id` is on every tenant-scoped table; RLS via `is_tenant_member()` is shipped (`0001_init.sql:74`); the two-fence model (RLS + runner allowlist, `AGENT-OS-PLAN.md` §2.1) is the live contract.
- **`seedAgent` is per-tenant idempotent.** `packages/core/src/seed/seedAgent.ts:164` upserts by `(tenantId, key)`. Onboarding-as-batch-seed is a wiring exercise, not a build.
- **The lifecycle + autonomy primitives work** (Phase 8.5). `lifecycle_state` + `default_model_override` + `autonomyGate` are the productization-ready primitives.
- **The Architect is shipped** (Phases 3/4). It is the seed path for stages 2/3, gated by `feature_flags.architect_self_serve`.
- **Phase 9 security is in flight** with the deterministic-tool pattern (`tool.rls-test` et al.) and `security_findings`.
- **The connection interface generalizes.** `oauth_credentials` + the `opts.resolveToken` indirection in `buildBundle` (`packages/core/src/bundle.ts:151`) means swapping vault → Nango is a per-connector internals change, not a contract change.

### 8.2 What is not built yet

- **The Relay** + `run_summaries`. P0 in `AGENT-OS-PLAN.md` §9.4 deliverable B. Until shipped, no outcome surface, no billing meter input, no Pixel ingest target.
- **The per-tenant cap fields** (`max_active_agents`, `max_concurrent_runs`). Open Q #4 in `AGENT-OS-PLAN.md`.
- **The public-tier auth + signup flow**. `apps/api` has no `/api/public/signup`; Supabase Auth public mode is configurable but not wired to the tenant-row mint.
- **The Pixel SDK** + `/relay/ingest` endpoint. `apps/platform/` does not exist yet; this is `AGENT-OS-PLAN.md` §8.4's proposed new sub-app.
- **The cross-tenant consent toggle UX** + the `cross_tenant_consent_opt_in` flag. Schema + flag exist as proposals; UI does not.
- **Billing integration** — `tool.billing-engine` + `tool.dunning-engine` not in the registry (`AGENT-OS-PLAN.md` §9.3 hard gate #3).
- **`tenants.brand`** + the `<TenantThemeProvider>` SPA layer.
- **Bundle catalog** (`packages/shared/src/bundles.ts`) — proposed; not yet authored.
- **Tenant-parameterized seed factories** (§3.3) — proposed; the 56 scripts hardcode `TENANT_IDS.acqu`.
- **The Pixel SDK** — repo + npm package don't exist.
- **The `cra_prohibited_keywords` list** + the Architect refusal extension.
- **Brand / naming + trademark** — operator + legal work.

### 8.3 Risks

**Legal**:
- **CRA classification**. If any agent or bundle scores individuals for credit/employment/housing/insurance decisions, the platform becomes a CRA and triggers FCRA obligations. Mitigation: the prohibition list (§4.4); legal sign-off on the bundle catalog before public launch.
- **Consent failures**. A defaulted-on cross-tenant flag, or a missed disclosure on the embedding site, is the worst-case privacy claim. Mitigation: schema-default OFF; SDK requires `disclose()`; tenant settings UI is opt-in.
- **GDPR right-to-erasure** vs. the cross-tenant aggregated view. The view does not project PII, but historical aggregates derived from a tenant's data persist even after the tenant deletes. Open question on whether to add a backfill purge (§4.4).
- **CCPA notice-of-collection** for the Pixel SDK on California sites.

**Brand**:
- The "GenX" + "OpenClaw" name collisions (§6). USPTO + domain + scan required before any public launch.

**Commercial**:
- White-label customer acquisition before public launch. The sequencing rule (§7.3) says no public launch until ≥3 white-label tenants prove the wedge. If white-label sales lag, public launch slips.
- Pricing the free tier too generously means the platform pays for unmonetized public usage; pricing too tightly means low signup conversion. The proposed defaults (§5.1) are starting points, not committed.

**Operational**:
- **Runner isolation for untrusted public-tier code**. The runner today is one Node process per agent (`apps/runner/`); a malicious or compromised public tenant prompt-injecting into their own runner shares the OS sandbox with all other agents in that runner pool. The mitigation options (ephemeral Browserbase per run, Cloud Run jobs per run, per-tenant runner pools) all have cost + latency tradeoffs. **Open Q #8 in `AGENT-OS-PLAN.md` is the same question; restated here as a launch-gate dependency.**
- **Inngest cost per step** at high public-tier volume. Profile before launch (`AGENT-OS-PLAN.md` Open Q #11).
- **Postgres connection ceiling** at hundreds of tenants × tens of agents × per-tick claim. The transaction-pooler endpoint + `FOR UPDATE SKIP LOCKED` design mitigates, but capacity-test before launch.

### 8.4 Top 3 things that, if not done, kill the launch

1. **The Relay + `run_summaries` are not shipped.** Without `run_summaries`, there is no outcome surface, no per-tenant billing meter input, no Pixel ingest target. Every other gate downstream of B in `AGENT-OS-PLAN.md` §9.4 is blocked. **Specific deliverable**: migration `0011_relay.sql` lands; runner hooks emit alongside legacy writes; `composeRunSummary` runs at SessionEnd; one test run produces the acceptance pattern from `AGENTS-PLAN.md` §2.3 (`cost_actual_usd == runs.cost_usd`).

2. **The fleet-wide RLS audit is not green.** Hard gate #2 (`CLAUDE.md` non-negotiable #5) is the load-bearing gate for external multi-tenant launch. Without a fresh, dated artifact from `tenant-isolation-tester` against a live Supabase with 2+ tenants showing zero cross-tenant leaks across all 32+ attack vectors, no white-label tenant can land. **Specific deliverable**: the artifact in `.planning/` per `AGENT-OS-PLAN.md` §9.4 deliverable A.

3. **The consent boundary is not schema-enforced + tested end-to-end.** Public launch with a soft consent boundary is the worst-case privacy / legal scenario. The schema-level `consent_scope` + `pii_class` NOT NULL constraints + the `relay_events_xtenant_agg` view's `where consent_scope = 'cross_tenant_aggregated'` filter MUST hold, AND the SDK's `disclose()` flow MUST be approved by counsel, AND the cross-tenant view MUST be tested for raw-row-egress impossibility. **Specific deliverable**: the consent path tests in CI (negative tests fail on attempted cross-tenant raw-row egress), the SDK ships with `disclose()`, counsel signs off on the language.

Anything else can slip a quarter. These three cannot.

---

## Open Questions for the operator

**Inherited and RESOLVED upstream**:
- **Hermes vs Opus on T-critical can't-fail agents — RESOLVED 2026-06-01.** Tier wins, override loses. T-critical agents always run Opus and are EXEMPT from `tenants.default_model_override` across ALL stages (`internal`, `white_label`, `public`). The seed function skips the override for can't-fail agents; the runner emits `cantfail.model_violation` + fails closed if a T-critical agent is ever dispatched on a non-Opus model. See `AGENT-OS-PLAN.md` Open Q #1 (RESOLVED). **GenX-pricing impact:** white-label and public tenants CANNOT cost-optimize the can't-fail tier away; their T-critical fleet always runs Opus. Free-tier pricing math in §5 must reflect this — the can't-fail surface in the public bundle is bounded, but every Opus invocation lands in the budget. The `ecommerce-growth-starter` bundle in §3.4 was already designed without T-critical security agents in the public free tier (only the operator-side fleet runs them); this resolution confirms that boundary.

**GenX-specific**:

1. **Architect availability to white-label tenants — RESOLVED 2026-06-01.**

   **Operator decision (verbatim):** "Architect is Acqu-internal only for now. White-label tenants do NOT get direct Architect access in the first stage — they receive pre-assembled, approved agent configurations. Per-tenant Architect access is a later phase, gated behind (a) the CRA blocklist shipped + legally signed off, and (b) heavy manual approval per tenant. Document it this way in `GENX-PLAN.md`; do not build tenant-facing Architect yet."

   **Implementation contract:**
   - `tenants.feature_flags.architect_self_serve` defaults to `false` for **all** non-internal tenants (`white_label`, `public`). The Acqu tenant (`internal`) is the only `architect_self_serve=true` row at launch.
   - The architect HTTP/SPA surface (today in `apps/control-plane/`) reads the flag; non-internal tenants see no Architect UI.
   - Onboarding (§3) provisions agents exclusively from operator-approved **bundles** — `ecommerce-growth-starter`, future verticals — assembled by Acqu via the Architect ahead of time and stored as immutable bundle definitions.
   - Per-tenant Architect access (a future, post-public-launch phase) requires BOTH the CRA blocklist (Open Q #8, see RESOLVED entry below) shipped + legally signed off AND a per-tenant manual approval workflow. This is explicitly NOT in the public-launch scope.
   - Document this in `apps/control-plane/` route guards: `/architect/*` 404s unless `feature_flags.architect_self_serve === true`.

2. **Public-tier runner sandboxing.** Inherited as `AGENT-OS-PLAN.md` Open Q #8, restated here as a launch-gate dependency (§8.3). Three options:
   - **(a)** Ephemeral Browserbase per run — strong isolation; latency + cost overhead.
   - **(b)** A separate Inngest pool + a per-tenant runner sub-process with `RUNNER_AGENT_IDS` scope — moderate isolation, OS-level shared, low overhead.
   - **(c)** Per-tenant runner pool on Cloud Run jobs — strong isolation, OS-level isolated, higher cold-start latency.
   - Which? This decision blocks public launch.

3. **The "GenX" brand decision.** §6.1. USPTO + domain + scan results required before public launch. Should the operator commit to "GenX" or commission a brand exercise?

4. **The "Pixel" external name.** §4.5 + §6.3. Keep "Pixel" (clean metaphor; collision with Meta CAPI is internal-only) or rename the SDK (e.g. "Beacon," "Trace," "Ledger" — each has different brand connotations)? If kept, rename the internal Meta-pixel references to "Meta CAPI" so the namespace is unambiguous.

5. **Per-tenant free-tier cap defaults.** §3.4 proposes 3 agents / 1 concurrent / $5. Are these the right numbers? Higher caps drive more signups but cost more; lower caps lose conversions. Operator + a 2-week telemetry test (once Relay is shipped) is the right way to settle this — but a starting set is needed.

6. **Billing provider.** §5.5. Stripe Billing via the existing connector (recommended — the connector is already in the catalog; the `tool.billing-engine` + `dunning-manager` agent are designed around it) vs. a metering-billing platform (Metronome, Orb). Confirm.

7. **The hard gate ordering.** Does Phase 9 (security) need to fully complete (D5.3 agents in `execute_safe`, fleet-wide audit green) before *any* white-label tenant lands? Or can stage-1 white-label start with a manually validated isolation report (signed off by the operator), while the agentized continuous testing comes online in parallel? The conservative answer is "wait for Phase 9 complete"; the pragmatic answer is "manual validation + signed attestation for the first 1-2 tenants, agentized testing in parallel."

8. **The `cra_prohibited_keywords` blocklist — RESOLVED 2026-06-01 (mechanism); list wording PENDING legal sign-off.**

   **Operator decision (verbatim):** "The CRA-prohibition blocklist is a HARD GATE for public launch, P0 for the GenX deltas. The Architect must refuse to assemble any agent whose function touches eligibility decisioning in: credit, employment, housing/tenant screening, insurance underwriting, or government-benefit determination. Implement as a code-enforced refusal (keyword + category match) that fails closed and logs a Relay event on every block — not a doctrine note. The prohibited-category list must be legally reviewed and signed off before any public/self-serve tenant is enabled; white-label and internal stay gated behind manual approval until then. Build the mechanism now; treat the exact wording of the list as pending legal sign-off."

   **Implementation contract (P0, lands with the GenX deltas wave):**

   - **Prohibited category list (initial, BUILD-AGAINST; wording pending counsel):**
     1. Credit eligibility / scoring / decisioning.
     2. Employment eligibility / hiring decisioning / candidate screening (beyond non-decisional logistics).
     3. Housing / tenant screening / rental eligibility.
     4. Insurance underwriting / claims decisioning.
     5. Government-benefit determination / eligibility.
   - **Architect refusal path.** Extend `packages/core/src/architect/hydrate.ts` with a `assertNotCraProhibited(blueprint)` step that runs BEFORE `hydrate()` returns. The check is keyword + category match against the agent's `name`, `systemPrompt`, `knowledgeScope`, and proposed `tools[]`. On match, the function throws `CraProhibitedError` carrying the matched category and the offending fragment. The architect SPA renders the refusal verbatim; the run terminates with `architect.refused` (NEW canonical event — add to AGENT-OS-PLAN.md §8.3) carrying `{ category, fragment_hash, blueprint_id }`. No partial assembly. Fail closed.
   - **Relay event addition.** `architect.refused` joins the closed namespace alongside `architect.proposed` and `architect.seeded`. One row per refusal; carries `category` + `fragment_hash` only (no PII; the hash lets ops correlate without storing the prompt content).
   - **Runtime guard at the runner.** Even if a future bug bypasses the architect (e.g., a manually-authored seed), the runner SessionStart guard checks the agent's `name` + `systemPrompt` against the same blocklist BEFORE the first model dispatch. Match → emit `cantfail.cra_violation` (NEW; sibling to `cantfail.model_violation` from Open Q #1) and fail closed. Belt-and-suspenders.
   - **Per-tenant blocklist override is FORBIDDEN.** The list is a global invariant; `tenants.feature_flags` cannot disable it. The migration that adds the flag schema explicitly excludes a `cra_blocklist_override` key. (Same pattern as `CANT_FAIL_KEYS` — a global, not a per-tenant tunable.)
   - **List storage.** The keyword + category match data lives in `packages/core/src/architect/cra-blocklist.ts` as a frozen exported constant — a single, code-reviewed source of truth. NOT in a database table (per-tenant mutation pressure on a database table is a regulatory liability we don't want; code review is the audit trail).
   - **Legal review hook.** Before any public/self-serve tenant is enabled (the §7.7 gate), counsel reviews `cra-blocklist.ts` and signs the wording. The signed PR commit is the artifact attached to the launch-gate checklist. White-label and internal tenants run with the build-against list in the meantime; manual approval per agent at onboarding catches edge cases.
   - **Acceptance tests.** `packages/core/src/architect/architect.test.ts` extended with 5 negative tests (one per prohibited category) asserting the architect refuses to assemble. One positive test asserting an `ecommerce-growth-starter` bundle does NOT trip the blocklist (regression lock for false-positive false-positives).

9. **Custom-domain tier in white-label theming.** §2.1. Defer to tier-2 white-label (sub-path on shared origin for tier-1), or ship it at tier-1 with the DNS + wildcard SSL infrastructure? Cost: a couple weeks of frontend + ops work.

10. **Backfill purge on cross-tenant consent flip-off.** §4.4 — historical aggregated derivatives persist after a tenant flips `cross_tenant_consent_opt_in` from true to false. The aggregates do not contain row data, but they do reflect the tenant's contribution. Is purge required (GDPR-aligned) or is "the view excludes them going forward" sufficient?

11. **The `platform_admin` role placement.** §4.3. `tenant_members.role` is per-tenant; `platform_admin` is global. Add a `platform_admins (user_id)` table, or add a top-level role to `tenant_members` that is "global if `tenant_id` is NULL"? Either works; the former is cleaner.

12. **Whether `tenant_billing_meters` is its own table or columns on `tenants`.** §1.2 proposes a new table; alternative is `tenants.billing_meter jsonb` keyed by month. The table is cleaner for SQL; the jsonb is fewer migrations. Confirm.

13. **The new `tenant.onboarded` event name.** §3.5 proposes adding to the closed `AGENT-OS-PLAN.md` §8.3 registry. Confirm the registry can be extended, or use a generic `lifecycle.changed` with a payload tag.

14. **Stage `'public'` value name on `tenants.type`.** Inherited from `AGENT-OS-PLAN.md` Open Q #2 — restated here for completeness. Alternatives: `'genx'` (couples to brand), `'self_serve'` (functional). This doc assumes `'public'`; needs operator pick before the migration that widens the check constraint ships.
