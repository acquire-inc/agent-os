// router/router.test.ts — Model Router unit tests.
//
// Locks the four-level precedence:
//   1. T-critical exemption (Open Q #1 RESOLVED) — pins to Opus, ignores
//      overrides entirely.
//   2. spec.model explicit (eval-promotion lever) — wins on non-T-critical.
//   3. tenants.tier_overrides[tier] — per-tenant operator override.
//   4. DEFAULT_TIER_MODELS[tier].primary — global doctrine default.
//
// Run: pnpm --filter @agent-os/core run test:router

import {
  DEFAULT_TIER_MODELS,
  MODEL_TIERS,
  isModelTier,
  resolveModel,
  tierFromLegacyModel,
  TierResolutionError,
} from "./index.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function assertThrows(fn: () => unknown, match: string, msg: string) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${msg} — expected throw, returned`);
  } catch (e) {
    if ((e as Error).message.includes(match)) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg} — wrong error: ${(e as Error).message}`);
    }
  }
}

async function main() {
  console.log("• Closed tier set + type guard");
  assert(MODEL_TIERS.length === 5, `5 tiers (got ${MODEL_TIERS.length})`);
  assert(isModelTier("T-critical"), "isModelTier accepts T-critical");
  assert(!isModelTier("T-bogus"), "isModelTier rejects T-bogus");

  console.log("• tierFromLegacyModel backfill heuristic");
  assert(tierFromLegacyModel("anthropic/claude-opus-4.8") === "T-critical", "opus → T-critical");
  assert(tierFromLegacyModel("anthropic/claude-sonnet-4.6") === "T-work", "sonnet → T-work");
  assert(tierFromLegacyModel("anthropic/claude-haiku-4-5") === "T-work", "haiku → T-work");
  assert(tierFromLegacyModel("nousresearch/hermes-4-405b") === "T-reason", "hermes-405b → T-reason");
  assert(tierFromLegacyModel("nousresearch/hermes-4-70b") === "T-cheap", "hermes-70b → T-cheap");
  assert(tierFromLegacyModel("nousresearch/hermes-2-pro-llama-3-8b") === "T-trivial", "hermes-2pro → T-trivial");
  assert(tierFromLegacyModel("some/unknown-model-v2") === "T-work", "unknown → T-work (safe default)");

  console.log("• Precedence #1 — T-critical exemption pins to Opus, ignores all overrides");
  const opus = DEFAULT_TIER_MODELS["T-critical"].primary;
  // Even with a tenant override AND an explicit spec.model that says Hermes,
  // T-critical resolves to Opus.
  const critResolution = resolveModel({
    agentKey: "tenant-isolation-tester",
    isCantFail: true,
    modelTier: "T-critical",
    specModel: "nousresearch/hermes-4-405b", // attempted override — must be ignored
    tenantOverrides: { "T-critical": "nousresearch/hermes-4-405b" }, // attempted override — must be ignored
  });
  assert(critResolution.model === opus, `T-critical pinned to ${opus} (got ${critResolution.model})`);
  assert(critResolution.tier === "T-critical", "tier reported as T-critical");
  assert(critResolution.reason.includes("Open Q #1"), "reason cites Open Q #1");

  console.log("• Precedence #2 — explicit spec.model wins on non-T-critical");
  const explicit = resolveModel({
    agentKey: "vitals",
    isCantFail: false,
    modelTier: "T-cheap",
    specModel: "deepseek/deepseek-v3", // eval-promotion lever
    tenantOverrides: { "T-cheap": "openai/gpt-5" },
  });
  assert(explicit.model === "deepseek/deepseek-v3", `spec.model wins (got ${explicit.model})`);
  assert(explicit.reason.includes("spec.model"), "reason cites spec.model");

  console.log("• Precedence #3 — tenant tier_overrides[tier] wins over default");
  const tenantOverride = resolveModel({
    agentKey: "vitals",
    isCantFail: false,
    modelTier: "T-cheap",
    specModel: null,
    tenantOverrides: { "T-cheap": "deepseek/deepseek-v3" },
  });
  assert(tenantOverride.model === "deepseek/deepseek-v3", `tenant override wins (got ${tenantOverride.model})`);
  assert(tenantOverride.reason.includes("tenant tier_overrides[T-cheap]"), "reason cites tenant tier_overrides");

  console.log("• Precedence #4 — global default when no override");
  const defaultResolution = resolveModel({
    agentKey: "vitals",
    isCantFail: false,
    modelTier: "T-cheap",
    specModel: null,
    tenantOverrides: null,
  });
  assert(
    defaultResolution.model === DEFAULT_TIER_MODELS["T-cheap"].primary,
    `default tier-models[T-cheap].primary (got ${defaultResolution.model})`,
  );
  assert(defaultResolution.reason.includes("DEFAULT_TIER_MODELS"), "reason cites DEFAULT_TIER_MODELS");

  console.log("• Empty tenantOverrides object falls through to default");
  const emptyOverrides = resolveModel({
    agentKey: "vitals",
    isCantFail: false,
    modelTier: "T-cheap",
    specModel: null,
    tenantOverrides: {},
  });
  assert(
    emptyOverrides.model === DEFAULT_TIER_MODELS["T-cheap"].primary,
    "empty {} overrides → default",
  );

  console.log("• T-critical fallback chain is EMPTY (fail closed by design)");
  assert(
    DEFAULT_TIER_MODELS["T-critical"].fallback.length === 0,
    "T-critical has no fallback (Opus or fail-closed; Open Q #1)",
  );

  console.log("• T-cheap volume default IS hermes-4-70b (operator's intent for the fleet)");
  assert(
    DEFAULT_TIER_MODELS["T-cheap"].primary === "nousresearch/hermes-4-70b",
    "T-cheap.primary = hermes-4-70b",
  );

  console.log("• T-reason workhorse IS hermes-4-405b (operator's reasoning default)");
  assert(
    DEFAULT_TIER_MODELS["T-reason"].primary === "nousresearch/hermes-4-405b",
    "T-reason.primary = hermes-4-405b",
  );

  console.log("• Resolution error — neither modelTier nor specModel set");
  assertThrows(
    () => resolveModel({
      agentKey: "broken",
      isCantFail: false,
      modelTier: null,
      specModel: null,
    }),
    "neither modelTier nor specModel",
    "throws when spec is incomplete",
  );

  console.log("• Resolution error — invalid modelTier string");
  assertThrows(
    () => resolveModel({
      agentKey: "broken",
      isCantFail: false,
      modelTier: "T-bogus" as never,
      specModel: null,
    }),
    "invalid modelTier",
    "throws on invalid tier",
  );

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
