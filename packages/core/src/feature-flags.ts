// Feature flags — env-var kill switches for V2 loops.
//
// The V2 self-improving loops (memory, reflexion, self-improvement,
// critic peer-approval, lease arbitration) all default ON when their DB
// migrations are applied. An operator who wants to bring up the platform
// with one or more of these loops DISABLED can flip them off via env
// vars — zero-config kill switches, no DB write, no rebuild.
//
// Convention: AOS_FEATURE_<NAME>_DISABLED = "1" disables the feature.
// Absence (or any other value) leaves it ENABLED. This makes the safe
// default "loops ON" — you have to explicitly type the kill to disable.
//
// Each flag is read ONCE at boot (memoized) so a runtime change requires
// a restart. That's intentional: feature flags that flip mid-run can
// produce inconsistent state across in-flight work.
//
// Where each flag short-circuits:
//   - AOS_FEATURE_MEMORY_LOOP_DISABLED       — lifecycle.writeRunMemory skips
//   - AOS_FEATURE_REFLEXION_DISABLED         — runReflexion exits early no-op
//   - AOS_FEATURE_SELF_IMPROVEMENT_DISABLED  — runSelfImprovement skips
//   - AOS_FEATURE_CRITIC_QUORUM_DISABLED     — runCriticReview escalates everything
//   - AOS_FEATURE_LEASE_DISABLED             — acquireLeaseForToolCall always proceeds
//   - AOS_FEATURE_CIRCUIT_BREAKER_DISABLED   — runCircuitBreaker no-op
//
// Safety: the kill switches do NOT touch cant-fail, CRA, injection guard,
// budget caps, or RLS. Those are platform invariants, not features.

const FLAG_NAMES = [
  "MEMORY_LOOP",
  "REFLEXION",
  "SELF_IMPROVEMENT",
  "CRITIC_QUORUM",
  "LEASE",
  "CIRCUIT_BREAKER",
] as const;

export type FeatureFlag = (typeof FLAG_NAMES)[number];

function readEnv(name: FeatureFlag): boolean {
  // process is the Node.js global; in non-Node consumers (browser),
  // this module is not imported (these flags only apply server-side).
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = proc?.env?.[`AOS_FEATURE_${name}_DISABLED`];
  return v === "1";
}

const memoized: Partial<Record<FeatureFlag, boolean>> = {};

function isDisabledAtBoot(name: FeatureFlag): boolean {
  if (memoized[name] === undefined) memoized[name] = readEnv(name);
  return memoized[name]!;
}

export function isFeatureEnabled(name: FeatureFlag): boolean {
  return !isDisabledAtBoot(name);
}

export function isFeatureDisabled(name: FeatureFlag): boolean {
  return isDisabledAtBoot(name);
}

/** Snapshot of every flag's state — for diagnostics + the launch-readiness
 *  printout. Pure-read, no side effects. */
export function featureFlagsSnapshot(): Record<FeatureFlag, "enabled" | "disabled"> {
  const out = {} as Record<FeatureFlag, "enabled" | "disabled">;
  for (const f of FLAG_NAMES) out[f] = isFeatureEnabled(f) ? "enabled" : "disabled";
  return out;
}

/** Test-only: clear the memoized cache so a single test process can
 *  exercise both branches per flag. Not exported from the package index;
 *  reach in via direct file import from tests. */
export function __resetFeatureFlagsForTest(): void {
  for (const f of FLAG_NAMES) delete memoized[f];
}

export { FLAG_NAMES as FEATURE_FLAGS };
