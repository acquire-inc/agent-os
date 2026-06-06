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

export {
  pickBestModel,
  scoreCandidate,
  filterCandidates,
  type CapabilityKey,
  type CostSensitivity,
  type TaskProfile,
  type ModelCatalogEntry,
  type ScoredCandidate,
  type PickBestModelOptions,
  type PickResult,
} from "./intelligence.js";

export {
  pickModelIntelligently,
  type IntelligentPickArgs,
  type IntelligentPickResult,
} from "./intelligent-pick.js";

export {
  aggregateModelObservations,
  deriveOutcomeScore,
  type ModelRunObservation,
  type ProposedScoreUpdate,
} from "./model-feedback.js";
