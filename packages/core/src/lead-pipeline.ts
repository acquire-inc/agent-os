// Lead pipeline pure logic (P3 Discovery + P4 Enrichment + Scoring).
//
// All the deterministic decisions the two agents make — matrix-driven actor
// selection, dedupe-key computation, suppression matching, scoring-result
// validation, qualification rules — live here as pure functions so they're
// testable offline. The HTTP calls to Apify / Apollo / Serper / Jina / email
// verifiers / phone validators live as tool handlers in apps/runner; the
// Drizzle writes live in the API. This module is the "what the agent thinks"
// layer that both sides import.
//
// Doctrine constraints encoded here:
//   - target_type wins: a tech_funded-only actor MUST NOT run for local_smb.
//   - DNC or invalid email always disqualifies, regardless of score.
//   - score_threshold is the qualify cut; an integer 0–100, source-of-truth
//     on the icps row.

// ─── Types ─────────────────────────────────────────────────────────────

export type TargetType = "local_smb" | "mid_market" | "tech_funded" | "enterprise" | "creator";

export type EmailStatus = "unknown" | "valid" | "risky" | "invalid" | "catchall" | "role";
export type PhoneType = "unknown" | "mobile" | "landline" | "voip" | "invalid";

export interface ICP {
  id: string;
  tenantId: string;
  name: string;
  active: boolean;
  targetType: TargetType;
  positiveSignals: Record<string, number>;
  minRevenueUsd: number | null;
  minHeadcount: number | null;
  maxHeadcount: number | null;
  titles: string[];
  verticals: string[];
  geo: string[];
  countries: string[];
  dailyDiscoveryLimit: number;
  enrichmentBatchSize: number;
  scoreThreshold: number; // 0..100, inclusive
}

export interface RawLeadInput {
  /** The actor that produced this row. */
  sourceActor: string;
  /** The query passed to the actor — used for audit + replay. */
  sourceQuery?: Record<string, unknown> | null;
  raw: Record<string, unknown>;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  company?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
}

// ─── Actor-selection matrix ────────────────────────────────────────────
//
// Catalog of every discovery actor we know about, with which target_types it
// fits. The Discovery Agent reads ICP.targetType and selects actors that
// LIST that target_type. The strict rule: never run an actor whose targets[]
// excludes the ICP's targetType. The system prompt embeds this verbatim so
// the agent's prose-side reasoning matches the deterministic selection here.

export interface DiscoveryActor {
  /** Stable key referenced in lead.source_actor. */
  key: string;
  /** Underlying provider — operator reads this to debug API spend. */
  provider: "apify" | "apollo" | "manual";
  /** For Apify, the actor id (org/name). For Apollo, the endpoint name. */
  externalId: string;
  /** target_types this actor produces useful results for. */
  targets: TargetType[];
  /** Hard cap on items per single actor run — controls Apify cost. */
  maxItemsPerRun: number;
  /** Human-readable note for the matrix doc. */
  note: string;
}

export const DISCOVERY_ACTORS: ReadonlyArray<DiscoveryActor> = Object.freeze([
  {
    key: "apify:apollo-scraper",
    provider: "apify",
    externalId: "code_crafter/apollo-io-scraper",
    targets: ["mid_market", "tech_funded", "enterprise"],
    maxItemsPerRun: 500,
    note: "Apollo people search via Apify — best for B2B by title + headcount + vertical.",
  },
  {
    key: "apify:google-maps-scraper",
    provider: "apify",
    externalId: "compass/crawler-google-places",
    targets: ["local_smb"],
    maxItemsPerRun: 300,
    note: "Google Places — best for local services / brick-and-mortar by geo + category.",
  },
  {
    key: "apify:linkedin-jobs-scraper",
    provider: "apify",
    externalId: "bebity/linkedin-jobs-scraper",
    targets: ["mid_market", "tech_funded", "enterprise"],
    maxItemsPerRun: 200,
    note: "LinkedIn hiring signal — companies posting roles == budget + growth signal.",
  },
  {
    key: "apify:crunchbase-funded",
    provider: "apify",
    externalId: "code_crafter/crunchbase-scraper",
    targets: ["tech_funded"],
    maxItemsPerRun: 200,
    note: "Recently-funded companies — tech_funded ONLY (never local_smb).",
  },
  {
    key: "apify:instagram-creators",
    provider: "apify",
    externalId: "apify/instagram-profile-scraper",
    targets: ["creator"],
    maxItemsPerRun: 150,
    note: "Creator economy — follower count + recent post engagement.",
  },
  {
    key: "apollo:search",
    provider: "apollo",
    externalId: "people/search",
    targets: ["mid_market", "tech_funded", "enterprise"],
    maxItemsPerRun: 100,
    note: "Apollo's own API — used directly when Apify path is rate-limited.",
  },
]);

/**
 * Choose discovery actors for an ICP. STRICT: actors that don't list the
 * ICP's target_type are excluded. Returns the selected set in the matrix's
 * declared order so output is deterministic.
 */
export function selectDiscoveryActors(targetType: TargetType): DiscoveryActor[] {
  return DISCOVERY_ACTORS.filter((a) => a.targets.includes(targetType));
}

/** Inverse query — used by the doctrine to surface what's available per
 *  target_type for the system-prompt knowledge block. */
export function matrixForTargetType(targetType: TargetType): string {
  const actors = selectDiscoveryActors(targetType);
  if (actors.length === 0) return `(no actors registered for ${targetType})`;
  return actors
    .map((a) => `  - ${a.key} (${a.provider}, max ${a.maxItemsPerRun}/run) — ${a.note}`)
    .join("\n");
}

// ─── Dedupe ────────────────────────────────────────────────────────────

