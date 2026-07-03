# CLAUDE.md — Acqu / Cliently Agent OS

This file orients every Claude Code session. Read it, then read only the doc section the current task needs.

## What this project is

A multi-tenant **Agent OS** — the control plane that runs Acquire Inc (Acqu) on agents, and which is productized as **Cliently** (the same system sold to clients as tenants). Acqu is tenant #1; every paying client is tenant #N.

## The one rule that governs everything

**Agents are DATA, not code.** An agent is a registry row + a versioned system prompt + skill files + trigger config. Adding an agent from the doctrine is a *configuration* operation — usually zero new application code. If you're writing a new module to add an agent, stop and reconsider. The only per-agent code is a genuinely new *deterministic tool* (shared across agents).

## Canonical docs (read the slice you need; don't load whole docs)

**Precedence:** when any other doc conflicts with `main-acqu-agent-doctrine.md` on *machinery* (models, gateway, hosting, orchestration, browser layer, connector OAuth), **`main` wins**. v1 and v2 carry the same banner at their top.

- `/docs/main-acqu-agent-doctrine.md` — **HOW** agents run: model tiers, tooling (OpenRouter, Inngest, Browserbase, Railway, Nango), skills, connectors. Canonical layer — *supersedes* model/stack/tooling sections of earlier docs.
- `/docs/acqu-agent-doctrine-v2.md` — **WHAT** exists: 8 domains, 26 functions, 10 new functions, handoff chains. *(prompts/architecture only — machinery superseded by main)*
- `/docs/acqu-agent-doctrine.md` — **detailed agent system prompts** for the original 14 functions. *(prompts/architecture only — machinery superseded by main)*
- `/docs/acqu-os-build-spec.md` — **platform build spec**: data model, runner, safety layer, 5-session plan.
- `/docs/acqu-os-session-runbook.md` — Session A/B prompts for loading doctrine + batch-seeding agents (operating reference).

## Architecture in one breath

Control plane (this repo) = registries (agents/tools/MCP/tenants) + knowledge (pgvector) + skills + scheduler + orchestrator + safety/observability. Runtime = the `Runner` interface, implemented v1 on the Claude Agent SDK behind an OpenRouter gateway (gateway wired per Main §1.2). The control plane never imports the SDK directly — only the `Runner` impl does, so the runtime is swappable (e.g. Managed Agents later).

## Stack

