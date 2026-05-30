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
**Current focus:** v2 COMPLETE + v3 started (A SDK-export, D voice-lint done). Next v3: G, B, E, C, F.

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
