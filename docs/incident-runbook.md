# Incident Response Runbook

**Audience:** the on-call operator. When something goes wrong, this is the
page to open first.

> Pair: this doc + `docs/internal-launch-runbook.md` (for launch
> procedures) + `SECURITY.md` (for threat-model reference).

## Triage: what does the symptom look like?

| Symptom | First action | Then |
|---|---|---|
| Health page shows red bar (cant-fail events > 0) | Read relay events `cantfail.*` for the tenant | [§ Cant-fail violation](#cantfail-violation) |
| Approvals piling up | Check whether critic quorum is disabled in feature flags | [§ Approvals not auto-decided](#approvals-not-auto-decided) |
| One agent burning budget | Look at /health Active Leases + agent's MTD spend | [§ Budget-hog agent](#budget-hog-agent) |
| Runner not picking up work | Verify pnpm launch:check is READY; check runner logs | [§ Runner silent](#runner-silent) |
| Tenant getting cross-tenant data | STOP all runs immediately | [§ Tenant isolation breach](#tenant-isolation-breach) — **Sev-1** |
| `pnpm launch:check` returns RED | Read which check failed | [§ Launch oracle red](#launch-oracle-red) |

## Cant-fail violation

A `cantfail.*` event means a safety invariant was nearly violated (or was).
The platform's response is to fail closed; the run is dead but the platform
needs YOU to investigate the cause.

The four variants:
- `cantfail.model_violation` — a T-critical agent was about to run on a
  non-Opus model. Run refused.
- `cantfail.cra_violation` — a manually-authored agent matched the CRA
  blocklist at runtime. Run refused.
- `cantfail.lease_preempt` — a T-critical agent preempted a non-cant-fail
  lease. This is by design — but visibility matters.

Procedure:
1. Query the relay event payload (the `run_id` is the key).
2. Confirm the agent's `agents.key` is on the cant-fail list (it should be).
3. Check `agents.model` — if it's not `claude-opus-4.8`, the seed is
   corrupted. Restore from the doctrine seed.
4. For CRA: read the seed prompt or hydrate context. If it really is CRA
   territory, the agent should NOT exist. Delete it.
5. For lease preempt: confirm the preempted run wasn't doing safety-critical
   work itself (it shouldn't be — non-cant-fail preempted).
6. File a post-mortem in #security with the run_id and resolution.

**Do not** disable the cant-fail guards. They are invariants.

## Approvals not auto-decided

Critic peer-approval quorum is supposed to auto-decide low-stakes
proposals. If they're piling up:

1. /health page → Feature flags. If `CRITIC_QUORUM: disabled`, an env var
   is shutting it off. Restart with `AOS_FEATURE_CRITIC_QUORUM_DISABLED`
   unset (or any value != `"1"`).
2. If enabled but proposals still queue: check that the proposal carries
   an `estimated_cost_usd` in payload. Unknown stake is human-only by
   design (see `decideManagerAction`). Operator may need to lift the
   stake cap policy or wire the cost estimate.
3. Check that there are enough QUALIFIED critics on the tenant: scorecard
   success rate ≥ 90% AND ≥ 20 trailing runs. New tenants will need to
   accumulate before quorum is achievable.

## Budget-hog agent

One agent is consuming an outsized share of the tenant budget.

1. Agents tab → sort by MTD spend descending. Confirm the agent.
2. Open the agent's drawer → Config tab. Tighten the per-run budget cap.
3. If the manager loop is enabled, an automatic pause proposal may already
   exist. Proposals tab → review and apply if warranted.
4. If urgent: pause the agent manually via the Active/Paused toggle.
5. Watch the relay for `budget.cap_breached` events. Each one is a run
   that hit a cap.

## Runner silent

The runner appears idle even though there's scheduled work:

1. `pnpm launch:check` — must be READY ✓.
2. Check the API health endpoint: `curl <BASE>/health`.
3. `pnpm smoke` against the live API.
4. Verify runner env: `RUNNER_API_KEY`, `RUNNER_AGENT_IDS`, `ANTHROPIC_API_KEY`.
5. Confirm the runner can reach the API host.
6. Check `runs.status = 'scheduled'` rows exist for the agents.
7. Look at runner logs for the SessionStart guard rejections — a
   `cantfail.*` will refuse to dispatch.

## Tenant isolation breach — **Sev-1**

If you see one tenant's data in another's UI: **stop everything**.

1. **STOP** all runners: `kill` the processes.
2. Disable the affected tenant: `UPDATE tenants SET status = 'suspended'
   WHERE id IN (<both>);`.
3. Run the live isolation suite: `pnpm verify:isolation-live`. Note
   exactly which attack vector failed.
4. Audit recent migrations — was RLS dropped on any table?
5. File Sev-1 in #security with the offending row sample.
6. Do not re-enable tenants until the live isolation suite returns
   zero cross-tenant rows on every vector.

This is the platform's one non-negotiable invariant. There is no
acceptable workaround.

## Launch oracle red

`pnpm launch:check` returns RED. Read which check failed:

- **Test suite failed**: re-run the suite directly with verbose output to
  see the failing assertion. Fix the regression.
- **Workspace typecheck failed**: `pnpm -r typecheck` shows the file +
  line. Fix the type error.
- **Migration ordering**: a migration is out of order. Renumber so the
  sequence is monotonic.
- **Relay registry**: an event name is missing or duplicated. Check
  `packages/core/src/relay/events.ts` — registry is append-only.
- **Cant-fail key count**: someone edited
  `packages/core/src/architect/hydrate.ts` CANT_FAIL_KEYS away from 14.
  Restore. This is doctrine, not config.
- **Doctrine docs missing**: a required doc was removed. Restore from
  git history.

The oracle is the contract. Fix the underlying issue; do not edit the
oracle to pass.

## Emergency stop commands

```bash
# Pause a tenant entirely:
UPDATE tenants SET status = 'suspended' WHERE id = $1;

# Cap a tenant at zero:
UPDATE tenants SET monthly_budget_usd = 0 WHERE id = $1;

# Force an agent to propose-only:
UPDATE agents SET autonomy = 'propose' WHERE key = $1;

# Pause an agent:
UPDATE agents SET enabled = false WHERE key = $1;

# Release every stale lease for an agent (post-crash):
UPDATE agent_leases SET released_at = now()
  WHERE owner_agent_id = $1 AND released_at IS NULL;

# Kill all in-flight runs for an agent (drastic):
UPDATE runs SET status = 'failed', ended_at = now(), summary = 'operator killed'
  WHERE agent_id = $1 AND status IN ('running', 'pending');
```

## Reporting

Post a brief incident summary to #incidents:

```
🚨 Incident · {YYYY-MM-DD} · {tenant_id} · Sev-{1|2|3}
Symptom:  {one line}
Cause:    {one line, after investigation}
Action:   {what you did}
Followup: {what's still pending}
```

Sev-1 (isolation breach, prolonged cant-fail loops, data loss) gets a
post-mortem in `.planning/incidents/{date}-{slug}.md` within 48h.
