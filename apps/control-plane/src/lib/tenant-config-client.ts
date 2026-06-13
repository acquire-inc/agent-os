// Client-side mirror of packages/core/src/tenant-config.ts slug-shape rules.
//
// Used by the Settings UI to pre-flight a tier-override slug before sending
// it to the API. The API runs the canonical validators (and the catalog
// check); this file gives the operator immediate feedback without the round
// trip.
//
// Drift policy: this file mirrors the rules; the platform's canonical
// rules live in packages/core/src/tenant-config.ts and the launch-readiness
// check verifies them. If the regex/rule drifts vs the server, the user
// sees the same error twice — that's noisy but safe.

const MODEL_SLUG_RE = /^[a-z0-9][a-z0-9._\-]*\/[a-z0-9][a-z0-9._\-]*$/i;

export function validateTierOverrideSlugClient(
  tier: string,
  slug: string,
): { ok: true } | { ok: false; reason: string } {
  if (tier === "T-critical") {
    return {
      ok: false,
      reason:
        "T-critical is pinned to claude-opus-4.8 and never honors per-tenant overrides (doctrine: tier wins, override loses).",
    };
  }
  const s = slug.trim();
  if (s.length === 0) {
    return { ok: false, reason: "Model slug cannot be empty — clear the field to remove the override." };
  }
  if (!MODEL_SLUG_RE.test(s)) {
    return {
      ok: false,
      reason: `'${s}' is not a valid model slug. Expected provider/model, e.g. nousresearch/hermes-4-405b.`,
    };
  }
  return { ok: true };
}
