// router/index.ts — Model Router public surface.

export {
  MODEL_TIERS,
  DEFAULT_TIER_MODELS,
  T_CRITICAL_ALLOWLIST,
  isModelTier,
  tierFromLegacyModel,
  type ModelTier,
  type TierFuel,
} from "./tier-models.js";

export {
  resolveModel,
  pickModelForTask,
  TierResolutionError,
  type ResolveModelArgs,
  type ResolveModelResult,
  type PickModelForTaskArgs,
} from "./resolve.js";
