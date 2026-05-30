---
plan: 07-02
phase: 7
status: complete
completed: 2026-05-30
tasks_completed: 3
tasks_total: 3
commits: 3
---

# Plan 07-02 Summary: seedAgent tools extension + Bundle

## What Was Built

The `tools` registry made usable from the seeding layer — agents now bind to tools
the same way they bind to skills and MCPs, and the runner Bundle carries an agent's
tools. This extends "agents are DATA" to tools: an agent's tool set is a join-table
binding resolved at seed time, not bespoke per-agent code.

## Key Files

### Modified
- `packages/core/src/seed/seedAgent.ts` — added `ensureTool(db, tenantId, { key, name, kind?, description?, inputSchema?, requiresApproval?, reversible? })` (mirrors `ensureSkillFromDir`; safety default `requiresApproval=true` matching the 0007 DDL) and `bindTool(db, agentId, toolId)` (mirrors `bindMcp` — `insert ... on conflict do nothing`). `AgentSpec.tools?` added as an OPTIONAL field; `seedAgent()` resolves + binds tools when present and no-ops when absent.
- `packages/core/src/bundle.ts` — `Bundle.tools[]` assembled from the `agent_tools` join so the runner sees an agent's tools.
- `packages/core/src/index.ts` — `ensureTool` / `bindTool` / `AgentSpec.tools` surface from the `@agent-os/core` root via the existing `export * from "./seed/seedAgent.js"` (re-export ownership moved here from 07-07 during plan revision).
- `packages/core/package.json` — test script wiring for the new seedAgent test.

### Created
- `packages/core/src/seed/seedAgent.test.ts` — asserts (a) an existing-shape `AgentSpec` WITHOUT `tools` still seeds (backward-compat contract), (b) a spec WITH `tools` binds them, (c) idempotent re-bind, (d) `Bundle.tools[]` is assembled.

## Verification

- `pnpm -r typecheck` — all 10 packages pass (critically `scripts/seed`: the 26 existing `acqu-*.ts` seeds compile unchanged — `AgentSpec.tools` is optional).
- `pnpm --filter @agent-os/core run test:architect` — 31/31 pass (regression gate green; AgentSpec/Bundle change did not break blueprint parse/hydrate).

## Backward-compat contract (honored)

`AgentSpec.tools` is OPTIONAL with no default required at call sites. Every Phase-1/2/3/5
seed script (`scripts/seed/acqu-*.ts`) continues to compile and run without modification.

## Notes

This plan's executor completed all 3 task commits (316f7a0, 0f5c918, c3de662) but its
final turn hit an API stream-idle timeout before writing this SUMMARY + tracking. The
orchestrator verified the committed work (typecheck 10/10, architect 31/31, helper surface
present) and closed out the bookkeeping. No re-execution was needed — the implementation
was complete and sound.

## Operator follow-ups

None. (No DB push or network action in this plan — pure TypeScript.)
