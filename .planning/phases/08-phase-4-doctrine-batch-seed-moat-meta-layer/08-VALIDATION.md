---
phase: 8
slug: phase-4-doctrine-batch-seed-moat-meta-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-30
---

# Phase 8 — Validation Strategy

> Per-phase validation contract. The pattern is the 4th instance of doctrine batch seed; validation mirrors Phase 6's gate set.

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | tsx runners (matches established `*.test.ts` convention) |
| **Quick run command** | `pnpm --filter @agent-os/core run test:architect` (regression gate — must stay green at 33/33) |
| **Full suite command** | `pnpm verify` |
| **Estimated runtime** | ~30 sec |

## Sampling Rate

- **After each per-agent script lands:** None (the script is data; the typecheck is the gate).
- **After all 22 scripts + batch + manifest land:** `pnpm -r typecheck` + `pnpm --filter @agent-os/core run test:architect`.
- **Before phase close:** gsd-verifier goal-backward check.

## Per-Plan Verification Map

Phase 8 is structured as a single combined plan due to mechanical pattern repetition (CONTEXT.md OOS workflow deviation). Tracking happens at the agent level rather than per-plan.

| Task ID | Component | Wave | Requirement | Test Type | Automated Command | Status |
|---|---|---|---|---|---|---|
| 8-01-* | 22 acqu-*.ts seed scripts | 1 | SC-8-1, SC-8-2 | typecheck | `pnpm --filter @agent-os/seed exec tsc --noEmit` | ⬜ pending |
| 8-02 | seed-phase-4.ts batch runner | 2 | SC-8-1 | typecheck | (above) | ⬜ pending |
| 8-03 | pnpm script wiring | 2 | SC-8-1 | source | `pnpm run \| grep -q seed:phase-4` | ⬜ pending |
| 8-04 | docs/acqu-phase-4-agent-manifest.md | 2 | SC-8-4 | exists | `test -f docs/acqu-phase-4-agent-manifest.md` | ⬜ pending |
| 8-05 | T-critical model lock check | 3 | SC-8-2 | source | `grep -c "anthropic/claude-opus-4.8" scripts/seed/acqu-{contract-drafter,contract-lifecycle-manager,pricing-architect,discount-governor,decision-memo-drafter,reinvestment-advisor,risk-register-keeper}.ts` (expect 7) | ⬜ pending |
| 8-06 | Architect regression | 3 | SC-8-5 | tsx | `pnpm --filter @agent-os/core run test:architect` (expect 33/33) | ⬜ pending |

## Nyquist 8 Dimensions

1. **Correctness** — each script has the exact tier + autonomy + cron + skills + MCPs from doctrine via 08-RESEARCH.md.
2. **Coverage** — every Phase 8 success criterion has at least one verification task.
3. **Determinism** — typecheck + literal greps; no DB needed for these gates.
4. **Independence** — each seed script standalone; batch runner only imports specs.
5. **Performance** — typecheck < 30 sec.
6. **Security** — the 7 T-critical model literals are the safety control (any drift = halt).
7. **Observability** — `pnpm seed:phase-4` prints eyeball table (operator confirms tiering at dispatch).
8. **Reversibility** — no new migrations in Phase 8; seed inserts are idempotent (upsert by tenant+key).

## Status

`status: draft` — flipped to `passed` by the verifier once all rows are ✅.
