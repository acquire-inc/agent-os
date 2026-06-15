// Auto-onboarding interview flow (V2 P10 — "Viktor flow").
//
// The end state of AgentOS is: a company answers an onboarding interview,
// the Architect auto-provisions a tailored fleet (hard floors intact),
// and that fleet self-tunes against the client's real outcomes.
//
// This module ships the PURE pieces needed to bring a new tenant up
// without an operator drafting prompts by hand:
//   - validateOnboardingInterview: shape + content check on the interview
//     payload (company info, goals, connectors, constraints).
//   - composeArchitectPrompt: deterministic prompt string the Architect
//     consumes to generate a TeamBlueprintProposal.
//   - planOnboardingSteps: ordered checklist of side effects (tenant
//     create → seeds → architect propose → operator review → seed agents).
//
// No LLM call here. The Architect already exists and handles the
// LLM-shaped work; this module bridges the interview to that surface.

export interface OnboardingInterview {
  /** Company name (display). */
  companyName: string;
  /** Slug (lowercase, hyphenated). Caller may pre-compute or we'll suggest. */
  tenantSlug?: string;
  /** What the company does, one paragraph. */
  description: string;
  /** Comma-separated industry tags. */
  industry: string;
  /** Multi-line free-form: what does success look like in 90 days? */
  goals: string;
  /** Which tools the team uses (Close, Slack, Stripe, HubSpot, …). Free-form. */
  connectorsInUse: readonly string[];
  /** Monthly spend cap in USD. Null = uncapped (operator review). */
  monthlyBudgetUsd: number | null;
  /** Optional: industries / use cases the operator confirmed are NOT CRA. */
  craAcknowledgement: "confirmed_not_eligibility_decisioning" | "needs_review";
}

