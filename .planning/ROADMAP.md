# Roadmap: Acqu / Cliently Agent OS

## Overview

A multi-tenant Agent OS — the control plane that runs Acquire Inc (Acqu) on agents and is productized as Cliently. The journey: load the doctrine and prove one agent runs end-to-end as data (Session A) → batch-seed all doctrine functions phase by phase → harden the meta-layer + ship Cliently externally. Each phase is a coherent step that produces working, testable software; data-not-code is the operating discipline that makes every additional agent ~0 lines of application code.

## Phases

**Phase Numbering:** Integer phases for milestone work. Decimal phases (e.g. 5.1) reserve room for urgent insertions; none used yet.

- [x] **Phase 1: Session A — doctrine + safety hooks + vitals pattern** — Doctrine docs in /docs/, CLAUDE.md, safety hooks 1a/1b/1c, migrations 0001–0005, vitals seed proves "agent as data."
- [x] **Phase 2: Phase-1 doctrine batch seed (8 agents)** — Seed pattern fanned out for ad-ops, briefing, ea, expense-tracker, margin-monitor, dunning-manager, connector-health-monitor, memory-consolidator.
- [x] **Phase 3: Architect feature (plain-English → N seeded agents)** — Core module + 4 admin API routes + /architect UI + 31 unit tests passing.
- [x] **Phase 4: Architect remix mode** — `mode=remix` loads base agent context; UI Remix button on agent drawer; deep-link `?focus=<blueprintId>`.
- [x] **Phase 5: Phase-2 doctrine batch seed (creative engine + ad-claim-compliance gate)** — 8 agents including the T-critical Claude Opus 4.8 hard gate that unblocks client ad launches.
- [ ] **Phase 6: Phase-3 doctrine batch seed (fulfillment + revenue ops)** — 12 agents: launcher, lead-triage, booking-concierge, funnel-monitor, onboarding-runner, client-comms, client-health, churn-risk-detector, ar-aging-monitor, revenue-recognizer, cash-position-monitor, runway-watcher. Wires the churn-signal chains (E.4) and the finance reconciliation chain (E.7).
- [x] **Phase 7: Tools registry + Inngest scheduler + Browserbase tool.browser** — Build deltas from main §6: a first-class `tools` table behind `agent_tools` bindings, replace the in-process scheduler with Inngest, and add `tool.browser` over Browserbase + Stagehand. (completed 2026-05-31)
- [x] **Phase 8.5: Autonomous-team primitives (lifecycle states + tenant model override + Hermes-everywhere)** — Migration 0009 ships agents.lifecycle_state + tenants.default_model_override. New API endpoints for hire/fire/pause/archive + bulk model rewrite. seedAgent applies tenant override at seed time (script literals stay doctrine-default; override is per-tenant policy). Runner /next refuses work for non-active agents. Agent Manager spec at /docs/agent-manager-spec.md (handoff to agent-building session for actual seeding + VPS deployment). (completed 2026-05-31)
- [x] **Phase 8: Phase-4 doctrine batch seed (moat + meta-layer)** — compliance-health, intel, decision-memo-drafter, save-play, expansion-finder, discovery-prep, call-summarizer, objection-coach, contract-drafter, payment-collector, unit-economics, agent-evaluator, agent-onboarder + platform-change-watcher, regulatory-watcher, contract-lifecycle-manager, risk-register-keeper, knowledge-curator, skill-librarian, pricing-architect, discount-governor, reinvestment-advisor, forecast-runner.
- [ ] **Phase 9: tenant-isolation-tester + secrets-rotation (external launch gate)** — Hard gate #2 (main §6): no external Cliently tenant until isolation passes. Plus `secrets-rotation`, `access-auditor`, `security-anomaly-watchdog`.
- [ ] **Phase 10: Phase-5 doctrine batch seed (external Cliently launch)** — full offers suite, scaling agents, agent-retirer, human-hiring, vendor agents, qbr-prep, loyalty-rewarder, portfolio-review, marketing-ad-ops, attribution agents, pixel rollout, cliently.support; runner-ops, rate-limit-guardian, incident-responder; full Partnerships/Affiliates suite; competitor-watchtower + market-signal-scanner; full memory layer.
- [x] **Phase 11: External runtime optimization (read-only audit + quarantined extraction)** — Survey wifiwave/agentic-templates-restructure-v2 (read-only at /tmp/ref; license=NONE, RE-AUTHOR not copy). Three planning docs delivered: EXTERNAL-RUNTIME-RECONCILIATION.md, EXTERNAL-TEMPLATES-AUDIT.md, SKILLS-EXTRACTION-REPORT.md. 8 candidates on quarantine branch. Operator decisions recorded in 11-03-DECISIONS.md (Hermes Path A held, isolation kept ours, cliently.dev OUT of AgentOS scope). Depends on: Phase 9. **(closed 2026-06-03)**
- [x] **Phase 12: AgentOS safety regressions** — `agents.key` immutability test + `T_CRITICAL_ALLOWLIST` ↔ runner allowlist parity test. CANT_FAIL_KEYS pinned at 14 (cliently.dev out of AgentOS scope). 61 + 4 = 65 new assertions in `@agent-os/core`. **(closed 2026-06-03)**
- [x] **Phase 13: Candidate ATTACH (5 of 8) — AgentOS** — Reauthored 5 skill files (`prompt-injection-guardrail`, `output-quality-gate`, `shadow-mode-discipline`, `cost-ceiling-discipline`, `scope-lock-discipline`); 69 attach operations across 44 agent seeds. Zero T-critical touches. 3 candidates KEEP-FOR-LATER. **(closed 2026-06-03)**
- [x] **Phase 14: CRA prohibition blocklist (HARD GATE)** — `packages/core/src/architect/cra-blocklist.ts` with 5 categories × 10-12 keywords each. Two enforcement points: hydrate refusal + runtime SessionStart guard emitting `cantfail.cra_violation`. 36 assertions. Global invariant — no per-tenant override. **(closed 2026-06-03)**
- [x] **Phase 15: Prompt-injection guard runtime** — `packages/core/src/security/injection-guard.ts` pure scrub module (6 categories × multi-pattern detection) wired into `tool.browser` handler in `apps/runner`. 58 assertions. **(closed 2026-06-03)**
- [x] **Phase 16: Budget reserve/commit/release pattern** — `BudgetTracker` class with reserve/commit/release semantics + 5 new Relay event names (`budget.reserved/committed/released/cap_breached/summary`). 49 assertions. **(closed 2026-06-03)**
- [x] **Phase 17: Runner BudgetTracker integration** — `executeRun` opens/closes the budget lifecycle on every exit path; synthesizes reserve+commit for terminal spend. 11 assertions; no regressions. **(closed 2026-06-03)**
- [x] **Phase 18: Agent evaluator scorecard (pure module)** — `scoreAgent()` with 5 verdicts (`force_demote_safety`, `insufficient_data`, `demote`, `hold`, `promote`) gated by 5 thresholds. 33 assertions. **(closed 2026-06-03)**
- [x] **Phase 19: Relay emission wiring** — BudgetEvent → Relay `budget.*` events from `executeRun`; injection detections → `finding.recorded` from `tool.browser` handler. Best-effort emission; never throws into the run. **(closed 2026-06-03)**
- [x] **Phase 20: Scorecard controller + `agent_scorecards` migration** — `computeNextAutonomy` controller (5 verdicts → autonomy moves) + migration 0014 + Drizzle table. 25 new assertions. Cant-fail agents capped at `execute_safe`. **(closed 2026-06-03)**
- [x] **Phase 21: `setAutonomy` lifecycle + scorecard job** — `setAutonomy(db, args)` atomic update + `lifecycle.changed` Relay event. `runScorecardJob(inputs, sink)` pure orchestrator with 4-callback sink interface for testability. 25 assertions. **(closed 2026-06-03)**
- [x] **Phase 22: Per-run autonomy ratchet on injection match** — Closes Phase 13 SKILL workflow step 5. `apps/runner/src/run-state.ts` singleton + PreToolUse hook integration; `tool.browser` triggers ratchet to `propose`. 19 assertions. **(closed 2026-06-03)**
- [x] **Phases 11-25 aggregate code review + fixes** — 9 Critical + 14 Warning + 6 Info findings. All 9 Criticals + 9 Warnings patched in one pass; full report in `.planning/phases/00-aggregate-review-phases-11-25/00-REVIEW.md`. **(closed 2026-06-03)**
- [x] **Phase 26: Per-tool reserve/commit + tool cost estimates** — Migration 0016 adds `tools.cost_estimate_usd`; `dispatchCustomTool` reserves-before / commits-after via BudgetTracker; `CapBreachError` refuses on breach. 8 new test assertions. **(closed 2026-06-03)**
- [x] **Phase 27: Per-tenant scorecard threshold overrides** — Migration 0017 + `tenants.scorecard_thresholds` JSONB; scheduled job merges per-tenant overrides on `DEFAULT_THRESHOLDS`. **(closed 2026-06-03)**
- [x] **Phase 28: Per-tool cap-breach Approval surfacing** — `dispatchCustomTool` raises `raiseCapBreachApproval` before throwing `CapBreachError`. Closes Phase 13 cost-ceiling-discipline workflow step 5 at the per-tool layer. **(closed 2026-06-03)**
- [x] **Phase 29: Cross-tenant scorecard aggregate endpoint** — `GET /api/admin/scorecards/xtenant-agg` reads from the consent-filtered view; the moat lens. **(closed 2026-06-03)**
- [x] **Phase 30: Connector tool dispatch-layer ratchet** — `dispatchCustomTool` adds post-handler injection scrub + autonomy ratchet for any `tool.connector.*` (future connector tools inherit defense-in-depth automatically). **(closed 2026-06-03)**
- [x] **Phase 31: DB-backed budget reservations** — Migration 0018 + `budget_reservations` table + `makeReservationPersister`; `BudgetTracker` accepts a persister and re-hydrates on runner restart. 6 new test assertions. **(closed 2026-06-03)**

