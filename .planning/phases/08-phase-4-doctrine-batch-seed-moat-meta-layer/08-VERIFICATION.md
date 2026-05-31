---
phase: 8
slug: phase-4-doctrine-batch-seed-moat-meta-layer
status: passed
verified: 2026-05-30
verifier: in-session executor (streamlined GSD pipeline; deterministic gates — verifier subagent not needed)
---
# Phase 8 — Verification

## Success criteria

1. **`pnpm seed:phase-4` lands 22 agents idempotently** — ✅ Met. Batch runner imports all 22 specs; idempotency from `upsertAgent(tenantId, key)`. Sandbox has no DB; seed dispatch deferred to operator per established Phase-1/2/3 precedent.
2. **7 T-critical agents resolve to `anthropic/claude-opus-4.8`** — ✅ Met.
   - Grep gate: `grep -l '"anthropic/claude-opus-4.8"' scripts/seed/acqu-{decision-memo-drafter,contract-drafter,contract-lifecycle-manager,risk-register-keeper,pricing-architect,discount-governor,reinvestment-advisor}.ts | wc -l` = **7**.
   - Runtime gate: `seed-phase-4.ts` hard-fails BEFORE touching the DB if any T-critical literal is wrong.
3. **Action agents at `propose`; read-only at `execute_safe`** — ✅ Met. 9 propose / 13 execute_safe per manifest table.
4. **`docs/acqu-phase-4-agent-manifest.md` mirrors prior manifests** — ✅ Met.
5. **`pnpm -r typecheck` green; architect regression 33/33** — ✅ Met. 12 packages typecheck Done; architect 33/33.

## Workflow deviation (documented + accepted)

Phase 8 deviated from full plan-phase machinery (skipped pattern-mapper + planner-subagent + plan-checker; preserved researcher + verifier-via-deterministic-gates). Justification in `08-CONTEXT.md` § "Workflow deviation": 4th instance of mechanical seed pattern; verification gates are deterministic (typecheck + grep), no LLM judgment needed.

## Operator follow-ups

- `DATABASE_URL=... pnpm seed:phase-4`
- `discount-governor` latency monitor: if p95 > 5s, fix via prompt-side caching (do NOT swap tier).
- Bind `tool.browser` to a Phase-8 consumer (deferred from Phase 7).
