# Feature Flags — Kill Switches

**Audience:** the operator. These env vars let you bring up the platform
with one or more V2 self-improvement loops DISABLED without rebuilding or
touching the DB.

> Safe defaults: every flag defaults to **ENABLED** when the env var is
> absent. You have to explicitly type the kill to disable.

## The flags

| Env var | Default | What it kills |
|---|---|---|
| `AOS_FEATURE_MEMORY_LOOP_DISABLED` | enabled | `lifecycle.writeRunMemory` — agents stop writing episodes; next runs won't see prior learnings. |
| `AOS_FEATURE_REFLEXION_DISABLED` | enabled | `runReflexion` returns null — runs with `objective_id` don't auto-retry. |
| `AOS_FEATURE_SELF_IMPROVEMENT_DISABLED` | enabled | `runSelfImprovement` skips — no new entries in `agent_improvement_proposals`. |
| `AOS_FEATURE_CRITIC_QUORUM_DISABLED` | enabled | `runCriticReview` returns a "disabled" eligibility — every proposal stays in the human inbox. |
| `AOS_FEATURE_LEASE_DISABLED` | enabled | `acquireLeaseForToolCall` reserved for future short-circuit — the runner-side wrapper proceeds without sequencing. |
| `AOS_FEATURE_CIRCUIT_BREAKER_DISABLED` | enabled | Reserved — `runCircuitBreaker` wiring will honor this. |

## How to set them

Set the env var to `"1"` to disable. Any other value (including empty
string, `"0"`, `"false"`) leaves the feature ENABLED:

```bash
# Disable critic quorum at boot — all proposals go to humans
export AOS_FEATURE_CRITIC_QUORUM_DISABLED=1

# Disable two loops
export AOS_FEATURE_REFLEXION_DISABLED=1
export AOS_FEATURE_SELF_IMPROVEMENT_DISABLED=1

# Re-enable: remove the env var or set to anything that isn't "1"
unset AOS_FEATURE_REFLEXION_DISABLED
```

Then restart the process (memoized at boot — flipping mid-run is
deliberately not supported; that produces inconsistent state across
in-flight work).

## Verifying a flag took effect

```ts
import { featureFlagsSnapshot } from "@agent-os/core";
console.log(featureFlagsSnapshot());
// { MEMORY_LOOP: "enabled", REFLEXION: "disabled", ... }
```

## What flags do NOT touch

These are platform invariants, not features. There is no kill switch:

- T-critical cant-fail floor (always Opus, always fail-closed)
- CRA blocklist (always refused, no per-tenant override)
- Prompt-injection guard (always scrubs)
- Budget reserve/commit/release
- Tenant monthly cost cap
- RLS isolation

You cannot disable safety. By design.

## When to use them

- **Bringing up the platform fresh** and want to confirm baseline
  dispatch + runner work before turning on the self-improvement loops.
- **Diagnosing a regression** — narrowing which loop is misbehaving by
  disabling and re-enabling one at a time.
- **Cost concern** — `SELF_IMPROVEMENT` runs on the scorecard cadence and
  uses an LLM reflector; disabling shaves that cost while leaving memory
  + reflexion intact.
- **Critic peer-approval rollout** — bring up the platform with
  `CRITIC_QUORUM_DISABLED=1` for the first week so every proposal is
  human-reviewed, then flip it on once you trust the trusted-agent
  scorecard floor.

## When NOT to use them

- Don't permanently leave a loop disabled. The flags are intended for
  bring-up and incident response, not as a long-term feature toggle. If a
  loop is permanently disabled for a tenant, that's a doctrine question
  (move it to the Acqu layer or remove it from the platform).
