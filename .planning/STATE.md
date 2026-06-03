---
gsd_state_version: '1.0'
status: in_progress
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 2
  completed_plans: 2
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-30)

**Core value:** Adding a doctrine agent is configuration — zero new application code.
**Current focus:** Phase 9 Capability-Hardening COMPLETE (agent-scope). Next: go-live remains
gated on operator decisions — the Hermes runtime-vs-model fork (lean: keep the Anthropic Agent SDK
runner, port gates/skills/KB) and a live-DB run. v3 Stack-Alignment COMPLETE earlier.

### Session 2026-06-02 — go-live hardening + capability hardening (branch claude/seed-phase-1-agents)
Go-live path: migrate is now re-run-safe (schema_migrations ledger + --baseline); DB-free continuity
loop test; verify-golive hardened into a real acceptance gate (every can't-fail agent must be
PRESENT + at propose, count floors, required tables, no irreversible-ungated tool). Seed pure-tests
wired into CI.
**Phase 9 Capability-Hardening (DATA only; audit in `.planning/phases/capability-hardening/`):**
- 09-01 truthful+safe tool catalog: ~39 stub tools given real metadata; side-effecting tools
  (dunning/deploy/arcads/ledgers) now approval+irreversible (closed a real safety downgrade since
  registry flags are authoritative over the verb heuristic). 17 tests.
- 09-02 connector enrichment: additive role→connector binding (dunning→Stripe, expense→QuickBooks,
  dev→GitHub/Sentry, EA→Calendar…) on top of the sparse doctrine slack/close/gdrive. 17 tests.
- 09-03 allowed-tools on all 103 skills (was 2/103) via author-allowed-tools.ts (idempotent,
  --check coverage gate); 3 true orphans bound. 11 tests. (allowed-tools surfaced on bundle, not
  yet enforced → additive, no behavior change incl. T-critical agents.)
- 09-04 verify: go-live gate now also fails on any irreversible-but-ungated tool.
**Phase 10 Safety-skills + Phase 11 Eval-expansion (agents-session, DATA only):**
- P10: `clarify-before-acting` brought from a 6-line stub to canonical anatomy (42 agents);
  `verification-before-completion` now records `verification_result` (92 agents); AGENTS-PLAN
  reconciled (run_summaries/continuity/allowed-tools BUILT; Relay spine etc. platform-blocked).
  code-review skill run; 4 findings folded in. _safety-skills 21 tests.
- P11: eval cases 13→29 / 11→27 agents — completed can't-fail coverage (all 14 now have a critical
  case), added high-volume monitors + chain participants. _evals 15 tests (incl. the can't-fail
  critical-coverage invariant).
- P12: 12 thin primary skills brought to canonical anatomy (## Steps + a doctrine-grounded
  ## Guardrails section each — the missing safety rails). author-skill-anatomy.ts (idempotent +
  --check gate); _skill-anatomy 64 tests.
NOTE on the external-restructure instructions (OUTPUT 2): its inputs (AgentOS audit docs +
feat/external-skills-extraction branch + /agents/_candidates + zip) do NOT exist in this repo, and
several premises mismatch (the two "missing" skills already exist; CANT_FAIL_AGENTS not
CANT_FAIL_KEYS/hydrate.ts; offer-architect/validator already seeded+listed; "T-critical→Opus floor"
contradicts the shipped all-Hermes-405B + autonomy-ceiling override). Did NOT execute it; ran the
real-this-repo equivalent (Phase 9) per operator ("only run what is for agents, resume").

### v3 completion (2026-05-30, verified ground-truth after sandbox rollback)
All 7 enhancements re-built one-at-a-time with per-step verification (the earlier batch was
rolled back by a container reset; commits 2f00d68 G+C, 0f13de4 E, 85a30d0 B, 1156ad1 F).
Final from-scratch verify: 8 migrations; workspace typecheck 0; schema 14/0; core 69/0;
runner 13/0; vault 25/0; seed all green (93 agents, 63 tools, 13 eval cases, 93 scorecards);
93 SDK-native exports. NOTE: registry test has 1 PRE-EXISTING failure (`superpowers` —
missing /tmp/superpowers fixture, unrelated to any of this work).

### Session 2026-06-01 — autonomy meta-layer + metering + Hermes SPOF (shipped, branch claude/seed-phase-1-agents)
Built on top of the decision record. All DATA-or-deterministic-tool, doctrine-clean; pure
logic is unit-tested without a DB (no live Postgres in this container — migrations 0009/0010
apply on deploy).
- **agent-architect** (DATA) — the deep-thinking org-design agent that decides *what agents to
  create*, the generative call the D7.1 trio (onboarder/evaluator/retirer) never made. Hermes
  4 405B, thinking=high, autonomy=propose; triggers cron 08:00/16:00 + on_demand + state(fleet.
  strain). Seeded standalone + wired into seed-everything.
