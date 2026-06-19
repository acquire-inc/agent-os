# AgentOS — Launch Capstone

> Single source of truth for "what shipped and is the platform ready?"
> Audience: the team about to use AgentOS internally, the operator bringing it
> up, and any reviewer/auditor verifying the surface.
>
> **Status as of HEAD `d9f4bdd` on `claude/exciting-davinci-yvptm`: PUBLISH-READY.**
> `pnpm launch:check` → READY ✓ 29/29 · 38 test suites · 1,006 offline assertions · 0 failures.

## The one sentence

A multi-tenant Agent OS — control plane + runner + scheduler + UI — where
agents are *data* (registry rows + versioned prompts + skill files), model
is *config*, every safety floor is code-enforced in SDK hooks, and the only
mandatory operator key is a single OpenRouter API key that gateways both
Hermes (Architect, T-cheap, T-reason) and Claude (T-work, T-critical).

## What shipped

### Platform foundations (V1)
- Multi-tenant Postgres + pgvector schema (32 migrations, monotonic, RLS on every table)
- Model Router with tier → fuel resolution (T-trivial / cheap / reason / work / critical)
- 14 cant-fail agents pinned to Opus 4.8, EXEMPT from all tenant overrides
- CRA prohibition blocklist enforced at architect + runtime (word-boundary safe)
- Prompt-injection guard (6 categories) on every external-trust tool dispatch
- Budget reserve/commit/release with DB-backed persistence + restart hydrate
- Eval scorecard → autonomy ladder controller (5 verdicts, can't-fail floor)
- Tenant monthly cost cap + per-tool reserve/commit + cost forecasting
- Architect: plain-English → seeded fleet, CRA-refusing, model catalog-aware
- Relay event registry: 45 events, lowercase-dotted, unique, append-only
- Tools registry + Inngest scheduler + tool.browser with SSRF guard
- Live RLS isolation suite (hard gate #2) with 32 attack vectors registered

### V2 self-improvement + coordination loop (P1–P10)
| Phase | What | Status |
|---|---|---|
| P1 + P2 | Per-agent episodic memory + reflection + prior-learnings injection | ✅ pure logic + sinks |
| P3 | Objective state + reflexion retry loop with bounded attempts | ✅ pure logic + mig 0026 |
| P4 | Prompt self-improvement proposal engine (operator-gated apply) | ✅ pure logic + mig 0027 |
| P5 | Real-time anomaly circuit-breaker (post-run, never ratchets up) | ✅ pure logic |
| P6 | Critic peer-approval quorum (cant-fail human-only) | ✅ pure logic + mig 0028 |
| P7 | Async A2A handoff chains (cross-tenant refused, paused-target refused) | ✅ pure logic + mig 0030 |
| P8 | Autonomous manager (proposal-based pause/retire, cant-fail untouched) | ✅ pure logic + mig 0031 |
| P9 | Control-plane correctness pass (idempotency, invalidation, RLS guards) | ✅ shipped |
| P10 | Auto-onboarding Viktor flow (interview → Architect → seeded fleet) | ✅ pure logic |

### Coordination invariants ("don't overlap / don't slop")
- **I-001** Tenant config JSONB validators (T-critical override always rejected; pairwise threshold consistency)
- **I-002** Offline dispatch-results contract twin (compile-time exhaustiveness on RUN_STATUSES; structural validators)
- **I-003** Agent lease arbitration (one owner per `(kind, key)`; cant-fail preempts non-cant-fail; cant-fail-vs-cant-fail never preempts; 5-min TTL floor)

### Lead pipeline (P3 + P4 from build-spec §9)
- Migration 0032: `icps`, `leads`, `lead_events`, `suppression_list` with RLS + unique-active-ICP partial index
- 12 deterministic shared tool handlers:
  - **Discovery (P3):** `apify_run_actor` (matrix-clamped, target_type asserted server-side), `apollo_search`, `supabase_query`, `supabase_insert_lead` (server-side dedupe + suppression + transactional + icp_id ownership check), `supabase_log_event`
  - **Enrichment+Scoring (P4):** `serper_search`, `jina_scrape`, `firecrawl_scrape`, `email_verify`, `phone_validate`, `dnc_scrub`, `update_lead` (whitelist + tenant ownership + server-derived stamps + status derived from qualified)
- Pure logic in `@agent-os/core/lead-pipeline.ts`: matrix selection, dedupe-key computation, suppression matching (normalized phone/email/domain/linkedin), scoring contract validator, qualification rules (DNC + invalid email ALWAYS disqualify regardless of score)
- Two agent seeds: `acqu-discovery-agent` (T-cheap, 08:00 daily), `acqu-enrichment-scoring` (T-cheap, 08:30 daily, scoring delegated to Claude Sonnet 4.6 via `tool.delegate`)

### Operator surface (control-plane UI)
- 18 routes serving HTTP 200 in dev (`/`, `/agents`, `/architect`, `/health`, `/onboard`, `/proposals`, `/approvals`, `/activity`, `/mcps`, `/settings`, `/cost`, `/performance`, `/model-routing`, `/knowledge`, `/skills`, `/connections`, `/routines`, `/jobs`)
- Live `/health` dashboard auto-refreshing platform health
- Editable agent control surface (model deliberately excluded — kept server-governed)
- Critic-quorum + peer-flagged badges on Approvals; cant-fail confirmation gate on Proposals apply
- 46-connector marketplace + add-your-own + least-privilege scopes

### Launch ergonomics
- `pnpm setup` — interactive wizard, masks secret prompts, generates AOS_VAULT_KEY locally, writes 0600 .env
- `docker compose up -d` — local Postgres 16 + pgvector (same image Supabase ships)
- `pnpm launch:check` — 29/29 offline oracle
- `pnpm smoke` — post-deploy API surface verifier
- `pnpm tenant:new` — one-command tenant provisioning
- `pnpm seed:lead-pipeline` — both agents idempotently seeded
- One OpenRouter key gateways everything (`ANTHROPIC_BASE_URL=https://openrouter.ai/api` per CLAUDE.md doctrine)

## Standing gates (verified at HEAD `d9f4bdd`)

| # | Gate | Result |
|---|---|---|
| 1 | Workspace typecheck (17 packages) | ✅ 17/17 Done |
| 2 | Core battery (22 suites) | ✅ 791 assertions / 0 failures |
| 3 | Runner + RLS + tool-browser + inngest (16 suites) | ✅ 215 assertions / 0 failures |
| 4 | Control-plane production build | ✅ clean |
| 5 | `pnpm launch:check` | ✅ READY ✓ 29/29 |
| 6 | Preview HTTP 200 on all 18 routes | ✅ |
| 7 | Migration ordering (32 files) | ✅ monotonic |
| 8 | Relay event registry (45 events) | ✅ lowercase-dotted, unique, append-only |
| 9 | CANT_FAIL_KEYS count | ✅ 14 pinned |
| 10 | Doctrine docs (21 required) | ✅ all present |

## GSD audit trail (Phases 67 → 69)

- **Phase 67** (cluster `60-66`): month-rollup consolidation across data.ts — 5 findings closed
- **Phase 68** (`publish-readiness-review`): 5 Critical + 6 Warning + 4 Info, all closed across 8 surgical commits (tenant sink threading, cant-fail apply gate, data.ts scoping, secret echo, reflexion sink real fields, A2A doc/code alignment, tier-override validator, lease tenant-prefix, etc.)
- **Phase 69** (`final-launch-review`): 3 Critical + 4 Warning + 3 Info, all closed across 2 commits (`tool.lead.update_lead` write-back, matrix target_type guard at dispatch, icp_id ownership check, transactional insert, normalized phone suppression, dynamic migration count, comment cleanup)

Every finding has its review entry, plan entry, and commit hash in `.planning/phases/{68,69}-*/`.

## What the operator still does (none of this is platform code)

| # | Step | Need from operator |
|---|---|---|
| 1 | **Mandatory:** mint OpenRouter key | https://openrouter.ai/keys |
| 2 | Optional but typical: Supabase project | URL + anon + service-role + DATABASE_URL |
| 3 | Optional: Inngest app for durable scheduler | signing + event keys |
| 4 | Host the four processes | Render/Railway (API + runner + scheduler) + Vercel (control-plane) |
| 5 | Domain CNAMEs | `api.yourdomain.com` + `app.yourdomain.com` |
| 6 | Wire MCP connectors (per-connector vault or Nango) | Per-connector OAuth or API keys |
| 7 | Optional P3/P4 lead pipeline keys | apify, apollo, serper, jina, firecrawl, neverbounce, numverify |

Estimated cost for a 10-agent internal fleet at ~100 runs/day: **$100–250/mo** total
(OpenRouter $50–150 + Supabase $0–25 + Inngest $0 + hosting $20–80).

## How to actually launch (when you're ready)

```bash
pnpm install
pnpm setup                                      # interactive — pastes OpenRouter key masked
docker compose up -d                            # local Postgres 16 + pgvector
pnpm db:migrate                                 # 32 migrations applied
pnpm seed:acqu-vitals && pnpm seed:phase-1      # tenant + first batch of agents
pnpm seed:lead-pipeline                         # P3 Discovery + P4 Enrichment+Scoring
pnpm dev                                        # control plane on http://localhost:3000

# When you're ready for the team:
pnpm verify:isolation-live                      # hard gate #2 (live RLS check)
pnpm --filter @agent-os/core test               # live integration twin
# Deploy API to Render with same env vars
# Deploy control-plane to Vercel with VITE_API_URL=https://api.yourdomain.com
# Point CNAMEs
# Hand teammates an admin api-key (provisioned via the API)
```

Full step-by-step in `docs/connect-and-launch.md` and `docs/internal-launch-runbook.md`.

## Doctrine invariants — preserved end-to-end

1. **Agents are DATA, not code.** Adding a new agent is a seed script — `discovery-agent.ts` is 132 lines of configuration, not a module.
2. **Model is CONFIG, not code.** Tier intent (`spec.modelTier`) → router resolves to fuel at seed time.
3. **Multi-tenant from day one.** Every table carries `tenant_id`; RLS on every table; cross-tenant reads return zero rows; verified by the live isolation suite.
4. **Safety via SDK hooks.** Autonomy gates, approval gates, budget caps enforced in PreToolUse/PostToolUse/Stop/SessionEnd so an agent can't bypass via its prompt.
5. **Tools save large outputs to files.** Browser/scrape/Apify results written to ctx.outputDir; path returned to the model.
6. **T-critical (14 agents) pinned to Opus 4.8.** Override-exempt. Runtime fail-closed via `cantfail.model_violation`.
7. **CRA blocklist is a global invariant.** No tenant feature flag disables it.
8. **One OpenRouter key gateways everything.** Per CLAUDE.md Main §1.2/§6.

---

The platform is finished. The publish step is the operator's.
