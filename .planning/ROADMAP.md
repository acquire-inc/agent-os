# Roadmap: Acqu / Cliently Agent OS

## Overview

From a control-plane skeleton to a self-running, sellable multi-tenant Agent OS. The journey:
prove the OS-core machinery → seed the whole doctrine as data → make those agents actually
*runnable* (tools, runtime, evals) → harden for external multi-tenant launch behind the three
hard gates (ad-claim-compliance, tenant-isolation-tester, dunning-manager).

## Milestones

- ✅ **v1 — Agent Fleet as Data** — Phases 1–5 (shipped through 2026-05-30)
- 🚧 **v2 — Make Agents Runnable** — Phases 6–8 (in progress)
- 📋 **v3 — Productize Externally** — Phases 9+ (planned, gated)

## Phases

<details>
<summary>✅ v1 — Agent Fleet as Data (Phases 1–5) — SHIPPED 2026-05-30</summary>

### Phase 1: OS-core + safety hooks
**Goal**: Data model, migrations, safety hooks (propose/execute_safe/execute_full), vitals seed pattern.
Plans: [x] schema + migrations 0001–0005 · [x] safety hooks 1a/1b/1c · [x] vitals doctrine-clean seed

### Phase 2: Phase-1 agents (cashflow + founder time)
**Goal**: Hand-tuned Phase-1 doctrine agents seeded as data.
Plans: [x] ad-ops, vitals, briefing, ea, expense-tracker, margin-monitor, dunning-manager, connector-health-monitor, memory-consolidator

### Phase 3: Full §1.5 roster (Phases 2–5)
**Goal**: Batch-seed the rest of the roster via the generic seeder + Hermes-405B fleet override.
Plans: [x] `_roster.ts` engine · [x] 46 roster agents · [x] fleet model = hermes-4-405b

### Phase 4: Entire doctrine (all prompt-bearing agents)
**Goal**: Every remaining doctrine function seeded as data.
Plans: [x] doctrine parser `_doctrine.ts` + test · [x] 93 agents total

### Phase 5: Agent optimization + handoff chains
**Goal**: Enrich agents from the doctrine and connect them.
Plans: [x] knowledge-scope + approval-gate parsing (72 scoped / 40 gated) · [x] v2 Part E chains (6 chains, 35 triggers)

</details>

### 🚧 v2 — Make Agents Runnable (In Progress)

**Milestone Goal:** The seeded agents stop being inert config and become executable — they
resolve real tools, run through the Runner behind safety hooks, and are measured by evals.

#### Phase 6: Tool Registry  ← CURRENT
**Goal**: Every `tool.*` an agent's prompt references becomes a real `tools` registry row, and
each agent is bound to the tools it may call (`agent_tools`). Derived from the seeded prompts.
**Depends on**: Phase 5
**Requirements**: build-spec §3 (tools, agent_tool_bindings), one-rule (deterministic tools are the only per-agent code)
**Success Criteria** (what must be TRUE):
  1. A `tools` table + `agent_tools` join table exist with RLS, mirrored in Drizzle schema.
  2. The full tool catalog referenced across all agent prompts is seeded (numbered `tool.1..22` + named tools), classified by kind (custom/mcp), `requires_approval`, `reversible`.
  3. Every agent is bound to exactly the tools its prompt references (ranges expanded), idempotently.
  4. A query resolves any agent → its callable tools, and any tool → its consumers.
  5. Seeder is idempotent and joins the `... all` pipeline; typecheck + parser test green.
Plans:
- [ ] 06-01: Schema — migration `0006_tools_registry.sql` + Drizzle `tools`/`agentTools` + `_shared` bind helpers
- [ ] 06-02: Catalog + bindings — `_tools.ts` metadata + `seed-tools.ts` (derive from prompts, classify, bind), run + verify

#### Phase 7: Runner execution path
**Goal**: Wire the `Runner` interface so `vitals` runs end-to-end as data, behind the safety hooks (Session A acceptance test: read metrics → post Slack snapshot, audited).
**Depends on**: Phase 6
**Success Criteria**:
  1. `Runner.run()` resolves an agent's prompt + tools + scope and executes one turn.
  2. PreToolUse/PostToolUse/Stop/SessionEnd hooks fire; a run-summary lands in `run_summaries`.
  3. `vitals` produces its snapshot through the OS, with tool calls audited.
Plans: TBD

#### Phase 8: Eval suites
**Goal**: Per-agent eval cases so `agent-evaluator` drives promotion/demotion from metrics.
**Depends on**: Phase 7
**Success Criteria**:
  1. Eval cases exist for the can't-fail agents + the high-volume monitors.
  2. `agent-evaluator` can score an agent run against its cases and write a scorecard.
Plans: TBD

### 📋 v3 — Productize Externally (Planned, gated)

**Milestone Goal:** External multi-tenant Cliently, behind the three hard gates.
Phases TBD — gated on `tenant-isolation-tester` passing, `ad-claim-compliance` live, `dunning-manager` shipped (the latter two already seeded).

## Progress

**Execution order:** numeric (6 → 7 → 8 → …).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. OS-core + hooks | v1 | done | Complete | 2026-05 |
| 2. Phase-1 agents | v1 | done | Complete | 2026-05 |
| 3. §1.5 roster | v1 | done | Complete | 2026-05 |
| 4. Entire doctrine | v1 | done | Complete | 2026-05 |
| 5. Optimize + chains | v1 | done | Complete | 2026-05-30 |
| 6. Tool Registry | v2 | 0/2 | In progress | - |
| 7. Runner path | v2 | 0/? | Not started | - |
| 8. Eval suites | v2 | 0/? | Not started | - |
