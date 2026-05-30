# Agent Architect — plain-English → N seeded agents

> **GSD plan.** Phased: research (done) → plan (this doc) → execute. Each execute phase has an acceptance test. `main` stays green between phases.

## Problem

Today, adding an agent means writing a TypeScript seed file (`scripts/seed/acqu-<key>.ts`) and running it. That's fine for the Acqu doctrine (≤70 agents we ourselves know about), but it doesn't productize. The Cliently sell — *configure your agent team in plain English* — requires:

1. **Remix**: take an existing agent and modify it from a single instruction ("make the briefing post weekly instead of daily").
2. **Single-agent creation**: "make me a lead-scorer that watches Close and DMs me on Slack" → produces one well-typed agent seed.
3. **Team creation**: "create my marketing team for Meta ads" → produces a *coherent set* of agents (with cron offsets and handoffs that don't collide).

All three flow through the same machinery: a meta-agent (the **Architect**) calls an LLM to emit one or more `AgentSpec` objects against the same shared schema we use in `scripts/seed/lib/seedAgent.ts`, then writes them with the same idempotent helper.

This is exactly the doctrine's `agent-onboarder` (D7.1) productized.

## Non-goals (v1)

- **Auto-promote autonomy.** Architect always proposes new agents at `propose`. Eval promotes them, not architect.
- **Auto-author new skills.** If a proposed agent references a skill that doesn't exist, architect *suggests* the skill (and routes to `skill-librarian`) but doesn't create it.
- **Auto-connect MCPs.** If a proposed agent needs a not-yet-connected MCP, architect flags it. The user connects via the existing connections UI.
- **Multi-tenant cross-pollination.** Architect is scoped to the caller's tenant.
- **Eval before launch.** v1 ships approved agents disabled (`enabled=false`) until the operator flips them on after a manual dry-run. (v2 adds a dry-run dispatch step inline.)

## UX

```
POST /api/admin/architect/propose
{ prompt: "create my marketing team for Meta ads" }
→ 200 {
    blueprintId: "uuid",
    teamName: "Meta Ads Marketing Team",
    rationale: "...one-paragraph why this composition...",
    agents: [ AgentBlueprint, AgentBlueprint, ... ],
    warnings: [ "uses skill 'meta-creative-teardown' which doesn't exist yet",
                "MCP 'Pipeboard × Meta' is connected; 'Meta Ads Library' is not" ]
  }
```

The blueprint is **not yet seeded**. The operator reviews, edits inline if desired, and approves:

```
POST /api/admin/architect/seed
{ blueprintId: "uuid", edits?: Partial<AgentSpec>[] }
→ 200 {
    seeded: [ { key, agentId, autonomy: "propose", enabled: false } ... ]
  }
```

Each seeded agent starts at `autonomy=propose` AND `enabled=false`. Operator flips them on after their first dry-run is green.

For **single-agent remix**: same flow, `prompt: "remix briefing to run weekly on Mondays"` + `baseAgentKey: "briefing"`. The output blueprint has one agent.

## API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/architect/propose` | POST | LLM → blueprint (no DB writes to agents) |
| `/api/admin/architect/seed` | POST | Persist approved blueprint via `seedAgent` |
| `/api/admin/architect/blueprints/:id` | GET | Fetch a stored blueprint |
| `/api/admin/architect/blueprints` | GET | List proposed-but-unseeded blueprints |

All admin-scoped (tenant_id from auth context).

## Architecture

```
prompt + tenantId
  │
  ▼
ArchitectInput (validated)
  │
  ▼
buildTeamPrompt() — composes a system prompt with:
  • The AgentSpec JSON schema (so LLM emits valid specs)
  • The tenant's existing agents (key, role) so it doesn't duplicate
  • The tenant's connected MCPs (name, status)
  • The doctrine's tier table (so it picks T-cheap by default)
  • Hard rules: action agents start `propose`; budgets ≤ $2.00; cron stagger
  │
  ▼
LlmClient.complete(prompt) — interface, not a concrete impl
  │
  ▼
parseAgentBlueprints() — strict JSON Schema validation + repair loop
  │
  ▼
hydrateBlueprint() — resolve referenced MCPs/skills/projects by name;
                    annotate warnings for missing references
  │
  ▼
persistBlueprint() — store in `architect_blueprints` table (proposed)
  │
  ▼
return Blueprint

         ┌── operator approves ──┐
         ▼                        │
seedFromBlueprint(blueprintId) ───┘
  │  for each agent in blueprint:
  │    seedAgent(db, spec with autonomy=propose, enabled=false)
  ▼
return seeded summary
```

### LLM interface

```ts
// packages/core/src/architect/llm.ts
export interface LlmClient {
  complete(args: {
    system: string;
    user: string;
    maxTokens?: number;
    jsonSchema?: object;     // hint, not enforced — repair loop catches drift
  }): Promise<{ content: string; model: string; costUsd: number; tokensIn: number; tokensOut: number }>;
}
```

Concrete impls live behind the interface:
- `openrouterLlm({ apiKey, model })` — production, hits OpenRouter w/ a T-reason model (Hermes 405B by default for synthesis quality)
- `fixtureLlm(canned)` — tests, returns deterministic canned blueprints

### The team prompt (system message, draft)

```
You are the Agent Architect for {tenant_name}. You compose teams of agents
that fit a coherent workflow — not lists of bullets.

INPUTS:
- The user's natural-language request.
- The current agents on this tenant (do NOT duplicate them).
- The connected MCPs (you may only assume these are available).
- The doctrine model tier table:
   • T-cheap (hermes-4-70b): monitors, watchers, triage, classifiers
   • T-reason (hermes-4-405b): synthesis, ranking
   • T-work (claude-sonnet-4.6 / haiku-4-5): multi-step orchestration, client-facing
   • T-critical: NEVER assigned by architect — reserved for the can't-fail list

OUTPUT (strict JSON):
{ teamName, rationale, agents: [{
    key, name, role, systemPrompt, model, autonomy: "propose",
    thinkingLevel, knowledgeScope, budgetCapUsd, cron, skills, mcpNames
}] }

RULES:
- Every NEW agent starts autonomy=propose. The operator promotes after eval.
- Stagger crons by at least 5 minutes within the team.
- Reuse existing tenant skills/MCPs when possible. If a needed skill doesn't
  exist, list it in `proposedSkills` (separate field). Same for MCPs.
- Each agent's systemPrompt follows the doctrine shape: who you are, what you
  do (numbered steps), the rules (hard constraints).
- Default budget caps: monitors $0.10, synthesizers $0.50, orchestrators $1.00.
- Action agents (any that write to a connector) keep budgets ≤ $1.50.
- Reject the request if it would require T-critical work (route to humans).
```

### Schema addition

One new table — `architect_blueprints` — holds proposals between propose and seed:

```sql
create table architect_blueprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_by_user_id uuid,                        -- the operator
  prompt text not null,
  team_name text not null,
  rationale text not null,
  llm_model text not null,
  llm_cost_usd numeric(12,4) not null default 0,
  status text not null default 'proposed',        -- proposed | approved | seeded | rejected | superseded
  warnings_json jsonb not null default '[]',
  agents_json jsonb not null,                     -- the proposed AgentSpec[] (snapshot)
  seeded_agent_ids uuid[],                        -- populated on seed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on architect_blueprints (tenant_id, status, created_at desc);
alter table architect_blueprints enable row level security;
create policy ab_select on architect_blueprints for select using (tenant_id = current_tenant_id());
create policy ab_write  on architect_blueprints for all    using (tenant_id = current_tenant_id());
```

(Migration: `0006_architect_blueprints.sql`.)

### Why store the blueprint

- **Audit**: who proposed what; what the LLM emitted vs what got seeded after edits.
- **Idempotency**: re-running `seed` on the same blueprint must not double-write.
- **Versioning**: editing a proposed agent's prompt creates a new blueprint row referencing the prior (status=superseded), keeping history.
- **Cost tracking**: the LLM call to architect is logged like any other cost.

## Safety

1. **No T-critical**: architect's prompt explicitly forbids assigning a `can't-fail` agent's responsibility. If the operator asks "build me an ad-claim-compliance team", architect routes to the human can't-fail-agent flow (returns a blueprint with zero agents + a routing warning).
2. **All proposed agents land disabled.** The operator must flip `enabled=true` after a first dry-run. The runner skips `enabled=false` agents — guaranteed.
3. **All proposed agents land at `autonomy=propose`.** Cannot bypass the approval gate from architect.
4. **Budget cap on architect itself**: the LLM call has its own budget cap (default $0.20 per propose); exceeded → 402.
5. **Tenant isolation**: architect only reads agents/MCPs/skills for the caller's tenant. Cross-tenant suggestions are impossible.

## Test plan

| Phase | Test |
|---|---|
| P1 | `architect.test.ts` — given fixture LLM emitting a 3-agent JSON blob and a known tenant context, produces a Blueprint with hydrated MCP IDs, warnings for unknown MCPs, and 3 specs ready for `seedAgent`. |
| P1 | `architect.test.ts` — JSON repair loop: LLM emits invalid JSON; architect issues a repair request; ultimately succeeds (with cost ≤ 2× single call). |
| P2 | `app.test.ts` — POST /architect/propose returns blueprint; GET /blueprints/:id round-trips; POST /seed creates agents at autonomy=propose, enabled=false; idempotent. |
| P2 | `app.test.ts` — non-admin caller gets 403. Cross-tenant blueprint fetch returns 404. |
| P3 | `architect.team.test.ts` — "create my marketing team for Meta ads" fixture produces ≥3 agents (creative-miner, ad-ops-lite, campaign-monitor) with non-colliding cron and distinct MCPs in their bindings. |
| P4 (UI) | Manual: paste prompt in `/architect` route → preview card → edit → seed → see new agents in `/agents` list, all `enabled=false`. |

## Rollout (execute phases)

| Phase | Scope | PR |
|---|---|---|
| **Execute P1** | `packages/core/src/architect/*`: types, prompt builder, JSON validator + repair loop, hydrator, persister, seeder. Pure logic + the LlmClient interface. Tests use fixtureLlm. | small |
| **Execute P2** | Migration `0006_architect_blueprints.sql`. New endpoints in `apps/api/src/index.ts` (3 routes + list). Integration tests. | small |
| **Execute P3** | `openrouterLlm` impl behind the same interface. Wire to env (`OPENROUTER_API_KEY`). No UI yet. | small |
| **Execute P4** | Control-plane UI route `/architect`: textarea + preview + edit + seed buttons. | medium |
| **Execute P5** | Doctrine bake: re-shape the existing `agent-onboarder` (D7.1) prompt to use this service as its tool. Add an `agent-architect` agent row to the Acqu manifest as a Phase 4 entry (it's a meta agent — promote after Phase 1 lands). | small |

**Gate**: do P1–P3 in this session (sandbox-safe, tests-only; OpenRouter impl just structurally wired). P4 + P5 land next session.

## Open questions (call out, don't block)

- **Single LLM call vs two-pass (decompose → critic)?** v1 is single call. If quality is weak in eval, add a `critic` pass that takes the blueprint and proposes fixes before persistence.
- **Team versioning**: when a team is re-proposed (same prompt, later), do we replace or version? v1 = each call creates a new blueprint; UI shows history. v2 = "team" as a first-class concept (deferred).
- **Per-tenant style/voice carryover**: the architect doesn't yet read kb:tone/. Add later when knowledge retrieval is wired into the prompt builder.

---

**Status**: plan approved by author. Proceeding to Execute P1.
