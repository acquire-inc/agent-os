# Connect & Launch — End-to-End Production Setup

**Audience:** the operator standing up AgentOS for our internal team. Read top
to bottom for first launch; come back for any single section later.

> Companion to `docs/internal-launch-runbook.md` (the 10-item checklist) and
> `LAUNCH.md` (the 60-second orientation). This doc focuses on the *external
> wiring*: which third-party services to provision, which API keys to mint,
> and how to point a domain at the running stack.

## TL;DR — the minimum to be live

You need accounts at four providers and one domain:

| # | Provider | What it does | Cost to start |
|---|---|---|---|
| 1 | **OpenRouter** | Token gateway for every model — Hermes 70B/405B + Claude Sonnet/Opus all through one key | Pay-as-you-go |
| 2 | **Supabase** | Postgres 16 + pgvector + RLS + Auth | Free tier OK for internal |
| 3 | **Inngest** | Durable scheduler — retries, observability | Free tier OK |
| 4 | **Hosting** (Render / Railway / Fly / Vercel) | Run the API + scheduler + runner + control plane | $20–80/mo for internal scale |
| 5 | **Your domain** | Point it at the host | Whatever you already own |

> **One token to rule them all.** Per CLAUDE.md doctrine, OpenRouter is the
> canonical gateway. You do **not** need a separate Anthropic account or a
> separate Hermes/Nous account — both are billed through OpenRouter. The
> Architect runs Hermes by default; agents that need Claude (T-work,
> T-critical) get `anthropic/claude-*` through the same gateway.

## Step 1 — OpenRouter (model gateway)

1. Create an account at <https://openrouter.ai>.
2. Top up credit (start with $50–100 for an internal pilot).
3. Mint an API key at <https://openrouter.ai/keys>. Name it `agentos-prod`.
4. **Use the same key for `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY`** in
   your env. Set `ANTHROPIC_BASE_URL=https://openrouter.ai/api`.

That's it. The runner (Claude Agent SDK) and the Architect (chat completions
API) both route through this one key. You'll see every fork in OpenRouter's
activity dashboard, and the platform's own `model.routed` Relay event gives
a per-run audit trail.

**Why this works:** the Claude Agent SDK respects `ANTHROPIC_BASE_URL` to
proxy requests. OpenRouter speaks the Anthropic protocol on that path, so
the SDK gets identical behavior. T-critical agents resolve to
`anthropic/claude-opus-4.8` (verified at SessionStart — drift fails closed via
`cantfail.model_violation`).

### Alternative — Claude Pro/Max subscription (internal use only)

Have a Claude subscription and no OpenRouter credit yet? The runner can bill
your subscription directly:

1. Run `claude setup-token` on the machine and copy the long-lived token.
2. Set `CLAUDE_CODE_OAUTH_TOKEN=<token>` in the runner's env; leave
   `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` **empty**.
3. Start the runner — the boot log will say
   `live Agent SDK — Claude subscription (Claude models only)`.

What you get: every Claude-tier agent runs live (T-work Sonnet, T-critical
Opus — the cant-fail floor is unchanged). What you don't: Hermes tiers
(T-cheap/T-reason) exist only behind OpenRouter, so those agents fail with an
actionable message — point their tier at a Claude model via
`tenants.tier_overrides` (e.g. `{"T-cheap": "anthropic/claude-haiku-4-5"}`)
until you add OpenRouter. The Architect endpoint also stays 501 without
`OPENROUTER_API_KEY` (it needs a raw completions API, which subscription auth
doesn't expose) — seed agents from scripts instead.

**Doctrine caveat (CLAUDE.md):** subscription auth is for the internal Acqu
tenant only. Customer-facing Cliently must run on API-key auth.

## Step 2 — Database (Supabase OR local Postgres)

You have two paths depending on your stage. **Pick one.**

### Path A — Local Postgres + pgvector (dev / pre-production)

Same `pgvector/pgvector:pg16` image Supabase ships, so dev/prod parity is
clean. No account, no signup.

```bash
docker compose up -d
# in your .env:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentos
pnpm db:migrate
pnpm seed:acqu-vitals
```

Reset everything with `docker compose down -v`. This is the recommended
loop for the first developer trying things out — production switches to
Path B without a code change.

### Path B — Supabase (recommended for live deploy)

1. Create a project at <https://supabase.com/dashboard/projects>. Region:
   pick the one closest to where you'll host the API.
2. Settings → Database → "Connection string" → copy the **URI** form. That's
   `DATABASE_URL`. (Use the *Direct connection*, not the pooler, for
   migrations.)
3. Settings → API → copy:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never
     ship to the browser)
4. Enable the `pgvector` extension: Database → Extensions → search "vector" →
   Enable. (May already be on by default.)
