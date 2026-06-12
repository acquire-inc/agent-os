// Tenant config JSONB shape validation (I-001).
//
// Two policy knobs live in `tenants` as JSONB:
//   - tier_overrides:        per-tier model slug override
//   - scorecard_thresholds:  per-tenant evaluator threshold tuning
//
// Both accept free-form JSON today. A malformed override (typo'd tier name,
// string where a number is expected, an out-of-range threshold) silently
// no-ops or falls through to defaults — the operator never finds out the
// knob didn't take. This module fails loud on bad shapes so the API write
// path refuses garbage and the dashboard surfaces a usable error.
//
// Design choice: hand-rolled validators (no Zod dep — core stays light).
// Each validator returns `{ ok, value?, reasons[] }` so callers can either
// trust the narrowed value or render the rejection. Validators are PURE.
// API routes call them at the write boundary; the existing API already does
// some of these checks ad-hoc (PUT tier-overrides) — this module centralizes
// them so every write path uses the same rules.
//
// Compliance:
//   - T-critical override is ALWAYS rejected here, regardless of any other
//     opt-in. Mirrors the router-side runtime rule. Tier wins.
//   - Out-of-band threshold values (rates outside [0, 1], negative samples)
//     are rejected — the scorecard expects normalized inputs and an invalid
//     threshold would silently swing the autonomy ladder.

import { MODEL_TIERS, type ModelTier } from "./router/index.js";

// --- Shared shape ----------------------------------------------------------

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  reasons: string[];
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value, reasons: [] };
}
function fail<T>(reasons: string[]): ValidationResult<T> {
  return { ok: false, reasons };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

// --- tier_overrides --------------------------------------------------------

export type TierOverrides = Partial<Record<ModelTier, string>>;

/** Tiers tenants may legitimately override. T-critical is permanently
 *  excluded — runtime ignores it; we reject here too. */
export const OVERRIDABLE_TIERS: readonly Exclude<ModelTier, "T-critical">[] = MODEL_TIERS
  .filter((t): t is Exclude<ModelTier, "T-critical"> => t !== "T-critical");

const MODEL_SLUG_RE = /^[a-z0-9][a-z0-9._\-]*\/[a-z0-9][a-z0-9._\-]*$/i;

export function validateTierOverrides(raw: unknown): ValidationResult<TierOverrides> {
  const reasons: string[] = [];
  if (raw === null || raw === undefined) return ok({});
  if (!isPlainObject(raw)) return fail(["tier_overrides must be a JSON object"]);

  const out: TierOverrides = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(MODEL_TIERS as readonly string[]).includes(k)) {
      reasons.push(`unknown tier '${k}' — expected one of ${MODEL_TIERS.join(", ")}`);
      continue;
    }
    // T-critical can never be overridden — tier wins. Reject loudly so the
    // operator sees the doctrine instead of a silent no-op.
    if (k === "T-critical") {
      reasons.push("T-critical is never overridable (doctrine: cant-fail tier wins, override loses)");
      continue;
    }
    if (typeof v !== "string") {
      reasons.push(`tier '${k}': model slug must be a string (got ${typeof v})`);
      continue;
    }
    const slug = v.trim();
    if (slug.length === 0) {
      reasons.push(`tier '${k}': model slug cannot be empty (use null/omit to clear)`);
      continue;
    }
    if (!MODEL_SLUG_RE.test(slug)) {
      reasons.push(`tier '${k}': '${slug}' is not a valid model slug (expected provider/model)`);
      continue;
    }
    out[k as Exclude<ModelTier, "T-critical">] = slug;
  }
  return reasons.length === 0 ? ok(out) : fail(reasons);
}

// --- scorecard_thresholds --------------------------------------------------

export interface ScorecardThresholdOverrides {
  minSampleSize?: number;
  minApprovalRateForPromote?: number;
  minVerificationRate?: number;
  minVerificationRateForPromote?: number;
  maxCostUtilization?: number;
  maxCostUtilizationForPromote?: number;
  maxFindingsRatePerRun?: number;
  maxScopeLockRefusalsPerRun?: number;
  maxOutputQualityFailureRate?: number;
}

interface FieldSpec {
  kind: "rate" | "count" | "ratio";
  /** Rates and ratios live in [0, 1]; counts are integers >= 0. */
  min: number;
  max: number;
  integer: boolean;
}

