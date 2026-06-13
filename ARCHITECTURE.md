# Architecture

A one-page tour of AgentOS. Aimed at engineers joining the team, auditors,
prospective customers reviewing the platform.

## What it is

A multi-tenant control plane that runs agents. Agents are **data** (registry
row + versioned prompt + skill bindings + connector bindings + cron config),
not code. Model is **configuration**, not code. Adding an agent is a
configuration operation; the application surface stays constant.

Acquire Inc (Acqu) is tenant #1. Every paying client is tenant #N.

## The shape

```
┌─────────────────────────────────────────────────────────────────┐
│  Control Plane (apps/control-plane)         TanStack SPA        │
│  Operator's eyes + hands. Read-write on the registries.         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  API (apps/api)                             Hono on Node 22     │
│  Admin endpoints + runner endpoints + Inngest mount.            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Postgres + pgvector (Supabase)             Drizzle ORM         │
│  Tenants, agents, runs, jobs, skills, MCPs, tools, knowledge,   │
│  approvals, scorecards, model catalog, model feedback,          │
│  artifacts, objectives, leases, handoffs, proposals, votes      │
│  RLS on every table.                                            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
       ┌──────────────────────┴────────────────────────┐
       │                                                │
┌──────┴────────┐                              ┌────────┴──────┐
│  Scheduler    │                              │  Runner       │
│  (Inngest)    │     materialize jobs →       │  (Claude      │
│               │     queue runs               │   Agent SDK)  │
└───────────────┘                              └───────────────┘
                                                       │
                                                       ▼
                                          ┌─────────────────────┐
                                          │  Tools / MCP        │
                                          │  Connectors         │
                                          │  (Slack, Stripe,    │
                                          │   HubSpot, Browser, │
                                          │   GitHub, Gmail, …) │
                                          └─────────────────────┘
```

## The five doctrine layers

1. **Registries** — agents, tools, MCPs, skills, tenants, projects. Drizzle
   on Postgres. RLS scopes every read by `tenant_id`.
2. **Runner** — the `Runner` interface in `packages/core`. v1 implementation
   on the Claude Agent SDK behind OpenRouter. SDK hooks
   (PreToolUse / PostToolUse / Stop / SessionEnd) enforce autonomy + budget
   + injection-guard.
3. **Safety + governance** — all enforcement is in CODE, never in prompts.
   T-critical Opus pin, CRA blocklist, prompt-injection guard, budget
   reserve/commit/release, tenant cost cap.
