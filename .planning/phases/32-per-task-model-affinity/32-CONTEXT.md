# Phase 32 — Per-task model affinity (no model dependency)

**Triggered by:** Operator request — "model fork no model dependency which allows us to deploy optimal models for specific tasks that they do best rather than only using one for when we spin up agents through agent os."
**Status:** complete (executed inline)
**Type:** runtime / Model Router extension

## Goal

Let the Model Router fork to a different model on a per-skill or per-tool basis. An agent's primary model is set at seed time; when the agent invokes a specific skill or tool, the runtime can switch to the best model for that sub-task. T-critical safety floors still win — can't-fail agents always run Opus regardless of preference.

## Delivered

### Migration

- `supabase/migrations/0019_per_task_model_affinity.sql`:
  - `skills.preferred_model_tier` TEXT with CHECK constraint
  - `tools.preferred_model_tier` TEXT with CHECK constraint
  - Seed values for canonical skills (e.g. `briefing-synthesis` → T-reason, `morning-vitals` → T-cheap, `creative-generation` → T-work)
  - Seed values for existing tools (`tool.browser` → T-reason, `tool.rls-test` → T-cheap)

### Schema

- `packages/db/src/schema.ts` — `skills.preferredModelTier` + `tools.preferredModelTier`
- `packages/core/src/bundle.ts` — bundle carries `skills[].preferredModelTier` and `tools[].preferredModelTier` through to the runner
- `apps/runner/src/api-client.ts` — wire shape mirrors

### Router

- `packages/core/src/router/resolve.ts` — new `pickModelForTask(args)`:
  - Baseline = `resolveModel(args)` (existing 4-level precedence)
  - **Safety floor #1:** T-critical agents IGNORE the preference; return baseline
  - **Safety floor #2:** non-T-critical agents CANNOT fork TO T-critical — throws `TierResolutionError` (perimeter protection against Opus impersonation)
  - No preference set → baseline returned
  - Same-tier preference → baseline returned (no fork)
  - Different tier → re-resolves at the new tier (with tenant `tier_overrides` applied)
  - Returns a `task-fork: <oldTier> → <newTier> for <taskLabel>` reason for the audit trail
- Exported from `@agent-os/core` via `router/index.ts`

### Runtime

- `apps/runner/src/custom-tools.ts` — `dispatchCustomTool` now consults `bound.preferredModelTier`. If the tool prefers a different tier (and the agent isn't can't-fail), the runner:
  - Computes the fork via `pickModelForTask`
  - Emits a `model.routed` Relay event with `{ agent_model, forked_to, forked_tier, task_label, reason }`
  - Logs but does not block on fork-resolution errors

  The actual SDK session model is NOT swapped today (that's a sub-agent dispatch boundary the SDK doesn't yet expose cleanly). The `model.routed` event is the audit + signal so a future sub-agent orchestrator can act on it.

### Tests

`packages/core/src/router/router.test.ts` adds 11 Phase 32 assertions:
- No preference → baseline T-cheap
- Same-tier preference → no fork (baseline reason)
- T-cheap → T-reason fork with proper reason
- Fork tier reflected in result.tier
- Reason names the fork + task label
- T-critical agent ignores preference (safety floor)
- T-critical tier preserved through forced no-op
- Non-T-critical → T-critical fork throws (perimeter)
- Tenant override applies on forked tier (e.g. T-reason → `openai/gpt-4o`)
- Reason names the tenant override

## Scope

WRITE: `supabase/migrations/0019_per_task_model_affinity.sql`, `packages/db/src/schema.ts`, `packages/core/src/bundle.ts`, `packages/core/src/router/resolve.ts`, `packages/core/src/router/index.ts`, `packages/core/src/router/router.test.ts`, `apps/runner/src/api-client.ts`, `apps/runner/src/custom-tools.ts`, `apps/runner/src/custom-tools.test.ts`

NOT touched: T-critical seeds, CANT_FAIL_KEYS, CLAUDE.md model tier table, runner liveRun/dryRun model dispatch

## Acceptance ✓

- `test:router` → 36 passed (was 25; +11 Phase 32)
- All 17 core suites + 5 runner suites still green
- Typecheck clean across core / db / runner / api / inngest

## Operator gate

`supabase db push` for migration 0019. Default seeds activate immediately on push.

## Out of scope (next phases)

- **Sub-agent SDK dispatch** that actually re-targets the SDK session to the forked model mid-run. Today we emit the audit signal; tomorrow the orchestrator acts on it via Claude Agent SDK's sub-agent API
- **Per-skill** model.routed emission at run start (requires identifying the agent's "primary" skill if it has one — currently any preferred-tier skill bound to the agent could fork)
- **Cost-aware fork** — read `models.cost_per_token` (a future column) and refuse a fork that breaches the agent's budget cap
- **Operator dashboard** showing fork frequency + cost delta per agent