const SCORECARD_FIELDS: Record<keyof ScorecardThresholdOverrides, FieldSpec> = {
  minSampleSize:                 { kind: "count", min: 1,   max: 100_000, integer: true },
  minApprovalRateForPromote:     { kind: "rate",  min: 0,   max: 1,       integer: false },
  minVerificationRate:           { kind: "rate",  min: 0,   max: 1,       integer: false },
  minVerificationRateForPromote: { kind: "rate",  min: 0,   max: 1,       integer: false },
  maxCostUtilization:            { kind: "ratio", min: 0,   max: 10,      integer: false },
  maxCostUtilizationForPromote:  { kind: "ratio", min: 0,   max: 10,      integer: false },
  maxFindingsRatePerRun:         { kind: "rate",  min: 0,   max: 100,     integer: false },
  maxScopeLockRefusalsPerRun:    { kind: "count", min: 0,   max: 10_000,  integer: true },
  maxOutputQualityFailureRate:   { kind: "rate",  min: 0,   max: 1,       integer: false },
};

export function validateScorecardThresholds(raw: unknown): ValidationResult<ScorecardThresholdOverrides> {
  const reasons: string[] = [];
  if (raw === null || raw === undefined) return ok({});
  if (!isPlainObject(raw)) return fail(["scorecard_thresholds must be a JSON object"]);

  const out: ScorecardThresholdOverrides = {};
  for (const [k, v] of Object.entries(raw)) {
    const spec = SCORECARD_FIELDS[k as keyof ScorecardThresholdOverrides];
    if (!spec) {
      reasons.push(`unknown threshold key '${k}'`);
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      reasons.push(`threshold '${k}': must be a finite number (got ${typeof v})`);
      continue;
    }
    if (spec.integer && !Number.isInteger(v)) {
      reasons.push(`threshold '${k}': must be an integer (got ${v})`);
      continue;
    }
    if (v < spec.min || v > spec.max) {
      reasons.push(`threshold '${k}': ${v} outside [${spec.min}, ${spec.max}]`);
      continue;
    }
    // Logical pairings: the "for promote" threshold must be at least as
    // strict as the floor. Otherwise the autonomy ladder can promote on
    // numbers it wouldn't even hold on.
    out[k as keyof ScorecardThresholdOverrides] = v;
  }

  // Pairwise consistency. Only check when both keys are present in the patch.
  const m = out;
  if (m.minApprovalRateForPromote !== undefined && m.minVerificationRate !== undefined) {
    // (these aren't directly comparable — skip)
  }
  if (
    m.minVerificationRateForPromote !== undefined &&
    m.minVerificationRate !== undefined &&
    m.minVerificationRateForPromote < m.minVerificationRate
  ) {
    reasons.push(
      `threshold pairing: minVerificationRateForPromote (${m.minVerificationRateForPromote}) ` +
        `must be >= minVerificationRate (${m.minVerificationRate})`,
    );
  }
  if (
    m.maxCostUtilizationForPromote !== undefined &&
    m.maxCostUtilization !== undefined &&
    m.maxCostUtilizationForPromote > m.maxCostUtilization
  ) {
    reasons.push(
      `threshold pairing: maxCostUtilizationForPromote (${m.maxCostUtilizationForPromote}) ` +
        `must be <= maxCostUtilization (${m.maxCostUtilization})`,
    );
  }

  return reasons.length === 0 ? ok(out) : fail(reasons);
}

// --- Combined tenant config validator --------------------------------------

export interface TenantConfigPatch {
  tierOverrides?: unknown;
  scorecardThresholds?: unknown;
}

export interface TenantConfigValidationResult {
  ok: boolean;
  reasons: string[];
  /** Narrowed values per knob, only present when its own validation passed. */
  tierOverrides?: TierOverrides;
  scorecardThresholds?: ScorecardThresholdOverrides;
}

/** Validate any subset of the tenant config knobs in one call. Reasons are
 *  prefixed with the knob name so the caller can route them per-field. */
export function validateTenantConfig(patch: TenantConfigPatch): TenantConfigValidationResult {
  const reasons: string[] = [];
  let tierOverrides: TierOverrides | undefined;
  let scorecardThresholds: ScorecardThresholdOverrides | undefined;

  if ("tierOverrides" in patch) {
    const r = validateTierOverrides(patch.tierOverrides);
    if (r.ok) tierOverrides = r.value;
    else for (const m of r.reasons) reasons.push(`tier_overrides: ${m}`);
  }
  if ("scorecardThresholds" in patch) {
    const r = validateScorecardThresholds(patch.scorecardThresholds);
    if (r.ok) scorecardThresholds = r.value;
    else for (const m of r.reasons) reasons.push(`scorecard_thresholds: ${m}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    ...(tierOverrides !== undefined ? { tierOverrides } : {}),
    ...(scorecardThresholds !== undefined ? { scorecardThresholds } : {}),
  };
}
