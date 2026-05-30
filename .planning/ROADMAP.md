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
- [ ] **Phase 7: Tools registry + Inngest scheduler + Browserbase tool.browser** — Build deltas from main §6: a first-class `tools` table behind `agent_tools` bindings, replace the in-process scheduler with Inngest, and add `tool.browser` over Browserbase + Stagehand.
- [ ] **Phase 8: Phase-4 doctrine batch seed (moat + meta-layer)** — compliance-health, intel, decision-memo-drafter, save-play, expansion-finder, discovery-prep, call-summarizer, objection-coach, contract-drafter, payment-collector, unit-economics, agent-evaluator, agent-onboarder + platform-change-watcher, regulatory-watcher, contract-lifecycle-manager, risk-register-keeper, knowledge-curator, skill-librarian, pricing-architect, discount-governor, reinvestment-advisor, forecast-runner.
- [ ] **Phase 9: tenant-isolation-tester + secrets-rotation (external launch gate)** — Hard gate #2 (main §6): no external Cliently tenant until isolation passes. Plus `secrets-rotation`, `access-auditor`, `security-anomaly-watchdog`.
- [ ] **Phase 10: Phase-5 doctrine batch seed (external Cliently launch)** — full offers suite, scaling agents, agent-retirer, human-hiring, vendor agents, qbr-prep, loyalty-rewarder, portfolio-review, marketing-ad-ops, attribution agents, pixel rollout, cliently.support; runner-ops, rate-limit-guardian, incident-responder; full Partnerships/Affiliates suite; competitor-watchtower + market-signal-scanner; full memory layer.

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
**Plans**: TBD (5–7 expected)

### Phase 8: Phase-4 doctrine batch seed (moat + meta-layer)
**Goal**: Seed ~20 Phase-4 agents (governance, knowledge curation, pricing, treasury).
**Depends on**: Phase 6, Phase 7 (tools registry)
**Success Criteria**: TBD — derived after Phase 7.

### Phase 9: tenant-isolation-tester + secrets-rotation (external launch gate)
**Goal**: Hard gate #2 — no external Cliently tenant until isolation passes.
**Depends on**: Phase 6, Phase 8
**Success Criteria**:
  1. `tenant-isolation-tester` passes against every table — a cross-tenant read returns zero rows (including the vector store).
  2. `secrets-rotation` runs against vault; expired/rotated credentials trigger connector-health-monitor halt.
  3. `access-auditor` flags orphaned grants.
  4. `security-anomaly-watchdog` running.

### Phase 10: Phase-5 doctrine batch seed (external Cliently launch)
**Goal**: Full external launch.
**Depends on**: Phase 9 (hard gate).
**Success Criteria**: TBD — derived after Phase 9.