## Backlog (Tier 2 — recorded for future planning)

- Inngest scheduled function wrapping `runScorecardJob` for each active agent on a cron
- Operator dashboard view over `agent_scorecards` + `agent_scorecards_xtenant_agg`
- Cap-breach Approval surfacing (Phase 13 `cost-ceiling-discipline` workflow step 5)
- Stagehand backend implementation for `tool.browser`
- DB-backed `BudgetTracker` persistence
- Per-tool reserve/commit using per-tool cost estimate column
- Cross-tenant scorecard aggregation (moat lens — read from the existing view)
- Per-tenant threshold overrides (agent-onboarder tight cycle)
- Connector tool integration for the autonomy ratchet (`tool.connector.*` same trigger pattern)

**Capstone for this work session:** `.planning/CAPSTONE-2026-06-03.md`

## Phase Details

### Phase 1: Session A — doctrine + safety hooks + vitals pattern

**Status**: Complete (commits 67cac7d → 851689d on `main`)
**Goal**: Load the doctrine into the repo, land the safety machinery, prove one agent runs end-to-end with zero per-agent code.
**Depends on**: Nothing (foundation)
**Success Criteria**:

  1. The four doctrine docs live in /docs/ and are referenced from CLAUDE.md.
  2. SDK hooks 1a/1b/1c (PostToolUse audit, Stop/budget cap, PreToolUse approval gate) are wired and tested.
  3. `vitals` runs end-to-end against the registry — model, autonomy, persona, skills, MCPs, cron all resolved from DB. Zero `vitals` references in runner source.