/** Normalize a domain for keying. Strips protocol, www, trailing slash, casts
 *  to lowercase. Doesn't enforce DNS shape — just normalizes what's there. */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s;
}

/** Normalize an email for keying. Lowercase; preserves dots (we don't fold
 *  gmail's dot-equivalent because we'd lose deliverability info). */
export function normalizeEmail(input: string | null | undefined): string {
  if (!input) return "";
  return input.trim().toLowerCase();
}

/** Normalize a LinkedIn URL for keying. Strips protocol/host, lowercases,
 *  drops trailing slash + query. */
export function normalizeLinkedinUrl(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.replace(/^linkedin\.com\//, "");
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  return s.replace(/\/+$/, "");
}

/**
 * Compute the dedupe_key for a lead. Strategy:
 *   1. email is the strongest signal — `email:${normalized}` if present.
 *   2. else linkedin_url is next — `li:${normalized}`.
 *   3. else domain + lowercased name as a last-resort surrogate.
 *
 * The (tenant_id, dedupe_key) UNIQUE index in the schema enforces the contract.
 */
export function computeDedupeKey(input: RawLeadInput): string | null {
  const email = normalizeEmail(input.email);
  if (email && email.includes("@")) return `email:${email}`;
  const li = normalizeLinkedinUrl(input.linkedinUrl);
  if (li) return `li:${li}`;
  const domain = normalizeDomain(input.domain);
  const name = `${input.firstName ?? ""}${input.lastName ?? ""}`.toLowerCase().replace(/\s+/g, "");
  if (domain && name) return `dn:${domain}:${name}`;
  // Insufficient signal — caller should drop this row instead of inserting.
  return null;
}

// ─── Suppression ───────────────────────────────────────────────────────

export interface SuppressionEntry {
  kind: "email" | "domain" | "phone" | "linkedin_url";
  value: string; // already normalized
}

/**
 * Does ANY suppression entry match this lead? Pure: caller loads the
 * suppression list once, passes it in. Match rule: kind+value exact match
 * after normalization.
 */
export function matchesSuppression(
  lead: RawLeadInput,
  suppression: ReadonlyArray<SuppressionEntry>,
): boolean {
  const email = normalizeEmail(lead.email);
  const domain = normalizeDomain(lead.domain);
  const li = normalizeLinkedinUrl(lead.linkedinUrl);
  const phone = (lead.phone ?? "").trim();
  for (const s of suppression) {
    if (s.kind === "email" && email && s.value === email) return true;
    if (s.kind === "domain" && domain && s.value === domain) return true;
    if (s.kind === "linkedin_url" && li && s.value === li) return true;
    if (s.kind === "phone" && phone && s.value === phone) return true;
  }
  return false;
}

// ─── Scoring contract + qualification ──────────────────────────────────

/** Output the scorer (Claude sub-agent) must emit. Validated before write. */
export interface ScoringResult {
  score: number;       // 0..100
  qualified: boolean;
  roiHook: string;     // 1-line "we save you X" hook for outreach
  signal: string;      // top observed signal that drove the score
  reason: string;      // human-readable rationale
}

export interface ScoringValidationResult {
  ok: boolean;
  value?: ScoringResult;
  reasons: string[];
}

/**
 * Parse a scoring result emitted by Claude. Strict: every field required,
 * score in range, types correct. Garbage rejected — the caller should NOT
 * write partial scores to leads.
 */
export function validateScoringResult(raw: unknown): ScoringValidationResult {
  const reasons: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reasons: ["scoring result is not an object"] };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.score !== "number" || !Number.isFinite(r.score)) reasons.push("score must be a finite number");
  else if (r.score < 0 || r.score > 100) reasons.push("score must be in [0, 100]");
  else if (!Number.isInteger(r.score)) reasons.push("score must be an integer (0–100)");
  if (typeof r.qualified !== "boolean") reasons.push("qualified must be a boolean");
  if (typeof r.roiHook !== "string" || r.roiHook.trim().length === 0) reasons.push("roiHook must be a non-empty string");
  if (typeof r.signal !== "string" || r.signal.trim().length === 0) reasons.push("signal must be a non-empty string");
  if (typeof r.reason !== "string" || r.reason.trim().length === 0) reasons.push("reason must be a non-empty string");
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    reasons: [],
    value: {
      score: r.score as number,
      qualified: r.qualified as boolean,
      roiHook: (r.roiHook as string).trim(),
      signal: (r.signal as string).trim(),
      reason: (r.reason as string).trim(),
    },
  };
}

export interface QualificationInput {
  scoreThreshold: number;
  score: number;
  modelQualified: boolean;
  emailStatus: EmailStatus;
  dncFlag: boolean;
}

export interface QualificationDecision {
  qualified: boolean;
  reason: string;
}

/**
 * Final qualified decision. The scorer says "yes," but DNC or an invalid email
 * always wins — those override any score (doctrine: never reach out to someone
 * who has explicitly opted out; never send to an address known to bounce).
 */
export function applyQualificationRules(input: QualificationInput): QualificationDecision {
  if (input.dncFlag) return { qualified: false, reason: "dnc_flag set — opt-out / suppression" };
  if (input.emailStatus === "invalid") return { qualified: false, reason: "email_status=invalid — would bounce" };
  if (input.score < input.scoreThreshold) {
    return { qualified: false, reason: `score ${input.score} below threshold ${input.scoreThreshold}` };
  }
  // Score clears threshold AND no hard disqualifier → trust the scorer.
  // (Scorer may set qualified=false even when score >= threshold for prose
  // reasons — honor that.)
  return {
    qualified: input.modelQualified,
    reason: input.modelQualified
      ? `score ${input.score} >= ${input.scoreThreshold}, no hard disqualifier`
      : "scorer set qualified=false despite score >= threshold",
  };
}