TypeScript (strict) · TanStack Router SPA + Hono API · Postgres + pgvector (Supabase) · Drizzle · `@anthropic-ai/claude-agent-sdk` *(target gateway: OpenRouter — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`; build delta per Main §1.2/§6)* · MCP connectors (Close, Pipeboard×Meta, Slack, Google Drive, Gmail, GitHub, n8n, plus the expanded catalog seeded in fixtures). Anthropic auth via **API key** (Cliently is customer-facing; subscription auth isn't allowed there).

## Model tiering — CANONICAL (model is CONFIG, not code; start at the cheapest safe tier, promote only on eval failure)

**The Model Router** (`packages/core/src/router/`) resolves an agent's *tier intent* (`spec.modelTier`) into a *concrete fuel slug* at seed time. Agents declare tier; the router picks fuel. Models are interchangeable — when a new Hermes / Claude / DeepSeek / GPT ships, operators edit `DEFAULT_TIER_MODELS` in one PR and the entire fleet picks it up on next seed. T-critical is the safety floor: hardcoded to Opus, no override accepted, runtime fail-closed via `cantfail.model_violation`.

| Tier | Default fuel (`DEFAULT_TIER_MODELS.primary`) | Use for |
|---|---|---|
| **T-trivial** *(optional)* | `nousresearch/hermes-2-pro-llama-3-8b` | Highest-frequency near-zero-reasoning pings (binary up/down, dedupe, field extraction). Only add if a 3rd tier earns its complexity — 70B is already cheap. |
| **T-cheap — volume default** | `nousresearch/hermes-4-70b` | Where most *runs* happen: monitors, watchers, triage, classification, templated summaries, single-step tool calls. Cheap enough to run always-on. |
| **T-reason — reasoning workhorse ⭐** | `nousresearch/hermes-4-405b` | Multi-step analysis, synthesis, anything where reasoning moves the output. **Preferred whenever reasoning matters** — but reserve for thinking tasks. |
| **T-work — reliable agentic** | `anthropic/claude-sonnet-4.6` (with `haiku-4-5` + `hermes-4-405b` as fallbacks) | Multi-step *tool* orchestration, client-facing content, anything where Hermes is less reliable at complex tool sequencing. |
| **T-critical — can't-fail** | `anthropic/claude-opus-4.8` — **EMPTY fallback chain; EXEMPT from all tenant overrides** | High-stakes judgment + safety (can't-fail list below). Runtime fail-closed via `cantfail.model_violation` Relay event if drift. |

**Resolution precedence** (in `resolveModel()`): T-critical pin → explicit `spec.model` (eval-promotion lever) → `tenants.tier_overrides[tier]` → `DEFAULT_TIER_MODELS[tier].primary`. Every resolution emits a `model.routed` Relay event for the audit trail.

**Operator levers**:
- `tenants.tier_overrides jsonb` — per-tier per-tenant override (the new mechanism). Shape `{"T-reason": "deepseek/deepseek-v3"}`. T-critical never honored here.
- `tenants.default_model_override` — DEPRECATED legacy single-string override; still applied to non-critical agents for back-compat with warning. Migrate to `tier_overrides`.
- `spec.model` — per-agent override on the seed script (eval-promotion lever). Wins over tier resolution on non-T-critical agents.

> **70B carries volume; 405B carries thinking.** Reserve 405B for where reasoning earns it — most runs are bounded monitors/triage where 70B output is indistinguishable at ~7× lower cost.
> **Skip Hermes 3 in production** — Hermes 4 supersedes it at both 70B and 405B.
> **Rerank 4 Pro** (not a chat model) goes into the pgvector retrieval path as a relevance lever — independent of the tier plan.
>
> See `/docs/main-acqu-agent-doctrine.md` §1.4 for the full rationale and §1.5 for the per-agent matrix.

## Can't-fail agents — ALWAYS Claude Opus (T-critical), never Hermes — EXEMPT from `tenants.default_model_override`

`ad-claim-compliance`, `tenant-isolation-tester`, `security-anomaly-watchdog`, `access-auditor`, `secrets-rotation`, `contract-drafter`, `contract-lifecycle-manager`, `pricing-architect`, `discount-governor`, `decision-memo-drafter`, `offer-architect`, `offer-validator`, `reinvestment-advisor`, `risk-register-keeper`.

> **Note:** `cliently.dev` (code-writing) lives in the Cliently product track, not AgentOS. Its can't-fail status is owned by that track's doctrine. The AgentOS `CANT_FAIL_KEYS` set is exactly the 14 above.
> **Note:** `secrets-rotation` is part of the security tier (Phase 9) — touches tenant vault credentials, fails closed if it goes wrong. T-critical.

**Tier wins, override loses.** T-critical agents always run Opus and are EXEMPT from `tenants.default_model_override` (Phase 8.5). The seed function skips the override when `isCantFail(spec.key)` is true; the runner asserts the resolved model at SessionStart and emits `cantfail.model_violation` (Relay event) + fails the run closed if a T-critical agent is ever dispatched on a non-Opus model. The override is the cost-saver default for non-critical tiers only — it never reaches the can't-fail set. See `docs/plans/AGENT-OS-PLAN.md` Open Q #1 (RESOLVED) for the implementation contract.

## CRA prohibition (public-launch HARD GATE)

The Architect MUST refuse to assemble any agent whose function touches eligibility decisioning in: **credit · employment · housing/tenant screening · insurance underwriting · government-benefit determination**. Code-enforced (keyword + category match in `packages/core/src/architect/cra-blocklist.ts`), fails closed, emits `architect.refused` (Relay event). Runtime guard at the runner — even manually-authored seeds bypassing the architect — emits `cantfail.cra_violation` + fails closed. List is a global invariant; `tenants.feature_flags` cannot disable it. Legal sign-off on the wording is the precondition for enabling any public/self-serve tenant. See `docs/plans/GENX-PLAN.md` Open Q #8 (RESOLVED mechanism; wording pending counsel).

## Non-negotiables

1. **Model is config, not code. Agents are data, not modules. New agents start at T-cheap + `propose`.** Promotion (model tier OR autonomy) is earned from eval/approval-rate metrics; demotion is automatic on drops.
2. **Multi-tenant from day one.** Every table carries `tenant_id`; RLS on every table. A cross-tenant read must return zero rows — including the vector store and the runner's view. Tested, not assumed.
3. **Safety via hooks.** `propose` / `execute_safe` / `execute_full`, approval gates, and budget caps are enforced in SDK hooks (PreToolUse / PostToolUse / Stop / SessionEnd) so an agent can't bypass them via its prompt.
4. **Tools save large outputs to files and return the path.** Never dump big tool results into agent context.
5. **Three hard gates** (doctrine v2): no client ad launches before `ad-claim-compliance` exists; no external multi-tenant Cliently before `tenant-isolation-tester` passes; no recurring billing before `dunning-manager` exists.
6. **Connector OAuth:** vault internally now; Nango behind the connection interface at client launch (Main §2.4). Don't rip out the vault — migrate connector-by-connector.
7. **Confirm model slugs + Anthropic pricing against live docs** before relying on them (they move).

## Working conventions

- Each session has **one deliverable** and an acceptance test (see build-spec §9 + appendix). End the session when it passes. Commit. `main` stays green.
- Plan before you code. Keep PRs small.
- Tests are the verification step — write the failing test first.
- Knowledge file naming: `{company}_{project}_{type}_{slug}_{yyyy-mm-dd}.md`.

## Current phase

> Update this line each session. **Now: Phases 1–70 closed — platform is publish-ready; operator gates remain.** V1 platform + V2 P1–P10 buildable-now portions + coordination invariants (I-001/2/3) + lead pipeline P3/P4 + three GSD hardening loops (68/69/70) all shipped. `pnpm launch:check` is the readiness oracle (READY ✓); `.planning/LAUNCH-CAPSTONE.md` is the "what shipped" source of truth; `.planning/STATE.md` tracks position. Operator gates: `supabase db push` + `pnpm verify:isolation-live` (hard gate #2) + live integration test + OpenRouter key + hosting/domain (docs/connect-and-launch.md). Backlog in ROADMAP.md.
