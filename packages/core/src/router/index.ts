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
  TierResolutionError,
  type ResolveModelArgs,
  type ResolveModelResult,
} from "./resolve.js";
