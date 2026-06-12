# Internal Launch Runbook

**Audience:** the human/operator bringing AgentOS up for internal use at our
team. Read this top-to-bottom before the first launch; come back to it for
the operator-gated steps.

> The OFFLINE platform is launch-ready when `pnpm launch:check` returns
> `READY ✓`. This runbook covers the steps from "ready" to "live."

## Pre-flight (offline — verify before anything else)

```bash
# From the repo root:
pnpm install
pnpm launch:check
```

Expected: `Launch Readiness: READY ✓` with all 22 checks green.
If any check fails, fix it FIRST. The script is the contract.

What "READY" means:
- 17 offline test suites pass (700+ assertions)
- Workspace typecheck clean across all 15 projects
- 29 migrations authored in monotonic order
- 40 relay event names registered, lowercase-dotted, unique, append-only
- 14 cant-fail keys pinned (no drift)
- 9 doctrine docs present

What "READY" does NOT mean:
- The live DB is up (operator gates below).
- External tenants can register (that's the EXTERNAL launch — separate hard gate).

## Operator-gated launch steps

### Step 1 — Bring up the database

1. Provision a Postgres 16 + pgvector instance via Supabase.
2. Set `DATABASE_URL` and `SUPABASE_*` env vars in your runner / API
   environment.
3. Push migrations:
   ```bash
   supabase db push           # applies 0001–0029
   ```
   Migrations 0001–0013 ship from the initial setup. Migrations 0014–0029
   are the platform hardening cycle (Phases 14–34 + V2 P3/P4/P6 + I-003)
   and were authored + typecheck-verified in this branch.
4. Confirm the bare-minimum tables exist:
   ```sql
   SELECT count(*) FROM agents;
   SELECT count(*) FROM agent_leases;       -- I-003
   SELECT count(*) FROM objectives;         -- V2 P3
   SELECT count(*) FROM agent_improvement_proposals; -- V2 P4
   SELECT count(*) FROM critic_votes;       -- V2 P6
   ```
   (Empty is fine — they're populated as runs land.)

### Step 2 — Run the LIVE isolation suite (hard gate #2)

This is the platform's one non-negotiable launch oracle for multi-tenant
safety. Until this passes against the live DB, NO EXTERNAL TENANT may
register. Internal tenant #1 (Acqu) can proceed under operator
acceptance of the risk, but the gate must pass before external go-live.

```bash
DATABASE_URL=… pnpm verify:isolation-live
```

Expected: every attack vector in `packages/tool-rls-test` returns zero
rows for the wrong-tenant viewer. Any non-zero is a stop-everything
finding.

### Step 3 — Run the live integration test

```bash
DATABASE_URL=… pnpm --filter @agent-os/core test
```

This is the LIVE twin of `pnpm --filter @agent-os/core test:dispatch-contract`
(which the launch check already ran offline). The live test exercises the
same contract against real Postgres for end-to-end confidence.

### Step 4 — Seed tenant #1 (Acqu) and the doctrine agents

```bash
pnpm seed:acqu-vitals
pnpm seed:phase-1
pnpm seed:phase-2
pnpm seed:phase-3
pnpm seed:phase-4
pnpm seed:phase-9
pnpm seed:tool-browser
```

Watch for `architect.refused` events — the seed scripts respect the CRA
blocklist. If a seed prints an unexpected refusal, the seed script needs
the prompt edited (NOT the blocklist).

### Step 5 — Bring up the runners + scheduler

1. Start the API:
   ```bash
   pnpm --filter @agent-os/api start
   ```
2. Start the scheduler (Inngest):
   - Set `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` in env.
   - Verify the `/api/inngest` mount is reachable from the Inngest dev
     server or production environment.
3. Start a runner against the API.
4. Watch the relay stream for `lifecycle.changed` events — that's the
   "agents woke up" signal.

### Step 6 — Bring up the control plane (UI)

```bash
pnpm dev                       # control-plane dev server
```

Or build + deploy:
```bash
pnpm --filter control-plane build
# serve dist/ from any static host
```

Settings → Models tab: optional, set per-tier overrides for your tenant.
Settings → Organization tab: set the monthly budget cap.

### Step 7 — Verify the loops are alive

Watch the relay stream (or the Fleet Activity tab) for:
- `model.routed` on every model resolution
- `budget.reserved` / `budget.committed` per run
- `objective.reflexion_decided` when a run with an `objective_id` finishes
- `improvement.proposed` after the scorecard cadence

If you see `cantfail.*` events, **read them immediately** — they only fire
on safety violations.

## Internal-launch checklist (for the human in the chair)

- [ ] `pnpm launch:check` returns READY ✓
- [ ] Live isolation suite passes (Step 2)
- [ ] Live integration test passes (Step 3)
- [ ] Tenant #1 (Acqu) seeded; agent count matches doctrine
- [ ] Runner + scheduler reach the API
- [ ] Control plane reachable; tenant monthly budget set
- [ ] Relay stream shows `model.routed` on a test run
- [ ] Approvals inbox surfaces a test proposal correctly
- [ ] Read `docs/agent-coordination-guidelines.md` and applied the
      "don't overlap" checklist to the seeded fleet
- [ ] Designated an on-call who reads `cantfail.*` events when they fire

When all 10 boxes are checked, internal launch is complete. The team can use
AgentOS.

## What's NOT in this runbook (deliberate — comes later)

- **External tenant onboarding** — requires hard gate #2 (live isolation) PASS
  AND Nango connector OAuth (doctrine §2.4) wired AND `dunning-manager`
  shipped (hard gate #3, recurring billing). Track in ROADMAP.md.
- **V2 P7 A2A handoff chains** — operator coordinates manually for now;
  `objective.reflexion_decided` is the carryover signal.
- **V2 P8 autonomous manager** — operator does spawn/pause/retire via the
  control plane today.
- **V2 P10 auto-onboarding (Viktor flow)** — manual seed scripts today.

## Day-2 operations

- Re-run `pnpm launch:check` after every batch of platform changes.
- Watch `cantfail.*` events. They mean something failed an invariant.
- Watch `anomaly.circuit_tripped` — that's the breaker pulling an agent
  back to `propose` after a failure streak. Investigate.
- Watch `agent.lease_decided` `kind=conflict` — high conflict rates on
  one target mean the fleet is poorly partitioned. Re-read
  `docs/agent-coordination-guidelines.md`.

## Emergency stops

- **Pause an agent** — Control plane → agent drawer → "Paused" toggle.
- **Pause a tenant** — `UPDATE tenants SET status = 'suspended' WHERE id = ?`
- **Cap a tenant** — `UPDATE tenants SET monthly_budget_usd = 0 WHERE id = ?`
  The chat-dispatch gate refuses new work; in-flight runs finish.
- **Force-demote an agent to propose** — `UPDATE agents SET autonomy = 'propose' WHERE key = ?`
  All future runs require human approval. The circuit-breaker also does
  this automatically on streaks.