### Phase 2: Phase-1 doctrine batch seed

**Status**: Complete (commit 19b9674)
**Goal**: Seed the 8 Phase-1 doctrine agents as data via one shared `seedAgent(db, spec)` helper.
**Depends on**: Phase 1
**Success Criteria**:

  1. `pnpm seed:phase-1` lands 9 agents (vitals + 8 new) idempotently.
  2. Action agents (ad-ops, ea, dunning-manager, memory-consolidator) at autonomy=`propose`; read-only agents at `execute_safe`.
  3. `docs/acqu-phase-1-agent-manifest.md` is the operator-readable shadow.

### Phase 3: Architect feature — plain-English → N seeded agents

**Status**: Complete (commit 36a91d8)
**Goal**: Productize the meta-agent: prompt + tenant context → LLM → blueprint → seedAgent.
**Depends on**: Phase 1, Phase 2
**Success Criteria**:

  1. POST /api/admin/architect/propose returns a Blueprint with autonomy clamped to `propose` and enabled=false on every agent.
  2. Architect refuses to assemble can't-fail agents (returns 0 agents + warning).
  3. /architect UI shows the blueprint, warnings, per-agent system prompt + tier/budget/cron.
  4. 25+ unit tests pass against parse + hydrate + budget clamp + cross-tenant isolation.

### Phase 4: Architect remix mode

**Status**: Complete (commits 5db1e7f → 964f71b)
**Goal**: One-line remix of an existing agent — base context flows into the LLM, seedAgent's upsert-by-key updates the same row.
**Depends on**: Phase 3
**Success Criteria**:

  1. `mode=remix` + `baseAgentKey` loads the base agent's full row (model, autonomy, current prompt, cron) and renders it into the LLM prompt.
  2. Remix preserves the agent's key (integration test asserts same agentId post-seed).
  3. UI Remix panel on the agent drawer Overview tab; navigation to /architect?focus=<id>.

