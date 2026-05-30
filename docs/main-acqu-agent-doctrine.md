# Main Acqu Agent Doctrine

> **Status: canonical.** This is the top layer. It sets the runtime, model, tooling, skill, and connector decisions for every agent in the system, and it *supersedes* the stack/model/tooling sections of the earlier docs. The two earlier docs remain the detail bank:
> - `acqu-agent-doctrine.md` (v1) — the detailed agent system prompts for the original 14 functions.
> - `acqu-agent-doctrine-v2.md` (v2) — the 8-domain architecture, the 26 functions, the 10 new functions, and the cross-function handoff chains.
>
> Read **this** doc for *how every agent runs* (model, runtime, tools, skills, connectors, hosting). Read v1/v2 for *what each agent does*. Nothing in v1/v2's agent behavior changes — only the machinery underneath is now pinned and optimized.
>
> The north star is unchanged from the original vision: run the business on agents that work on schedules — daily, weekly, monthly — surfacing only decisions that need a human. This doc makes that vision cheap to run and reliable enough to sell.

---

## 0. What changed and why (the optimization, in one screen)

| Decision | Before | Now | Why |
|---|---|---|---|
| **Runtime** | Claude Agent SDK | Claude Agent SDK *(kept)* | It's the runtime, not the model. Your safety hooks live here. Don't rebuild it. |
| **Model gateway** | Direct Anthropic API | **OpenRouter** | One key → many models, per-agent routing, automatic fallback, cheaper tokens. |
| **Default model** | Claude tiering | **Hermes 4 (via OpenRouter)** for most agents | ~$0.13/$0.40 per M tokens (70B) — a fraction of Claude — and most agents are monitors/triage. |
| **Can't-fail agents** | Claude | **Claude (Sonnet/Opus), never Hermes** | Compliance, security, contracts, pricing, decisions: a few cents saved isn't worth a wrong call. |
| **Orchestration/scheduling** | Postgres job table + worker loop | **Inngest** | Durable, retryable, observable scheduled + event-driven runs; maps onto the handoff chains. |
| **Browser/scraping layer** | "Stagehand toolkit" (generic) | **Browserbase + Stagehand** | Managed headless browsers + AI automation for the scraping/research tools. |
| **Hosting** | Docker (unspecified) | **Railway** (compute) + **Supabase** (DB) | Railway hosts api/scheduler/runner; Supabase keeps DB + RLS + pgvector. |
| **Connector OAuth** | Self-built vault | **Vault internally now; Nango behind the connection interface at client launch** | Internal = own accounts, no white-label need → keep the vault. Client-facing = Nango for self-hostable credential control + white-label. |
| **Skills** | Named, partial | **Superpowers atomic skills + GSD (dev) + custom ops skills**, assigned per agent | The senior's playbook in writing, tiered to the agent. |

---

## 1. Runtime & model architecture

### 1.1 Runtime — Claude Agent SDK (unchanged)

The Claude Agent SDK stays the runtime for **all** agents. It gives the agent loop, built-in tools, MCP support, subagents, sessions, and — critically — the **hooks** (`PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`) that your safety layer (autonomy gate, approval bridge, budget cap) is built on. Those hooks run in the Claude Code runtime, **not in the model**, so they fire no matter which model the SDK routes to. This is why you can change the model freely without touching the safety layer.

Everything stays behind the single `Runner` interface. Only the `Runner` impl knows about the SDK or OpenRouter.

### 1.2 Gateway — OpenRouter

All model calls route through OpenRouter instead of the Anthropic API directly. You set, per the OpenRouter Agent-SDK integration:

```
ANTHROPIC_BASE_URL = https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN = <OPENROUTER_API_KEY>
ANTHROPIC_MODEL = <per-agent model slug>
# optional tier overrides the SDK respects:
ANTHROPIC_DEFAULT_SONNET_MODEL = anthropic/claude-sonnet-4.6
ANTHROPIC_DEFAULT_OPUS_MODEL   = anthropic/claude-opus-4.8
```

Benefits: one key for every model, switch models per agent with a config field, automatic fallback if a provider is down, and unified billing. The `agents.model` column you already have becomes an OpenRouter model slug.

### 1.3 The verified truth about Hermes on the Agent SDK (read before assigning Hermes broadly)