export interface OnboardingValidationResult {
  ok: boolean;
  reasons: string[];
  /** Suggested slug if caller didn't provide one. */
  suggestedSlug?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const CRA_TRIGGER_KEYWORDS = [
  "credit",
  "underwriting",
  "tenant screening",
  "background check",
  "employment screening",
  "housing applicant",
  "loan approval",
  "insurance underwriting",
];

export function validateOnboardingInterview(
  iv: OnboardingInterview,
): OnboardingValidationResult {
  const reasons: string[] = [];
  if (!iv.companyName || iv.companyName.trim().length === 0) reasons.push("companyName is required");
  if (!iv.description || iv.description.trim().length < 20)
    reasons.push("description: provide at least 20 characters describing the business");
  if (!iv.goals || iv.goals.trim().length < 20)
    reasons.push("goals: provide at least 20 characters describing 90-day success");
  if (!iv.industry || iv.industry.trim().length === 0) reasons.push("industry is required");
  if (iv.monthlyBudgetUsd !== null && (!Number.isFinite(iv.monthlyBudgetUsd) || iv.monthlyBudgetUsd < 0))
    reasons.push("monthlyBudgetUsd must be a non-negative finite number or null");
  if (iv.tenantSlug && !/^[a-z0-9][a-z0-9\-]*$/.test(iv.tenantSlug))
    reasons.push("tenantSlug must be lowercase, alphanumeric + hyphens");

  // CRA pre-check: if any trigger keyword appears in description/goals/industry,
  // the operator must explicitly confirm — we DON'T auto-onboard CRA-territory
  // companies. (The Architect's hard refusal still fires at blueprint time;
  // this catches it at the interview layer for a cleaner UX.)
  // IN-03: match on WORD BOUNDARIES so legitimate copy like "credit card
  // processing" or "accredited investor" doesn't trip the gate via the
  // substring match of "credit". The downstream architect blocklist is the
  // load-bearing refusal; this layer only exists to give the operator the
  // explicit-confirm UI before the architect blowback.
  const combined = `${iv.description} ${iv.goals} ${iv.industry}`.toLowerCase();
  const triggered = CRA_TRIGGER_KEYWORDS.filter((k) =>
    new RegExp(`\\b${k}\\b`, "i").test(combined),
  );
  if (triggered.length > 0 && iv.craAcknowledgement !== "confirmed_not_eligibility_decisioning") {
    reasons.push(
      `CRA territory keyword(s) detected (${triggered.join(", ")}). Operator must confirm ` +
        `the use case does NOT make eligibility decisions in credit, employment, housing, ` +
        `insurance, or government benefits before onboarding can proceed.`,
    );
  }

  const suggestedSlug = iv.tenantSlug ?? slugify(iv.companyName);
  return { ok: reasons.length === 0, reasons, suggestedSlug };
}

/**
 * Build the Architect prompt from a validated interview. Deterministic —
 * same input always yields the same prompt string. The Architect's
 * existing TeamBlueprintProposal generation does the LLM-shaped work; this
 * function just frames the prompt consistently.
 */
export function composeArchitectPrompt(iv: OnboardingInterview): string {
  const lines = [
    `# New tenant onboarding`,
    ``,
    `**Company:** ${iv.companyName}`,
    `**Industry:** ${iv.industry}`,
    ``,
    `## What the business does`,
    iv.description.trim(),
    ``,
    `## 90-day goals`,
    iv.goals.trim(),
    ``,
    `## Tools in use`,
  ];
  if (iv.connectorsInUse.length === 0) {
    lines.push("(none specified yet — propose connectors needed for the goals)");
  } else {
    for (const c of iv.connectorsInUse) lines.push(`- ${c}`);
  }
  lines.push(``, `## Budget`);
  lines.push(
    iv.monthlyBudgetUsd === null
      ? "(uncapped — operator review)"
      : `$${iv.monthlyBudgetUsd.toFixed(2)} / month`,
  );
  lines.push(
    ``,
    `## Architect task`,
    `Propose a fleet of agents that achieves the 90-day goals on the tools listed.`,
    `Each agent must declare: model tier, autonomy (propose / execute_safe),`,
    `skills (referenced by key), and connector bindings.`,
    ``,
    `Constraints (non-negotiable):`,
    `- Refuse blueprints whose agents make eligibility decisions in credit,`,
    `  employment, housing, insurance, or government-benefits determination (CRA).`,
    `- Cant-fail agents (14 doctrine keys) keep Opus pin.`,
    `- Skills referenced by key only — don't invent skill definitions.`,
    `- Architect output autonomy ceiling is 'execute_safe'; never 'execute_full'.`,
  );
  return lines.join("\n");
}

export type OnboardingStepKind =
  | "validate_interview"
  | "create_tenant"
  | "seed_baseline_skills"
  | "seed_baseline_mcps"
  | "architect_propose"
  | "operator_review_blueprint"
  | "seed_blueprint"
  | "enable_runners"
  | "post_onboarding_health_check";

export interface OnboardingStep {
  kind: OnboardingStepKind;
  description: string;
  /** Whether this step requires a human in the chair. */
  humanGated: boolean;
}

/** Deterministic ordered list of side effects to onboard a tenant. The
 *  caller (admin UI / API endpoint) walks the list, runs each step, and
 *  shows progress. Human-gated steps pause for operator input. */
export function planOnboardingSteps(iv: OnboardingInterview): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    { kind: "validate_interview", description: "Run validateOnboardingInterview", humanGated: false },
    { kind: "create_tenant", description: `Create tenant "${iv.companyName}" with slug + budget cap`, humanGated: false },
    { kind: "seed_baseline_skills", description: "Seed shared skills (memory, retrieval, defaults)", humanGated: false },
    {
      kind: "seed_baseline_mcps",
      description: `Seed connector records for: ${iv.connectorsInUse.length === 0 ? "(operator to specify)" : iv.connectorsInUse.join(", ")}`,
      humanGated: iv.connectorsInUse.length === 0,
    },
    { kind: "architect_propose", description: "Architect generates TeamBlueprintProposal from the interview", humanGated: false },
    {
      kind: "operator_review_blueprint",
      description: "Operator reviews blueprint warnings (overlap, CRA refusal, model picks) and approves",
      humanGated: true,
    },
    { kind: "seed_blueprint", description: "Run seedFromBlueprint to create agents (autonomy=propose, enabled=false by default)", humanGated: false },
    { kind: "enable_runners", description: "Operator enables agents one at a time after first dry-run", humanGated: true },
    { kind: "post_onboarding_health_check", description: "Run pnpm launch:check + verify cant-fail seed completeness", humanGated: false },
  ];
  return steps;
}
