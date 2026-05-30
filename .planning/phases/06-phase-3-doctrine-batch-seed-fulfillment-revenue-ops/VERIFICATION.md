# Phase 6: Phase-3 doctrine batch seed — Verification

**status:** passed
**verified:** 2026-05-30
**verifier:** in-session executor (writing-plans + executing-plans discipline)

## Tasks complete

- [x] Task 1: 12 per-agent seed scripts created under `scripts/seed/acqu-*.ts`.
- [x] Task 2: `scripts/seed/seed-phase-3.ts` batch runner created.
- [x] Task 3: `scripts/seed/package.json` and root `package.json` updated with per-agent + `phase-3` scripts.
- [x] Task 4: `docs/acqu-phase-3-agent-manifest.md` operator-facing manifest written.
- [x] Task 5: typecheck + tests + commit.

## Verifications run

```
$ pnpm -r typecheck
packages/shared typecheck: Done
packages/db typecheck: Done
apps/control-plane typecheck: Done
packages/vault typecheck: Done
packages/registry typecheck: Done
packages/core typecheck: Done
apps/scheduler typecheck: Done
scripts/seed typecheck: Done
apps/api typecheck: Done
apps/runner typecheck: Done
```

All 10 packages green.

```
$ pnpm --filter @agent-os/core run test:architect
Results: 31 passed, 0 failed
```

No architect regression.

## Success criteria check (from CONTEXT.md)

1. ✅ `pnpm seed:phase-3` lands 12 agents idempotently — wired via root pnpm script, idempotent by construction (upsert by tenant_id + key, content-hash prompt versioning).
2. ✅ `launcher` autonomy=`propose` — verified in `scripts/seed/acqu-launcher.ts:30`. Header comment carries the hard-gate rationale.
3. ✅ Read-only/monitor agents at `execute_safe` — confirmed in each spec (funnel-monitor, client-health, ar-aging-monitor, cash-position-monitor, runway-watcher, lead-triage, booking-concierge, revenue-recognizer, churn-risk-detector).
4. ✅ Finance reconciliation chain E.7: revenue-recognizer (02:30) + ar-aging-monitor (06:00) + cash-position-monitor (06:00) + runway-watcher (Mon 07:00) seeded. Combined with expense-tracker (Phase 1, 04:00) and margin-monitor (Phase 1, 23:30), the chain has every agent present except `attribution-reconciler` and `billing-runner` — both correctly OOS per CONTEXT.md (deferred to Phase 8).
5. ✅ `docs/acqu-phase-3-agent-manifest.md` mirrors Phase-1/2 manifest shape — same table columns, hard-gate callout, per-agent specs, finance-chain diagram.

## Out-of-scope items honored

- OOS-01: SKILL.md authoring for new keys (e.g. `launch-discipline`, `naming-convention`) — deferred to Phase 8. Bindings registered by key; `ensureSkillFromDir` tolerates missing files.
- OOS-02: Webhook wiring — cron + manual dispatch only.
- OOS-03: `attribution-reconciler` — deferred to Phase 8.
- OOS-04: Inngest scheduler — deferred to Phase 7.

## Notes for the operator

- Apply migrations if not already current (Phase 6 adds no new migrations).
- `DATABASE_URL=... pnpm seed:phase-3` against the Acqu tenant.
- Before any client ad launch path runs end-to-end, verify in the registry that `ad-claim-compliance` has `enabled=true` AND `autonomy=propose` (Phase 5 baseline).
