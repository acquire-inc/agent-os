// Pure tests for feature-flag env-var kill switches.
// Run: pnpm --filter @agent-os/core test:feature-flags
import {
  FEATURE_FLAGS,
  featureFlagsSnapshot,
  isFeatureDisabled,
  isFeatureEnabled,
  __resetFeatureFlagsForTest,
} from "./feature-flags.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  console.log("\n[default = enabled when env unset]");
  for (const f of FEATURE_FLAGS) {
    delete process.env[`AOS_FEATURE_${f}_DISABLED`];
  }
  __resetFeatureFlagsForTest();
  for (const f of FEATURE_FLAGS) {
    assert(isFeatureEnabled(f), `${f} defaults enabled`);
    assert(!isFeatureDisabled(f), `${f} not disabled by default`);
  }

  console.log("\n[disabled when env = '1']");
  __resetFeatureFlagsForTest();
  process.env.AOS_FEATURE_REFLEXION_DISABLED = "1";
  assert(isFeatureDisabled("REFLEXION"), "REFLEXION disabled when env='1'");
  assert(!isFeatureEnabled("REFLEXION"), "REFLEXION not enabled when env='1'");
  delete process.env.AOS_FEATURE_REFLEXION_DISABLED;

  console.log("\n[non-'1' values do NOT disable — safe default is loops ON]");
  __resetFeatureFlagsForTest();
  for (const v of ["", "0", "false", "true", "no", "yes"]) {
    process.env.AOS_FEATURE_CRITIC_QUORUM_DISABLED = v;
    __resetFeatureFlagsForTest();
    assert(isFeatureEnabled("CRITIC_QUORUM"), `'${v}' keeps CRITIC_QUORUM enabled (safe default)`);
  }
  delete process.env.AOS_FEATURE_CRITIC_QUORUM_DISABLED;

  console.log("\n[memoization — env change after first read does NOT flip]");
  __resetFeatureFlagsForTest();
  delete process.env.AOS_FEATURE_LEASE_DISABLED;
  assert(isFeatureEnabled("LEASE"), "first read: enabled");
  process.env.AOS_FEATURE_LEASE_DISABLED = "1";
  assert(isFeatureEnabled("LEASE"), "subsequent read sees memoized value — restart required to flip");
  delete process.env.AOS_FEATURE_LEASE_DISABLED;
  __resetFeatureFlagsForTest();

  console.log("\n[snapshot]");
  for (const f of FEATURE_FLAGS) delete process.env[`AOS_FEATURE_${f}_DISABLED`];
  __resetFeatureFlagsForTest();
  const allOn = featureFlagsSnapshot();
  assert(Object.values(allOn).every((s) => s === "enabled"), "default snapshot: all enabled");
  assert(Object.keys(allOn).length === FEATURE_FLAGS.length, "snapshot has every flag");

  process.env.AOS_FEATURE_MEMORY_LOOP_DISABLED = "1";
  process.env.AOS_FEATURE_SELF_IMPROVEMENT_DISABLED = "1";
  __resetFeatureFlagsForTest();
  const mixed = featureFlagsSnapshot();
  assert(mixed.MEMORY_LOOP === "disabled" && mixed.SELF_IMPROVEMENT === "disabled", "snapshot reflects two disabled");
  assert(mixed.REFLEXION === "enabled" && mixed.CIRCUIT_BREAKER === "enabled", "untouched flags stay enabled");

  // Cleanup so other tests in the same process aren't surprised.
  for (const f of FEATURE_FLAGS) delete process.env[`AOS_FEATURE_${f}_DISABLED`];
  __resetFeatureFlagsForTest();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
