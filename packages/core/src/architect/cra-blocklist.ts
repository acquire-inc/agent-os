// CRA prohibition blocklist — global invariant.
//
// Doctrine source: CLAUDE.md. The Architect MUST refuse to assemble any agent
// whose function touches eligibility decisioning in: credit · employment ·
// housing/tenant screening · insurance underwriting · government-benefit
// determination. Code-enforced, fails closed.
//
// Two enforcement points:
//   1. hydrate.ts calls assertNotCraProhibited() per blueprint at assembly
//      time. Match -> skip blueprint, append warning, caller emits
//      Relay event "architect.refused" with the matched category.
//   2. apps/runner/src/execute.ts calls assertNotCraProhibited() at
//      SessionStart against bundle.agent.systemPrompt. Match -> emit
//      "cantfail.cra_violation" and return terminal run.failed.
//      Belt-and-suspenders for manually-authored seeds that bypassed (1).
//
// The list is a global invariant. No per-tenant override. tenants.feature_flags
// CANNOT disable this — public-launch HARD GATE.

export type CraCategory =
  | "credit"
  | "employment"
  | "housing"
  | "insurance"
  | "government-benefit";

export const CRA_CATEGORIES: readonly CraCategory[] = [
  "credit",
  "employment",
  "housing",
  "insurance",
  "government-benefit",
] as const;

// Keyword bank per category. Match is case-insensitive on whole-word boundaries
// against the input text (concatenation of role + system prompt at hydrate
// time, or system prompt at runtime). Keywords are CHOSEN to fire on
// eligibility-decisioning language and NOT on operational/billing language
// that mentions the same domain word in a non-decisioning context.
//
// e.g. "decide credit eligibility" fires; "credit the customer's account
// in the ledger" does not (no "eligibility" / "underwriting" / "applicant"
// nearby and "credit" alone is not in the keyword list — only multi-word
// eligibility-decisioning phrases).
//
// The list is operator-owned. Adding a category or a phrase is an explicit
// edit reviewed in PR. Phrases are kept as multi-word collocations to keep
// false-positive rate low; single-word triggers like "credit" alone are
// avoided because they overfit benign usage.
export const CRA_KEYWORDS: Readonly<Record<CraCategory, readonly string[]>> = {
  credit: [
    "credit eligibility",
    "credit decisioning",
    "credit application review",
    "credit risk scoring",
    "credit approval",
    "loan approval",
    "loan eligibility",
    "lending decision",
    "creditworthiness assessment",
    "credit bureau decisioning",
  ],
  employment: [
    "employment eligibility",
    "hiring decision",
    "candidate screening for eligibility",
    "background check eligibility",
    "employment screening",
    "applicant fitness determination",
    "employability scoring",
    "hire/no-hire decision",
    "pre-employment screening",
    "candidate disqualification",
  ],
  housing: [
    "tenant screening",
    "rental application review",
    "housing eligibility",
    "lease approval",
    "rental approval decision",
    "landlord screening",
    "tenant qualification",
    "rental denial",
    "housing application decisioning",
    "lease eligibility determination",
  ],
  insurance: [
    "insurance underwriting",
    "policy underwriting",
    "insurance eligibility",
    "premium risk classification",
    "underwriting decision",
    "insurance application denial",
    "policy issuance decision",
    "actuarial eligibility",
    "insurance risk scoring",
    "coverage eligibility determination",
  ],
  "government-benefit": [
    "benefit eligibility",
    "government benefit decisioning",
    "welfare eligibility",
    "snap eligibility",
    "medicaid eligibility",
    "unemployment benefit eligibility",
    "social security eligibility decision",
    "public assistance eligibility",
    "benefit denial determination",
    "entitlement eligibility decision",
    "snap applicants",
    "medicaid applicants",
  ],
};

export class CraProhibitionError extends Error {
  readonly category: CraCategory;
  readonly matchedKeyword: string;
  readonly source: string;

  constructor(category: CraCategory, matchedKeyword: string, source: string) {
    super(
      `CRA-prohibited content detected (category=${category}, source=${source}): matched "${matchedKeyword}". The CRA blocklist is a global invariant per CLAUDE.md — no override.`,
    );
    this.name = "CraProhibitionError";
    this.category = category;
    this.matchedKeyword = matchedKeyword;
    this.source = source;
  }
}

export interface CraCheckResult {
  prohibited: boolean;
  category: CraCategory | null;
  matchedKeyword: string | null;
}

/** Escape regex metacharacters in a literal phrase. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the first matching CRA category if any keyword from the bank hits
 * the input text. Case-insensitive, whole-word match.
 *
 * WR-05 fix: previously used substring `.includes()` which matched inside
 * longer compound words (e.g. "credit eligibility" matched inside
 * "noncredit eligibility-bypass"). Now uses `\b<keyword>\b` regex so
 * matches must respect word boundaries.
 */
export function checkCraProhibition(text: string): CraCheckResult {
  for (const category of CRA_CATEGORIES) {
    for (const keyword of CRA_KEYWORDS[category]) {
      const re = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      if (re.test(text)) {
        return { prohibited: true, category, matchedKeyword: keyword };
      }
    }
  }
  return { prohibited: false, category: null, matchedKeyword: null };
}

/**
 * Throws CraProhibitionError on match. `source` is a free-form descriptor
 * for the audit trail (e.g. "architect:loan-eligibility-screener" or
 * "runtime:bundle-id-abc"). Callers MUST catch and emit the appropriate
 * Relay event before re-throwing or returning a terminal failure.
 */
export function assertNotCraProhibited(text: string, source: string): void {
  const result = checkCraProhibition(text);
  if (result.prohibited && result.category && result.matchedKeyword) {
    throw new CraProhibitionError(result.category, result.matchedKeyword, source);
  }
}
