// Pure unit tests for tenant config JSONB validation (I-001).
// Run: pnpm --filter @agent-os/core test:tenant-config
import {
  OVERRIDABLE_TIERS,
  validateScorecardThresholds,
  validateTenantConfig,
  validateTierOverrides,
} from "./tenant-config.js";

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
  console.log("\n[validateTierOverrides — accepts]");
  {
    const r = validateTierOverrides(null);
    assert(r.ok && Object.keys(r.value!).length === 0, "null → empty map");
  }
  {
    const r = validateTierOverrides({});
    assert(r.ok, "empty object accepted");
  }
  {
    const r = validateTierOverrides({ "T-cheap": "deepseek/deepseek-v3", "T-reason": "nousresearch/hermes-4-405b" });
    assert(r.ok, "valid overrides accepted");
    assert(r.value!["T-cheap"] === "deepseek/deepseek-v3", "value passes through");
  }

  console.log("\n[validateTierOverrides — doctrine rejects]");
  {
    const r = validateTierOverrides({ "T-critical": "claude-opus-4.8" });
    assert(!r.ok, "T-critical override rejected (tier wins, override loses)");
    assert(r.reasons[0]!.includes("T-critical"), "rejection names the doctrine");
  }
  {
    const r = validateTierOverrides({ "T-mystery": "x/y" });
    assert(!r.ok && r.reasons[0]!.includes("unknown tier"), "unknown tier rejected with helpful message");
  }
  {
    const r = validateTierOverrides({ "T-cheap": 42 });
    assert(!r.ok && r.reasons[0]!.includes("must be a string"), "non-string slug rejected");
  }
  {
    const r = validateTierOverrides({ "T-cheap": "" });
    assert(!r.ok && r.reasons[0]!.includes("cannot be empty"), "empty slug rejected (use omit to clear)");
  }
  {
    const r = validateTierOverrides({ "T-cheap": "not a real slug" });
    assert(!r.ok && r.reasons[0]!.includes("not a valid model slug"), "non-provider/model slug rejected");
  }
  {
    const r = validateTierOverrides("not-an-object");
    assert(!r.ok, "scalar rejected as not-an-object");
  }
  {
    const r = validateTierOverrides([1, 2, 3]);
    assert(!r.ok, "array rejected as not-an-object");
  }
  {
    // Partial validity: T-critical rejected AND T-cheap valid — overall fail
    // with the reason for the bad key.
    const r = validateTierOverrides({ "T-critical": "x/y", "T-cheap": "deepseek/v3" });
    assert(!r.ok, "any invalid key causes the whole patch to fail");
  }

  console.log("\n[OVERRIDABLE_TIERS — derived from MODEL_TIERS, excludes T-critical]");
  {
    assert(!OVERRIDABLE_TIERS.includes("T-critical" as unknown as never), "T-critical NOT in overridable list");
    assert(OVERRIDABLE_TIERS.includes("T-cheap"), "T-cheap is overridable");
  }

  console.log("\n[validateScorecardThresholds — accepts]");
  {
    const r = validateScorecardThresholds({});
    assert(r.ok, "empty object accepted (use defaults)");
  }
  {
    const r = validateScorecardThresholds({
      minSampleSize: 30,
      minApprovalRateForPromote: 0.95,
      maxCostUtilization: 1.2,
      maxCostUtilizationForPromote: 0.8,
    });
    assert(r.ok, "valid partial threshold patch accepted");
    assert(r.value!.minSampleSize === 30, "value passes through");
  }

  console.log("\n[validateScorecardThresholds — rejects out-of-range + bad types]");
  {
    const r = validateScorecardThresholds({ minSampleSize: 0 });
    assert(!r.ok && r.reasons[0]!.includes("outside"), "minSampleSize=0 below minimum (1)");
  }
  {
    const r = validateScorecardThresholds({ minSampleSize: 1.5 });
    assert(!r.ok && r.reasons[0]!.includes("integer"), "non-integer count rejected");
  }
  {
    const r = validateScorecardThresholds({ minApprovalRateForPromote: 1.5 });
    assert(!r.ok && r.reasons[0]!.includes("outside"), "rate above 1 rejected");
  }
  {
    const r = validateScorecardThresholds({ minApprovalRateForPromote: -0.1 });
    assert(!r.ok && r.reasons[0]!.includes("outside"), "negative rate rejected");
  }
  {
    const r = validateScorecardThresholds({ minApprovalRateForPromote: "0.9" });
    assert(!r.ok && r.reasons[0]!.includes("finite number"), "string-encoded number rejected");
  }
  {
    const r = validateScorecardThresholds({ minApprovalRateForPromote: NaN });
    assert(!r.ok && r.reasons[0]!.includes("finite"), "NaN rejected");
  }
  {
    const r = validateScorecardThresholds({ unknownKey: 1 });
    assert(!r.ok && r.reasons[0]!.includes("unknown threshold"), "unknown key rejected");
  }

  console.log("\n[validateScorecardThresholds — pairwise consistency]");
  {
    // minVerificationRateForPromote must be >= minVerificationRate.
    const r = validateScorecardThresholds({ minVerificationRate: 0.8, minVerificationRateForPromote: 0.7 });
    assert(!r.ok && r.reasons[0]!.includes("pairing"), "promote-threshold below floor rejected");
  }
  {
    // Equal is fine.
    const r = validateScorecardThresholds({ minVerificationRate: 0.8, minVerificationRateForPromote: 0.8 });
    assert(r.ok, "equal pair accepted");
  }
  {
    // maxCostUtilizationForPromote must be <= maxCostUtilization (promote
    // requires being UNDER a stricter ceiling than the demote floor).
    const r = validateScorecardThresholds({ maxCostUtilization: 1.0, maxCostUtilizationForPromote: 1.2 });
    assert(!r.ok && r.reasons[0]!.includes("pairing"), "promote ceiling above demote ceiling rejected");
  }

  console.log("\n[validateTenantConfig — combined patch]");
  {
    const r = validateTenantConfig({
      tierOverrides: { "T-cheap": "deepseek/v3" },
      scorecardThresholds: { minSampleSize: 30 },
    });
    assert(r.ok, "valid combined patch accepted");
    assert(r.tierOverrides!["T-cheap"] === "deepseek/v3", "narrowed tierOverrides exposed");
    assert(r.scorecardThresholds!.minSampleSize === 30, "narrowed scorecardThresholds exposed");
  }
  {
    const r = validateTenantConfig({
      tierOverrides: { "T-critical": "x/y" },
      scorecardThresholds: { minSampleSize: 30 },
    });
    assert(!r.ok, "mixed valid + invalid → overall fail");
    assert(r.reasons.some((m) => m.startsWith("tier_overrides:")), "reasons are knob-prefixed");
    assert(r.scorecardThresholds!.minSampleSize === 30, "narrowed value still exposed for the valid knob");
  }
  {
    const r = validateTenantConfig({});
    assert(r.ok, "empty patch is a no-op (ok)");
    assert(r.tierOverrides === undefined, "no key → narrowed value absent");
  }
  {
    // Knob not in patch → not validated, not narrowed.
    const r = validateTenantConfig({ tierOverrides: { "T-cheap": "x/y" } });
    assert(r.ok, "single-knob patch accepted");
    assert(r.scorecardThresholds === undefined, "untouched knob stays absent");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