5. Push migrations:
   ```bash
   DATABASE_URL=postgresql://... pnpm db:migrate
   ```
   All pending migrations apply. Each is additive + idempotent (`IF NOT EXISTS`); safe
   to re-run.
6. Seed tenant #1 and the doctrine agents:
   ```bash
   pnpm seed:acqu-vitals
   pnpm seed:phase-1
   pnpm seed:phase-2
   pnpm seed:phase-3
   pnpm seed:phase-4
   pnpm seed:phase-9
   pnpm seed:tool-browser
   pnpm seed:lead-pipeline      # P3 Discovery + P4 Enrichment+Scoring agents
   pnpm seed:icp-acqu           # starter ICP (mid-market B2B defaults; edit later)
   ```
7. **Run the live isolation suite** — this is *hard gate #2* (no external
   tenant until this passes; internal launch can proceed under operator
   sign-off):
   ```bash
   pnpm verify:isolation-live
   ```

## Step 3 — Inngest (durable scheduler)

1. Create an app at <https://app.inngest.com>. Project name: `agentos`.
2. Settings → Event keys → copy → `INNGEST_EVENT_KEY`.
3. Settings → Signing keys → copy → `INNGEST_SIGNING_KEY`.
4. After you deploy the API in Step 4, register the function endpoint:
   - Inngest dashboard → Apps → "Add new app" → URL =
     `https://api.yourdomain.com/api/inngest`. Sync.

Without these the platform falls back to the in-process scheduler — fine for
dev, not for production (you lose retries and the observability dashboard).

## Step 4 — Host the four services

AgentOS ships as four processes:

| Process | What it does | Resource shape |
|---|---|---|
| `apps/api` | Hono server — admin endpoints, runner endpoints, health, Inngest mount | 1 small instance (256MB / 0.25 vCPU) |
| `apps/scheduler` | Inngest function host — materializes due runs | Run alongside `apps/api` or separately |
| `apps/runner` | Pull-based worker — claims runs, dispatches via Claude Agent SDK | 1 instance per agent group (see below) |
| `apps/control-plane` | Static SPA — the operator UI | Any static host (Vercel/Netlify/Cloudflare) |

### Recommended hosts

- **API + scheduler + runner** on **Render** (or Railway / Fly): three web
  services from the same repo, each with its own start command. Set env vars
  per service.
- **Control plane** on **Vercel** (or Cloudflare Pages): static SPA build,
  custom domain.

### Per-service start commands

```bash
# apps/api
pnpm --filter @agent-os/api start

# apps/scheduler
pnpm --filter @agent-os/scheduler start

# apps/runner
pnpm --filter @agent-os/runner start

# apps/control-plane (build, then serve dist/)
pnpm --filter control-plane build
# then static-host the dist/ output
```

### Runner sharding

A runner instance polls the API for the agents in its `RUNNER_AGENT_IDS` set.
For an internal team, one runner with all agents is fine. Once you have many
heavy agents, run one instance per group of ≤10 agents to parallelize. The
lease arbitration layer (I-003) means agents on the **same target resource**
sequence correctly even across runners.

## Step 5 — Domain wiring

You'll point two subdomains at your hosts:

| Subdomain | Points to | Notes |
|---|---|---|
| `app.yourdomain.com` | Control plane (Vercel) | The operator UI |
| `api.yourdomain.com` | API (Render) | Runner calls back here; embedded in the Bundle |

DNS:

```
app.yourdomain.com   CNAME   cname.vercel-dns.com
api.yourdomain.com   CNAME   <your-render-service>.onrender.com
```

(Your host will give you the exact CNAME target.)

### Env updates after domain is live

In the API's env:
```
PUBLIC_URL=https://api.yourdomain.com
```

In the control plane's build env:
```
VITE_API_URL=https://api.yourdomain.com
```

In Inngest dashboard: re-register the app URL to
`https://api.yourdomain.com/api/inngest`.

## Step 6 — Connect MCPs (connector OAuth)

MCPs (Model Context Protocol servers) let agents act on connectors like
Slack, Stripe, HubSpot, Close, Google Drive, etc. Two paths:

### Path A — Vault'd API keys (fast — for internal launch)

For each connector you want to use:

1. Mint an API key in the connector's dashboard (Slack OAuth app, Stripe
   restricted key, Close API key, etc.).
2. In the control plane → **Connectors** → pick the connector → "Connect" →
   paste the key. The vault encrypts it with `AOS_VAULT_KEY`.
3. **Pick least-privilege scopes**: the connect flow shows scope checkboxes;
   uncheck anything you don't need. The bound scope set is shown on the card
   as a `🔒 N scopes` chip.

