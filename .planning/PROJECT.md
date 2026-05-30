# Acqu / Cliently Agent OS

## What This Is

A multi-tenant **Agent OS** — the control plane that runs Acquire Inc (Acqu) on agents,
productized as **Cliently** (the same system sold to clients as tenants). Acqu is tenant #1;
every paying client is tenant #N. Agents are **data** (registry row + versioned system prompt
+ skills + trigger config), not code; the control plane executes them via a swappable `Runner`.

## Core Value

**Adding an agent from the doctrine is a configuration operation — zero new application code.**
If everything else fails, this must hold: the OS executes doctrine agents defined purely as data.

## Requirements

### Validated

<!-- Shipped and confirmed (in-repo, verified). -->

- ✓ **OS-core data model + safety hooks** (propose/execute_safe/execute_full, approval gates, budget caps) — Session A
- ✓ **All 93 doctrine agents seeded as data** — every prompt-bearing function across v1 + v2, verbatim prompts — Phases 1–4 of v1 milestone
- ✓ **Fleet model override** — every agent on `nousresearch/hermes-4-405b`, backend `claude-agent-sdk`, enforced in `_shared.ts`
- ✓ **Skills layer** — 102 skill files; `verification-before-completion` on every agent, `clarify-before-acting` on action-takers
- ✓ **Knowledge scopes + approval gates** parsed from doctrine — 72 agents scoped, 40 with escalation policies
- ✓ **Handoff chains (v2 Part E)** — 6 event chains, 35 subscriber triggers, 33-event canonical vocabulary
- ✓ **Doctrine parser + generic seeder + chain wiring** — unit-tested (17/0), idempotent, one command: `pnpm --filter @agent-os/seed all`

### Active

<!-- Current scope. Building toward these. -->

- [ ] **Tool registry** — the `tools` table + `agent_tools` bindings the build-spec specifies (§3, lines 106–108/101). Make every `tool.*` an agent's prompt references a real registry row the Runner can resolve. *(current phase)*
- [ ] **Runner execution path** — wire the `Runner` interface end-to-end so one agent (`vitals`) runs as data, behind safety hooks (Session A acceptance test).
- [ ] **Eval suites** — per-agent eval cases so `agent-evaluator` can drive promotion/demotion from metrics.

### Out of Scope (for now)

- Installing the full GSD framework (60+ commands, 30 agents, hooks) into this repo — we adopt the **artifact methodology** (PROJECT/ROADMAP/STATE), not the tooling; agent-os is its own product. *(disproportionate; off-mission)*
- Re-tiering agents back to Claude per-tier — overridden by the active 2026-05 operator decision (all Hermes-405B). *(explicit operator override in CLAUDE.md)*
- Nango connector migration — deferred; vault internally until client launch (Main §2.4). *(sequencing)*
- New per-agent code modules — violates the one rule (agents are data). *(core principle)*

## Context

- **Stack:** TypeScript (strict) · TanStack Router SPA + Hono API · Postgres + pgvector (Supabase) · Drizzle · `@anthropic-ai/claude-agent-sdk` (target gateway: OpenRouter) · MCP connectors.
- **Doctrine** lives in `/docs` (`main-acqu-agent-doctrine.md` is canonical for machinery; v2 = WHAT exists; v1 = detailed prompts; build-spec = data model/runner/5-session plan).
- **Migrations** are hand-written SQL in `supabase/migrations/`, applied in filename order by `packages/db/src/migrate.ts`. Drizzle schema mirrors them in `packages/db/src/schema.ts`.
- **Seeders** live in `scripts/seed/` (`_shared.ts` helpers, `_doctrine.ts` parser, `_roster.ts`, `_chains.ts`). Tenant = `TENANT_IDS.acqu`.
- **Remote ephemeral env:** container is reclaimed on inactivity; only what's committed survives. Postgres in-container is restarted per session — re-seed from `pnpm --filter @agent-os/seed all`.

## Constraints

- **Principle**: Agents are DATA, not code. New per-agent module ⇒ stop. Only genuinely-new *deterministic tools* are code (shared).
- **Multi-tenant**: every table carries `tenant_id`; RLS on every table; cross-tenant read returns zero rows. Tested, not assumed.
- **Safety via hooks**: autonomy levels, approval gates, budget caps enforced in SDK hooks — never bypassable via prompt.
- **Model is config**: start cheapest-safe, promote on eval failure. (Currently overridden: all Hermes-405B.)
- **Tooling**: tools save large outputs to files, return the path — never dump into agent context.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Agents seeded as data via doctrine parser, not hand-written modules | The one rule; lets 93 agents ship as config | ✓ Good |
| Whole fleet on Hermes-4-405B (single model) | 2026-05 operator override; SDK stays the backend | — Pending (operator-set) |
| Handoff chains wired as subscriber `agent_triggers` (state/webhook) | That's exactly what the event executor (Inngest) routes on; emitter side stays behavioral | ✓ Good |
| Tool registry derived from seeded prompts (catalog + bindings) | Prompts already carry the doctrine `Tools:` refs — fully data-driven, zero hand-mapping | — Pending (this phase) |
| Adopt GSD artifacts (not the framework) for this build | Persistent memory across ephemeral sessions; state was living only in commit messages | — Pending |

---
*Last updated: 2026-05-30 after adopting GSD (brownfield) + opening the Tool Registry phase.*