4. **Intelligence + self-improvement** — Model Router (tier intent → fuel
   slug), eval scorecard (autonomy ladder), memory loop (per-agent
   episodic), reflexion retry on objectives, prompt self-improvement
   proposal engine, critic peer-approval quorum, autonomous manager
   (pause/retire proposals), agent lease arbitration (don't-overlap),
   async A2A handoff chains.
5. **Operator surface** — control plane SPA: Runs, Activity, Dashboard,
   Cost, Models, Proposals, Onboarding, Health, Agents, Architect,
   Skills, MCPs, Knowledge, Approvals, Settings.

## The data model in one slide

```
tenants (1) ──< tenant_members (n)
   │
   ├──< projects
   ├──< tags
   ├──< agents ──< agent_prompts (versioned, is_current)
   │       │       └──< agent_improvement_proposals (V2 P4)
   │       ├──< agent_skills (m:n) ──> skills
   │       ├──< agent_mcps (m:n)   ──> mcps
   │       ├──< agent_tools (m:n)  ──> tools
   │       ├──< agent_triggers
   │       └──< agent_scorecards
   │
   ├──< jobs (schedule + agent + on/off)
   │
   ├──< runs (every dispatch)
   │       ├──< run_summaries
   │       ├──< run_activity
   │       ├──< approvals ──< critic_votes (V2 P6)
   │       ├──< autonomy_events
   │       ├──< budget_reservations
   │       ├──< artifacts
   │       ├──< agent_leases (I-003)
   │       └──< agent_handoffs (V2 P7) ──> objectives (V2 P3)
   │
   ├──< objectives ──< runs (objective_id, attempt_number)
   ├──< manager_proposals (V2 P8)
   ├──< relay_events (closed-namespace event log; audit trail)
   ├──< api_keys (hashed)
   └──< architect_blueprints
```

## The flow of one run

```
1. Scheduler (Inngest) sees a due job → INSERT into runs (status: scheduled)
2. Runner peeks queue: pending > scheduled (FIFO) → CLAIM run (status: running)
3. Runner builds Bundle (agent + skills + mcps + tools + knowledge +
                          api callbacks + prior learnings)
4. Runner dispatches via Claude Agent SDK:
     ├── PreToolUse hook   → autonomy gate, lease arbitration, injection scrub
     ├── PostToolUse hook  → budget reserve/commit, autonomy ratchet on detect
     ├── Stop hook         → terminal status write, session_end event
     └── SessionEnd hook   → memory write-back, reflexion retry, lease release,
                             circuit-breaker evaluation
5. setRunStatus writes terminal row (done | failed | skipped)
6. Cascade:
     ├── writeRunMemory: episode + lessons → vector store (agent-scoped)
     ├── runReflexion:   retry / complete / abandon on objective
     ├── runCircuitBreaker: pull autonomy down or pause if streak
     ├── releaseLeases:  every (kind, key) held by this run
     └── relay emits:    model.routed, budget.committed, lifecycle.changed
7. On scorecard cadence (~6h):
     ├── runScorecardJob: durable autonomy verdict
     ├── runSelfImprovement: propose prompt amendment if lessons recurred
     └── runManagerCycle: propose pause/retire if metrics cross threshold
```

## Where the "don't overlap" guarantee comes from

Lease arbitration: a target resource (`lead/L-12345`, `connector_record/X`,
`objective/Y`) is HELD by exactly one agent run at a time. The runner calls
`acquireLeaseForToolCall` before dispatch; a conflict yields with a
back-off; cant-fail preempts non-cant-fail; cant-fail vs cant-fail never
preempts (equals don't fight); every decision audited on the relay.

The Architect adds a layer earlier: at blueprint time, it warns when two
proposed agents share both the same connector AND the same skill key
(`detectArchitectOverlap`). The operator confirms or has the Architect
redraw the team BEFORE the agents land.

## Where the safety floor lives

All in code, all in `packages/core`:

- T-critical: `architect/hydrate.ts:CANT_FAIL_KEYS` (14 keys), Opus pin in
  `router/resolve.ts`, runtime guard in the runner.
- CRA: `architect/cra-blocklist.ts` (5 categories × 10–12 keywords), three
  enforcement points (onboarding pre-check, architect hydrate refusal,
  runner SessionStart guard).
- Prompt injection: `security/injection-guard.ts` (6 detection categories)
  wired through every external-trust tool dispatch.
- Budget: `budget/tracker.ts` + DB persister; reserve/commit/release per
  run AND per tool AND per tenant monthly.
- Tenant isolation: RLS on every table. `packages/tool-rls-test` ships 32
  attack vectors (frozen, append-only). Live verification is a launch
  gate.

No prompt can disable any of this. The hooks run before the agent's prompt
ever sees the input.

## The model router

```
tier intent (agent declares 'modelTier: T-cheap')
        ↓
    +-------------------+
    | resolveModel()    |
    +-------------------+
        |
        ├── if isCantFail(agent.key)   → Opus (override-exempt)
        ├── if spec.model set          → eval-promotion slug
        ├── if tenant tier_override    → tenant's choice
        └── else                       → DEFAULT_TIER_MODELS[tier].primary
        ↓
    emit model.routed event (audit trail)
```

A new Hermes / Claude / DeepSeek / GPT ships? Operator edits
`DEFAULT_TIER_MODELS` in one PR; the entire fleet picks it up at next
seed. **Model is config.**

## The self-improvement compounding loop

```
RUN finishes
  ↓ writeRunMemory: episode + heuristic lessons → agent-scoped vector ns
  ↓
NEXT RUN starts
  ↓ buildBundle: prior-learnings retrieved into system prompt
  ↓ agent runs smarter than before
  ↓
... after N runs of recurring lessons ...
  ↓ runSelfImprovement: PROPOSES a prompt amendment to operator queue
  ↓ operator applies → NEW agent_prompts version → next runs smarter still
  ↓
... after M runs of low success rate ...
  ↓ runScorecardJob: durable autonomy verdict (demote)
  ↓ runCircuitBreaker: real-time autonomy pull on streak
  ↓ runManagerCycle: PROPOSES pause/retire to operator queue
```

Operator stays in control. Loops PROPOSE; humans APPLY (except for the
guarded auto-apply paths gated by sample size + cant-fail exclusion).

## Where to read next

- `LAUNCH.md` — 60-second orientation
- `docs/internal-launch-runbook.md` — operator step-by-step
- `docs/agent-coordination-guidelines.md` — fleet design mental model
- `docs/incident-runbook.md` — when things go wrong
- `SECURITY.md` — threat model + audit trail
- `CONTRIBUTING.md` — the discipline encoded
- `.planning/PLATFORM.md` — capability ledger

## Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node 22+
- **Workspaces:** pnpm (15 projects)
- **API:** Hono
- **UI:** TanStack Router SPA + Tailwind
- **DB:** Postgres 16 + pgvector (Supabase)
- **ORM:** Drizzle
- **LLM:** `@anthropic-ai/claude-agent-sdk` via OpenRouter gateway
- **Scheduler:** Inngest
- **Connectors:** MCP protocol
- **Test:** tsx (raw Node test runner; ~750+ assertions across 19 suites)

## Constraints / invariants

These do not change:

1. Agents are data, not code.
2. Model is config, not code.
3. Multi-tenant from day one. RLS on every table including the vector store.
4. Safety is in SDK hooks, not prompts.
5. T-critical 14 keys are Opus, fail-closed.
6. CRA-prohibited categories are refused with no per-tenant override.
7. Every load-bearing decision emits a relay event (closed namespace,
   append-only).
8. Migrations are additive (no drop-column / drop-table without explicit
   sign-off).
9. `pnpm launch:check` returns READY before any merge to main.

When you read these and think "but in my case…": stop and re-read CLAUDE.md.