The runner decrypts the key at bundle-build time and passes it to the agent
through the MCP server config. Agents never see the raw key in their prompt.

### Path B — Nango behind the connection interface (production posture)

When you're ready to onboard external tenants (post-hard-gate #2):

1. Create a Nango app at <https://app.nango.dev>.
2. Settings → API → copy the secret + public keys to `NANGO_SECRET_KEY` /
   `NANGO_PUBLIC_KEY`.
3. In Nango: configure each connector as a "Provider Integration" with its
   OAuth scopes.
4. The platform's connection interface will detect Nango env vars and route
   connector OAuth through it instead of the vault.

This is `docs/main-acqu-agent-doctrine.md` §2.4 — migrate connector by
connector; don't rip out the vault until every connector is on Nango.

### Connector catalog

The control plane ships a 46-connector marketplace (Slack, Stripe, HubSpot,
Salesforce, Snowflake, Shopify, GitHub, Google Drive, Postgres, Discord,
Zapier, etc.). Add custom MCPs through the same drawer ("Add a connector" →
"Custom MCP" tab).

## Step 7 — First agent dispatch

Once API + runner are up and a connector is connected:

1. Control plane → **Architect** → describe your team in plain English:
   ```
   build me a sales follow-up team for inbound leads from Close,
   with a follow-up SLA monitor
   ```
2. Architect proposes 3–5 agents. Review the picker rationale + overlap
   warnings. Click "Seed all" — agents land at `autonomy=propose`, disabled.
3. Open each agent's drawer → enable it → tune budget cap + autonomy.
4. **Dry-run the first agent** — Control plane → agent → "Dry run" — exercises
   the loop without real tool effects.
5. When happy, promote to `execute_safe` (auto-runs reversible tools,
   proposes irreversible ones to the Approvals inbox).

The eval scorecard runs on a ~6h cycle. After ~20 runs with >90% approval +
verification, the autonomy ladder promotes to `execute_full` automatically.

## Step 8 — Watch the gates

- **Approvals inbox** — every irreversible proposal lands here. The
  critic-quorum layer (V2 P6) auto-approves trustworthy low-stakes work;
  cant-fail proposals always stay human.
- **Proposals tab** — prompt self-improvement (V2 P4) and manager actions
  (V2 P8) queue here. Operator review before apply.
- **Health page** — auto-refreshing dashboard for queue depth, feature-flag
  state, safety strip. If anything turns red here, see
  `docs/incident-runbook.md`.
- **Fleet Activity** — every cross-connector action with filter chips for
  the five V2 loops. If you see lease conflicts piling up on one target,
  re-read `docs/agent-coordination-guidelines.md` and re-partition the fleet.

## Cost expectations (rough)

For a 10-agent internal fleet running ~100 runs/day:

| Component | Cost |
|---|---|
| OpenRouter | $50–150/mo (heavily depends on T-reason vs T-cheap mix; budget caps prevent surprises) |
| Supabase | $0 (free tier) — $25/mo (Pro) |
| Inngest | $0 (free tier covers 50k events/mo) |
| Hosting | $20–80/mo |
| **Total** | **~$100–250/mo** |

The platform's `model.routed` audit + `tenants.monthly_budget_usd` cap mean
no run can blow the budget. The autonomy ladder + circuit breaker pull
back any agent that drifts. T-critical agents stay on Opus regardless.

## Stuck?

- **API returns 501 on `/architect/propose`** → `OPENROUTER_API_KEY` isn't
  set, or the API didn't restart after setting it.
- **Runner says "DRY-RUN"** → `ANTHROPIC_API_KEY` isn't set, or
  `RUNNER_DRY_RUN=1` is on. Check the runner's env.
- **MCP creds don't decrypt** → `AOS_VAULT_KEY` is missing or different from
  the one used when the cred was originally encrypted. Re-connect the
  connector.
- **Runs schedule but never claim** → check Inngest dashboard for failed
  function runs; verify `INNGEST_SIGNING_KEY` matches what Inngest expects.
- **A `cantfail.*` event fired** → it's a safety invariant violation. Read
  the event, fix the cause; **never the invariant**.
- **Cross-tenant data showed up** → stop everything. Re-run
  `pnpm verify:isolation-live`. This is hard gate #2 and trumps everything
  else.

## What's NOT in this doc

- The full launch checklist — see `docs/internal-launch-runbook.md`.
- The fleet coordination model — see `docs/agent-coordination-guidelines.md`.
- The threat model + audit trail — see `SECURITY.md`.
- The architecture tour — see `ARCHITECTURE.md`.
- The on-call playbook — see `docs/incident-runbook.md`.

Welcome. When all four providers are live and `pnpm launch:check` is green
against your env, you're ready to invite the team in.
