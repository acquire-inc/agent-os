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

#### Phase 6: Tool Registry  ✅ COMPLETE (2026-05-30)
**Goal**: Every `tool.*` an agent's prompt references becomes a real `tools` registry row, and
each agent is bound to the tools it may call (`agent_tools`). Derived from the seeded prompts.
**Depends on**: Phase 5
**Requirements**: build-spec §3 (tools, agent_tool_bindings), one-rule (deterministic tools are the only per-agent code)
**Success Criteria** (what must be TRUE):
  1. ✓ A `tools` table + `agent_tools` join table exist with RLS, mirrored in Drizzle schema.
  2. ✓ The full referenced catalog is seeded — **62 tools** (numbered `tool.1..22` + named), classified by kind (3 mcp), `requires_approval` (7), `reversible`.
  3. ✓ Every agent bound to exactly its declared tools (ranges filtered to the real numbered universe) — **92 agents, 271 bindings**, idempotent.
  4. ✓ Resolves both directions: agent→tools (`ad-ops → tool.1,4,5,11,17,21,22`) and tool→consumers (`tool.2` Ad Launcher → `launcher` only).
  5. ✓ Seeder idempotent (62/92/271 stable on re-run), joined to `... all`; typecheck + parser test (17/0) green.
Plans:
- [x] 06-01: Schema — migration `0006_tools_registry.sql` + Drizzle `tools`/`agentTools` + `_shared` bind helpers
- [x] 06-02: Catalog + bindings — `_tools.ts` metadata + `seed-tools.ts` (derive from prompts, classify, bind), run + verify

#### Phase 7: Runner execution path  ✅ COMPLETE (2026-05-30)
**Goal**: Verify the (already-built) Runner executes an agent end-to-end behind the safety hooks,
and wire Phase 6's tool registry into execution. *Recon finding: `apps/runner` + `apps/api` +
`apps/scheduler` + `packages/core` already implement the Runner + hooks 1a/1b/1c — so this phase
is GSD verification + closing the registry integration gap, not a rebuild.*
**Depends on**: Phase 6
**Success Criteria** (what must be TRUE):
  1. ✓ `buildBundle` resolves `agent_tools` → a `tools` field on the Bundle (key/name/kind/requiresApproval/reversible); runner Bundle carries it.
  2. ✓ Bound tools surface in the system prompt (approval-gated tools flagged).
  3. ✓ `autonomyGate` honors registry `requiresApproval` (authoritative over the verb heuristic; operator `always_allow` still wins) — unit-tested, non-breaking for today's MCP tools.
  4. ✓ Vitals runs end-to-end via `executeRun` (dryRun): tools in prompt, activity + autonomy events recorded, gate proposes under execute_safe → waiting, resume completes.
  5. ✓ Workspace typecheck clean; core integration 50/0; runner dryRun e2e 11/0; runner test added to `test-all.sh`.
Plans:
- [x] 07-01: Wire `agent_tools` → bundle + system prompt; registry-ready `autonomyGate` (bundle.ts, autonomy.ts, api-client.ts, execute.ts, hooks.ts)
- [x] 07-02: Verification — extend core integration test (bundle.tools + gate override) + new runner dryRun e2e test
**Residual gaps (→ roadmap):** `tool_key → runtime SDK tool-name` map (for true registry-driven gating + SDK `allowedTools` restriction); structured `run_summaries` table / SessionEnd hook.

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
| 6. Tool Registry | v2 | 2/2 | Complete | 2026-05-30 |
| 7. Runner path | v2 | 2/2 | Complete | 2026-05-30 |
| 8. Eval suites | v2 | 0/? | Not started | - |