- **workforce lifecycle tool** (packages/core/workforce.ts) — pure spawn/activate/pause/archive/
  reactivate state machine + tenant-scoped registry writes. Spawned agents land proposed+disabled
  (a human approves before they run). Catalog-classified requires_approval+irreversible → the
  existing PreToolUse gate auto-enforces. Migration 0009 adds agents.status. 21 unit tests.
- **metering→credits** (packages/core/metering.ts, migration 0010) — turns per-run cost_usd into
  per-tenant billable usage + credit balance (the Cliently billing piece feeding billing-runner/
  dunning-manager). usage_events (idempotent per run), credit_ledger (append-only), tenant_credits
  (balance + markup + peg + prepaid enforcement). Auto-burns on run `done` via setRunStatus;
  prepaid enforcement at claimNextRun; API at /api/billing/*. 21 unit tests.
- **cross-model fallback** (packages/core/model-fallback.ts) — resolves decision-doc item #2
  (Hermes single-sourced on Nebius). Runner retries once on claude-haiku-4-5 for availability
  errors. 15 unit tests.
Commits: 591c805, ff196cc, b40d5b5, 5366bf6, 65cae92. All touched packages typecheck;
pure-test sweep green (workforce 21, metering 21, model-fallback 15, runner 13, seed 18+17+14).

## Current Position

Phase: 8 of 8 (Eval suites) — COMPLETE. **v2 "Make Agents Runnable" milestone done.**
Status: Milestone complete; v3 (stack alignment to the uploaded `agentic-templates` repo) is queued.
Last activity: 2026-05-30 — Phase 8 shipped + v3 A/D landed, then a flaky-sandbox repair
(commit 2a406d7): three commits had bad readbacks (silently-failed edits + a lost migration).
Now VERIFIED for real: db+core+workspace typecheck 0 errors; core integration 63/0; runner
11/0; seed all green (93 agents, 63 tools, 12 eval cases [8 critical], 93 scorecards); exporter
writes 93 .claude/agents/*.md + manifest.

### Tooling caveat (important for next session)
This sandbox intermittently returned FABRICATED tool readbacks (false "tests passed", edits
reported success but didn't apply, a migration file vanished to a container rollback). ALWAYS
re-verify from ground truth: re-read files after edits, re-run migrate/tests, check `git diff`.
Don't trust a single readback.

Progress: [██████████] 100% of v2 (8/8 phases). v1 + v2 shipped.

## Accumulated Context

### Decisions

Full log in PROJECT.md. Recent:

- [Phase 8 ✓]: Eval cases are DATA keyed by `agent_key` (survive reseeds); metrics are a daily rollup of runs/approvals/autonomy_events; `proposeAutonomyChange` is a pure threshold fn (demote on success<0.8 @≥10 runs; promote on success≥0.95 & approval≥0.9 @≥20 runs).
- [Phase 7 ✓]: Runner already existed; wired tool registry into the bundle + gate.
- [Phase 6 ✓]: Tool registry derived from prompts.

### Pending Todos — v3 (stack alignment)

From `.planning/ASSESSMENT-stack-alignment.md` (uploaded repo = a Python autonomous client-build
factory; reuse its real patterns). Sequenced **A → G → B → D → E**, then C, F:
- **A** SDK-native agent export: `.claude/agents/<key>.md` (frontmatter name/description/model/tools) + `managed-agents-registry.json` manifest. (keystone)
- **G** JSON Schema for agent/tool/skill records.
- **B** skill `allowed-tools` (skill→tool least privilege).
- **D** `tool.voice-lint` brand-voice gate for content agents.
- **E** cost-ceiling pause (re-approval, not just kill).
- **C** credential namespacing AGENTIC_*/CLIENT_<tenant>_*; **F** ManagedAgentsRunner backend.

### Blockers/Concerns

- Postgres is in-container, reset per session — re-seed with `pnpm --filter @agent-os/seed all` (doctrine) or `pnpm --filter @agent-os/db seed` (fixtures for tests).
- Tooling note: large Bash outputs persist to a file (2KB preview); keep outputs modest and Read files.

## Session Continuity

Last session: 2026-05-30
Stopped at: Phase 8 complete + committed. v3 stack-alignment assessment written; ready to execute enhancement A.
Branch: claude/seed-phase-1-agents
