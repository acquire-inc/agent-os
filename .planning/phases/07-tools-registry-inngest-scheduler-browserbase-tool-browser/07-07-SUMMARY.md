---
plan: 07-07
phase: 7
status: complete
completed: 2026-05-30
requirements: [SC-7-1, SC-7-3]
---
# Plan 07-07 Summary: seed tool.browser row + architect regression

## Built
- `scripts/seed/acqu-tool-browser.ts`: `ensureTool(tool.browser)` for tenant Acqu,
  kind=custom, requiresApproval=true, UNBOUND (no agent binding) per RESEARCH
  Open Question 1 — the first consumer binds it in Phase 8.
- `scripts/seed/seed-tool-browser.ts` + `pnpm seed:tool-browser` (two-layer wiring).
- `architect.test.ts`: 07-07 regression — the optional AgentSpec.tools field did
  not leak a required field into blueprint parse/hydrate; architect emits no tools.
  33/33.

## SC-7-3 coverage caveat
ROADMAP SC-7-3 literally says "the dev agent can use it." Phase 7 satisfies it via
three legs: (a) the registry row exists (this plan), (b) the runner dispatch is wired
and unit-tested (07-06), (c) the smoke script exists (07-06). The agent→tool BINDING
is deferred to the first real consumer in Phase 8 per RESEARCH Open Question 1.

## Verification
12 packages typecheck; architect 33/33; seed pkg typecheck clean.

## Operator follow-ups
- `DATABASE_URL=... pnpm seed:tool-browser` (sandbox has no DB).