Confirmed against current docs and the SDK issue tracker:

- ✅ The Agent SDK **can** run Hermes (or any OpenRouter model) by overriding the base URL + model.
- ✅ Hermes 4 supports tool use, function calling, JSON mode, and structured outputs — so it can drive agentic tasks.
- ✅ Your safety hooks still fire (runtime-level, model-independent).
- ⚠️ **Non-Claude models lose Anthropic's context-management features** — the SDK errors on `context-management-2025-06-27` for non-Anthropic providers. Long, context-heavy runs degrade.
- ⚠️ The agentic tool-loop is tuned for Claude's tool-call format. Hermes is **less reliable at complex, multi-step tool orchestration** than Claude.

**Conclusion:** Hermes is excellent and cheap for bounded, single-or-few-step, lower-stakes work — which is *most agents by count*. It is the wrong choice for the handful of agents that do long multi-tool runs or where a wrong output is expensive. Hence the tiering below.

### 1.4 The model-tiering policy

Three tiers. Default to the cheapest that's safe for the task.

| Tier | Model (OpenRouter slug) | ~Cost / M (in/out) | Use for |
|---|---|---|---|
| **T-cheap (default)** | `nousresearch/hermes-4-70b` | ~$0.13 / $0.40 | Monitors, watchers, triage, classification, summarization, single-step tool calls, high-volume low-stakes work |
| **T-reason (cheap reasoning)** | `nousresearch/hermes-4-405b` | ~$1 / $3 | Heavier analysis that's still not safety-critical (some reporting, some synthesis) |
| **T-work (reliable agentic)** | `anthropic/claude-sonnet-4.6` (or `haiku-4-5` for lighter) | check current Anthropic pricing | Multi-step tool orchestration, client-facing content, anything needing dependable tool sequencing |
| **T-critical (can't-fail)** | `anthropic/claude-opus-4.8` / `claude-sonnet-4.6` — **never Hermes** | check current | High-stakes judgment + safety. The list in 1.5. |

Rule: **start an agent at T-cheap, then promote a tier only when its eval suite shows the cheaper model fails the task.** This is the same earn-it discipline as the autonomy ladder — applied to model choice. The `agent-evaluator` (D7.1) measures it; don't guess.

### 1.5 Per-agent model assignment (the matrix)

The **can't-fail list — always Claude (T-critical), never Hermes:**

- `ad-claim-compliance` (D6.1) — a missed FTC/policy violation is a ban or a lawsuit.
- `tenant-isolation-tester` (D5.3) — a false "pass" is a cross-tenant breach.
- `security-anomaly-watchdog`, `access-auditor` (D5.3) — security judgment.
- `contract-drafter` (D1.5), `contract-lifecycle-manager` (D6.1) — legal exposure.
- `pricing-architect`, `discount-governor` (D1.2) — margin decisions.
- `decision-memo-drafter` (D3.2/D7.3), `offer-architect` (D1.1), `offer-validator` (D1.1) — high-leverage judgment.
- `reinvestment-advisor` (D4.4) — capital allocation.
- `risk-register-keeper` (D6.1) — risk judgment.
- `cliently.dev` code-writing (D5.1) — on Claude (with GSD); QA can be cheaper.

**Default to T-cheap (Hermes 70B):** every monitor and watcher — `connector-health-monitor`, `runner-ops`, `rate-limit-guardian`, `pixel-watcher`, `funnel-monitor`, `expense-tracker`, `expense-anomaly`, `ar-aging-monitor`, `cash-position-monitor`, `client-health`, `event-schema-guardian`, `billing-runner`, `attribution-reconciler`, `loyalty-rewarder`, `booking-concierge`, `lead-triage`.

**T-work (Claude Sonnet/Haiku) — reliable multi-step:** `ad-ops`, `creative-studio`, `creative-miner`, `launcher`, `client-comms`, `weekly-report`, `onboarding-runner`, `churn-risk-detector`, `save-play`, `dunning-manager`, `discovery-prep`, `call-summarizer`, `case-study-builder`, `memory-consolidator`, `intel`, `vitals`, `briefing`, `ea`.

**T-reason (Hermes 405B) — heavier but not critical:** `unit-economics`, `forecast-runner`, `competitor-watchtower`, `market-signal-scanner`, `packaging-experimenter`, `expansion-finder`, `vertical-scout`.

Encode this as the default `model` value when each agent is seeded. It's overridable per agent from the OS and adjusted by eval results.

---

## 2. The tooling stack

### 2.1 Inngest — durable orchestration & scheduling

Replace the raw Postgres job-table + worker loop with **Inngest** as the durable execution layer. Each agent trigger (cron / webhook / state-change) becomes an Inngest function; each step is retryable and observable; long-running and multi-step agent runs survive restarts. This is the concrete engine for the v2 **handoff chains** — a state change (deal closed, payment failed, creative approved) fires an Inngest event that triggers the next agent in the chain. Keep `runs` / `run_summaries` in Postgres as the system-of-record; Inngest is the executor.

### 2.2 Browserbase + Stagehand — the browser/research layer

Wherever the doctrine says "Stagehand Browser Toolkit" or a scraper, the implementation is **Stagehand** (AI browser automation) running on **Browserbase** (managed headless browser infra). This powers: `creative-miner` (Meta Ad Library), `competitor-watchtower`, `competitor-offer-scraper`, `vertical-scout`, `reputation-monitor`, and any agent reading a consumer UI without an API. Build it as one shared custom tool (`tool.browser`) that agents bind to, so browser maintenance is centralized. Prefer official APIs where a field is exposed; use the browser only when there's no API.

### 2.3 Railway — hosting

Railway hosts the compute: the `api`, `scheduler`, and `runner` services (Docker). Supabase remains the database (Postgres + RLS + pgvector + pg_cron). Inngest runs as a managed service or self-hosted alongside. Runners are horizontally scalable Railway services; each takes its `RUNNER_AGENT_IDS` and its key. Keep secrets in Railway's env (and the vault for connector creds), never in the repo.

### 2.4 Connector OAuth — vault internally now, Nango as the white-label layer at productization

There are two separate decisions here that are easy to conflate: **where credentials are stored** and **who runs the OAuth handshake + token refresh.** Storage is already solved — your encrypted vault (`oauthCredentials` + `AOS_VAULT_KEY`) lives in Supabase, scoped by `tenant_id`. The handshake/refresh is the work a managed provider (Nango/Composio) does for you per provider.

**Internal agents / the Agent OS we're building now → keep the vault. Do not add a managed provider.** Internally, Acqu connects *its own* accounts (Close, Meta, Slack, Drive, GitHub, Stripe) — a handful of connections, done once, no external user ever sees the OAuth screen. White-label is worth zero here, and there's no connection *volume* to manage, so a managed provider would be overhead you maintain forever to avoid a few one-time setups. Connect via API key / personal token where the provider allows it; hand-write the OAuth redirect handler only for the 2–3 providers that force it. This is the optimal internal structure and it forecloses nothing.

**The white-label fulfillment interface (clients connecting their own accounts) → Nango is the launch target.** When clients self-connect and we run agents for them, slot **Nango behind the existing connection interface**. Chosen for, in priority order:

1. **Self-hostable credential control** *(the deciding factor)* — Nango is open-source and self-hostable, so many clients' Meta/CRM/Stripe tokens live in *our* infrastructure under our `tenant_id` isolation, not a third party's cloud. For a product whose trust story is "we safely operate your ad accounts," owning the credential store outranks any pricing tier. (Composio is a hosted gateway; self-host/on-prem is enterprise-only.)
2. **White-label OAuth** — clients authorize through *our* brand. (Roughly a tie with Composio; not a differentiator on its own.)
3. **Architecture fit** — Nango's connectors are code-first in our repo (buildable/extensible with Claude Code), matching "tools are code, agents are data." Composio is a closed catalog behind a hosted MCP URL — faster to start, but rented, not owned.

**On pricing — deliberately not the deciding factor, and here's why.** The two meter on different axes: **Nango bills per connection** (~$1/connection/mo after ~10 free; Starter $50/mo, Growth from $500/mo), **Composio bills per tool call** (20K free → 200K at $29 → 2M at $229, then ~$0.25/1K). For the planned model — *clients connect as many tools as they want and build as many always-running agents as they want* — **both meters scale against us** (Nango on connection count, Composio on call volume from constant scheduled runs). At that usage profile the public tiers don't settle it; it becomes a custom/enterprise negotiation on either. So pick on credential-control + architecture (above), not on the tier sheet, and negotiate volume pricing when client count gives leverage. Cost lever at launch: call provider APIs directly and use Nango only for the OAuth handshake + token storage, which sidesteps the usage-metered proxy/sync fees.

**The interface is the asset; the provider is a replaceable part.** Everything sits behind the OS connection interface (same discipline as the `Runner` interface). Vault internally → Nango behind the interface at launch → swap to Composio or our own layer later if real client usage demands it, without the agents or the OS knowing. Migrate connector-by-connector; never rip out the vault.

> **Governance flag (more important than the vendor choice):** "unlimited client-built agents running constantly" is unbounded model spend and unbounded action surface on *our* infrastructure and *our* liability. The per-tenant budget caps, autonomy gates, and approval bridge must be enforced **before** this launches client-facing. The connector layer is swappable; ungoverned client agents are how the economics or the trust blows up.

Composio is the faster start (huge pre-built catalog, hosted MCP URL) and is fine for *internal* Acqu agents, but the white-label + credential-control requirements point to Nango for the productized path. Decision rule: **internal-only speed → Composio is acceptable; anything client-facing → Nango.** Don't rip out your vault to adopt it — migrate connector-by-connector behind your existing connection interface.

### 2.5 How these fit the OS you already built

None of this is a rewrite. It's adapters and config:
- OpenRouter → env vars on the existing `Runner` impl.
- Hermes/Claude tiering → the existing `agents.model` field.
- Inngest → wraps the existing scheduler; `runs`/`run_summaries` unchanged.
- Browserbase/Stagehand → one new shared custom tool.
- Railway → deployment target for existing services.
- Nango → a new connection-provider behind the existing connection interface; vault stays until migrated.

---

## 3. Skills architecture

Skills are the senior's playbook in writing — the highest-leverage asset in the system. Three classes, assigned per agent.

### 3.1 The skill tiers

**A. Atomic "superpower" skills (lifted, not framework-installed).** From the Superpowers library, take the atomic ones as standalone `SKILL.md` files in `acqu-skills`, not the whole framework (it collides with GSD). The universally useful ones:
- `verification-before-completion` — every agent loads this; it's the "did I actually check my work" discipline.
- `systematic-debugging` — for dev + any agent diagnosing a failure.
- `clarify-before-acting` — for agents that take irreversible actions; pairs with the approval gate.

**B. GSD (dev workflow) — `cliently.dev` / `cliently.qa` only.** The plan→execute→verify loop for building the OS itself. Don't load it on ops agents.

**C. Custom ops skills (your moat) — one per recurring workflow.** These already exist as authored `SKILL.md` files (`daily-ad-ops`, `creative-generation`, `lead-routing-qualification`, `client-onboarding`, `weekly-client-reporting`, `client-health-scan`, `churn-risk-detection`, `content-engine`, `playbook-capture`, `memory-consolidation`, `meeting-prep`, `competitor-ad-teardown`, `proposal-drafting`, etc.). The `skill-librarian` (D6.2) proposes new ones when a pattern recurs in run-logs.

### 3.2 Per-agent skill assignment (the pattern)

Every agent loads: **`verification-before-completion`** (always) + **its one function-specific custom skill** + **any atomic skill its task type needs**. Examples:
- `ad-ops` → `daily-ad-ops` + `verification-before-completion` + `clarify-before-acting` (it proposes Meta changes).
- `creative-miner` → `competitor-ad-teardown` + `creative-generation` + `verification-before-completion`.
- `ad-claim-compliance` → `ftc-claim-review` + `clarify-before-acting` + `verification-before-completion`.
- `cliently.dev` → `GSD` + `systematic-debugging` + `verification-before-completion`.
- `memory-consolidator` → `memory-consolidation` + `verification-before-completion`.

The skill's `description` is the activation trigger — keep it precise so it loads only when relevant (over-broad descriptions waste tokens). `skill-librarian` audits this weekly.

---

## 4. Per-agent MCP & API assignment

Each agent binds **only** the MCPs/APIs its job needs (least privilege — `access-auditor` enforces this). The pattern, by function:

- **Ad/creative agents** (D1.3, D2.1): Pipeboard×Meta (MCP) + `tool.browser` (Browserbase/Stagehand) + Slack.
- **Funnel/sales agents** (D1.4, D1.5): Close (MCP) + Twilio + Resend/email + calendar + Slack.
- **Client success/retention** (D2.2, D2.3): Close + Slack + email + the health/churn tools.
- **Finance agents** (D4.x): Stripe + the billing/dunning/AR/revenue tools + Slack. (Stripe creds via Nango/vault.)
- **Infra/security** (D5.2, D5.3): the connector-healthcheck / runner-telemetry / vault-auditor tools + Slack/PagerDuty.
- **Knowledge/intel** (D3.x, D6.2): pgvector-Knowledge + Google Drive + `tool.browser` for outward intel.
- **Dev agents** (D5.1): GitHub (MCP) + Playwright/Browserbase + Sentry + Railway/Vercel deploy.

New connectors worth adding to the registry (from the expanded catalog already seeded): Stripe, QuickBooks, Notion, Apollo, Twilio, Intercom, Airtable, HubSpot, Linear, Sentry, Vercel, Telegram, Calendar. Each connects once via Nango (or the interim vault). OAuth client IDs/secrets per provider are the human-setup step.

---

## 5. Knowledge & instruction rules (additions)

Carry over the v1/v2 knowledge rules (folder tree, `{company}_{project}_{type}_{slug}_{date}` naming, tenant-scoped retrieval, the run-summary contract, the learning loop). Additions for this optimization:

- **Add to the repo `CLAUDE.md`:** the model-tiering table (1.4), the can't-fail list (1.5), and the rule "model is config, never hardcoded; start at T-cheap, promote on eval failure only."
- **Env additions:** `OPENROUTER_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` defaults, `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`, `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`, `NANGO_SECRET_KEY` (when adopted), Railway service envs. Keep `AOS_VAULT_KEY`, `DATABASE_URL`, and (still needed as fallback) `ANTHROPIC_API_KEY`.
- **Per-agent `instructions.md` (the system prompt) gains a header block:** model tier + rationale, bound MCPs, loaded skills, and the verification method — so each agent's instruction file is self-describing and the `agent-evaluator` can check drift.
- **Cost reporting must not assume OpenRouter for everything** — the Hermes-agent project hit exactly this bug (pricing lookups failed for non-OpenRouter providers). Your cost module should own per-provider pricing, not depend on one gateway's metadata feed.

---

## 6. Build deltas — what to add to the existing OS

Ordered, additive, after the safety hooks (1a/1b/1c) land:

1. **OpenRouter routing** in the `Runner` impl (env override) + populate each agent's `model` per the 1.5 matrix. Smallest change, biggest cost lever.
2. **Inngest** wraps the scheduler; port cron + the v2 handoff chains to Inngest events. `runs`/`run_summaries` stay source-of-truth.
3. **`tool.browser`** (Browserbase + Stagehand) as a shared custom tool; rebind the scraping agents to it.
4. **Per-provider cost pricing** in the cost module (don't depend on OpenRouter's feed).
5. **Railway deploy** for api/scheduler/runner; Supabase stays DB.
6. **Connector OAuth:** internally, keep the vault — hand-write OAuth handlers only for the 2–3 providers that require it; API-key/token for the rest. **Nango is a client-launch step, not an internal one** — add it as a connection provider behind the existing interface only when going client-facing; migrate connectors one at a time (vault stays as fallback). Required before external client tenants — pairs with the D5.3 isolation gate.
7. **Skill assignment**: lift the three atomic superpower skills into `acqu-skills`; attach per 3.2.

Each is independently shippable and leaves the build green.

---

## 7. Cross-references

- Detailed agent system prompts (original 14 functions): `acqu-agent-doctrine.md` (v1).
- 8-domain architecture, 26 functions, 10 new functions, handoff chains: `acqu-agent-doctrine-v2.md` (v2).
- Platform build spec (data model, runner, safety hooks, sessions): `acqu-os-build-spec.md`.
- Repo orientation: `CLAUDE.md`.

Verify before relying on: current Anthropic model pricing and slugs, the OpenRouter Agent-SDK base-URL behavior for your chosen models, and Nango's white-label OAuth setup — all move fast; confirm against live docs when you wire them.