### Phase 5: Phase-2 doctrine batch seed (creative engine + ad-claim-compliance gate)

**Status**: Complete (commit 0e3b9fd)
**Goal**: Seed 8 Phase-2 agents including the T-critical Claude Opus 4.8 `ad-claim-compliance` gate.
**Depends on**: Phase 2 (seed pattern), main §6 hard gate #1.
**Success Criteria**:

  1. `pnpm seed:phase-2` lands 8 agents idempotently.
  2. `ad-claim-compliance` resolves to `anthropic/claude-opus-4.8` — script literal locks the model; can't-fail list refuses Architect-generated alternatives.
  3. Hard gate #1 satisfied: client ad launches now have a compliance gate that can run.

### Phase 6: Phase-3 doctrine batch seed (fulfillment + revenue ops)

**Goal**: Seed the 12 fulfillment + revenue-ops agents that wire the churn-signal chain (E.4) and the finance reconciliation chain (E.7).
**Depends on**: Phase 2 (seed pattern), Phase 5 (ad-claim-compliance gate must precede `launcher` — runbook hard gate).
**Success Criteria** (what must be TRUE):

  1. `pnpm seed:phase-3` lands 12 agents idempotently in tenant Acqu's registry.
  2. `launcher` autonomy=`propose` — never auto-launches Meta ads. Compliance gate sits in front per the doctrine creative→launch chain.
  3. Read-only/monitor agents (`funnel-monitor`, `client-health`, `ar-aging-monitor`, `cash-position-monitor`, `runway-watcher`) at autonomy=`execute_safe`.
  4. The finance reconciliation chain (E.7) has all its agents present: revenue-recognizer (02:30) → attribution-reconciler (already in Phase-1 via memory-consolidator? — verify) → billing-runner (Phase 8) → expense-tracker (Phase 1) → cash-position-monitor (06:00) → ar-aging-monitor (06:00).
  5. `docs/acqu-phase-3-agent-manifest.md` mirrors the Phase-1/2 manifest shape.

**Plans**:

Plans:

- [ ] 06-01: Doctrine extraction — verbatim system prompts + metadata for all 12 agents (RESEARCH.md → CONTEXT.md → 12 individual specs)
- [ ] 06-02: Per-agent seed scripts under `scripts/seed/acqu-*.ts` for all 12 (autonomy + cron + skills + MCPs straight from the doctrine)
- [ ] 06-03: `scripts/seed/seed-phase-3.ts` batch runner + pnpm script wiring
- [ ] 06-04: `docs/acqu-phase-3-agent-manifest.md` operator-facing manifest
- [ ] 06-05: Verification — typecheck, architect tests still pass, commit + push

### Phase 7: Tools registry + Inngest scheduler + Browserbase tool.browser

**Goal**: Ship the three build deltas from main §6 that the doctrine assumes exist.
**Depends on**: Phase 6 (so the tools registry can be populated against the full agent set)
**Success Criteria**:

  1. `tools` table + `agent_tools` join — agents bind to tools the way they already bind to skills/MCPs.
  2. Inngest scheduler replaces the in-process scheduler; pg_cron remains as the trigger that calls Inngest.
  3. `tool.browser` (Browserbase + Stagehand) registered; the dev agent can use it for headless web automation.

**Plans:** 7/7 plans complete

Plans:
**Wave 1**

- [x] 07-01-PLAN.md — tools + agent_tools migration 0007, Drizzle mirror, RLS tests (SC-7-1) — done (supabase db push deferred to operator; see 07-01-SUMMARY.md)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-02-PLAN.md — seedAgent + Bundle extended with tools field; backward-compatible AgentSpec (SC-7-1)
- [x] 07-03-PLAN.md — @agent-os/inngest workspace: client + runScheduledAgent + unit test (SC-7-2)
- [x] 07-05-PLAN.md — @agent-os/tool-browser workspace: SSRF denylist + Stagehand wrapper + unit tests (SC-7-3)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 07-04-PLAN.md — Hono /api/inngest mount + migration 0008 pg_cron → Inngest bridge (SC-7-2)
- [x] 07-06-PLAN.md — Runner allowedTools narrowing + custom-tool dispatch + live Browserbase smoke (SC-7-3)
- [x] 07-07-PLAN.md — Seed tool.browser row + architect regression assertions (SC-7-1, SC-7-3)

### Phase 8: Phase-4 doctrine batch seed (moat + meta-layer)

**Goal**: Seed ~20 Phase-4 agents (governance, knowledge curation, pricing, treasury).
**Depends on**: Phase 6, Phase 7 (tools registry)
**Success Criteria**: TBD — derived after Phase 7.

### Phase 9: tenant-isolation-tester + secrets-rotation (external launch gate)

**Goal**: Hard gate #2 — no external Cliently tenant until isolation passes.
**Depends on**: Phase 6, Phase 8
**Plans:** 6 plans
**Success Criteria**:

  1. `tenant-isolation-tester` passes against every table — a cross-tenant read returns zero rows (including the vector store).
  2. `secrets-rotation` runs against vault; expired/rotated credentials trigger connector-health-monitor halt.
  3. `access-auditor` flags orphaned grants.
  4. `security-anomaly-watchdog` running.

Plans:
**Wave 1**

- [ ] 09-01-PLAN.md — Migration 0010 (security_findings + RLS + audit_log index) + Drizzle mirror + recordFinding helper + CANT_FAIL_KEYS gap fix (secrets-rotation) (SC-9-3, SC-9-5)
- [ ] 09-02-PLAN.md — @agent-os/tool-rls-test package: zod input, asUser GUC impersonation, append-only ATTACK_VECTORS, runIsolationSuite, tsx test (SC-9-2, SC-9-4)

**Wave 2** *(blocked on Wave 1)*

- [ ] 09-03-PLAN.md — packages/core/src/security/: vault-rotate (Close refresher + Meta/Stripe stubs), access-audit (archived>30d), anomaly (24h-rolling) + tests (SC-9-2)

**Wave 3** *(blocked on Wave 2)*

- [ ] 09-04-PLAN.md — 4 tool registry seeds (tool.rls-test, tool.vault-rotate w/ requiresApproval=true, tool.access-audit, tool.access-log-analyzer) + 4 customToolDispatch handlers in apps/runner (SC-9-2)
- [ ] 09-05-PLAN.md — 4 T-critical agent seed scripts (opus-4.8 literals) + 4 skill stubs + architect.test.ts can't-fail regression locks (SC-9-1, SC-9-5)

**Wave 4** *(blocked on Wave 3)*

- [ ] 09-06-PLAN.md — seed-phase-9.ts batch runner with HARD FAIL guard + scripts/verify/isolation-live.ts + Phase 9 manifest + [BLOCKING] schema push + [BLOCKING] HARD GATE #2 execution (SC-9-1, SC-9-6)

### Phase 10: Phase-5 doctrine batch seed (external Cliently launch)

**Goal**: Full external launch.
**Depends on**: Phase 9 (hard gate).
**Success Criteria**: TBD — derived after Phase 9.

### Phase 11: External runtime optimization (read-only audit + quarantined extraction)

**Goal**: Distill value from `wifiwave/agentic-templates-restructure-v2-stack-alignment` (read-only at `/tmp/ref`, license=NONE → reauthor, never copy) into 3 planning docs + a quarantined extraction branch. Resolve the Hermes runtime-vs-model fork that the survey surfaced. No live-fleet changes. No merges. Operator gates (1-3) remain deferred.

**Depends on**: Phase 9 close-out (the Relay spine + Model Router + CANT_FAIL safety floor land independently; this phase reads from them but writes no live code).

**Requirements**:
- SC-11-1 — `docs/plans/EXTERNAL-RUNTIME-RECONCILIATION.md` exists with both forks (Hermes runtime-vs-model, isolation model) marked "DECISION: operator's call, do not implement yet"
- SC-11-2 — `docs/plans/EXTERNAL-TEMPLATES-AUDIT.md` exists with 3 columns cross-referenced to AGENTS-PLAN canonical anatomy + Relay schema + the 3 new AGENT-OS-PLAN sections
- SC-11-3 — `docs/plans/SKILLS-EXTRACTION-REPORT.md` exists listing the 8 candidates with provenance + license=NONE + recommended keep/drop
- SC-11-4 — branch `feat/external-skills-extraction` carries 8 re-authored `agents/_candidates/<slug>/SKILL.md` files, none attached to T-critical agents, all provenance-tagged
- SC-11-5 — zero `live-fleet` changes (existing `scripts/seed/acqu-*.ts`, `external/acqu-skills/`, `CLAUDE.md`, the 3 plans untouched by this phase's writes — verify via `git diff main` on the branch shows only `docs/plans/` adds + `agents/_candidates/` adds)
- SC-11-6 — write-boundary maintained (no `git remote add`, no clone, no push to non-bunn-os/agent-os repo)
