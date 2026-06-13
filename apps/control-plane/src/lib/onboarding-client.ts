// Client-side mirror of packages/core/src/onboarding.ts validation rules.
// Used by the onboarding UI to pre-flight an interview before any side
// effect. The canonical validators live in core; this is a thin browser
// twin to avoid pulling drizzle-orm into the UI bundle.

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

export interface ClientInterview {
  companyName: string;
  tenantSlug?: string;
  description: string;
  industry: string;
  goals: string;
  connectorsInUse: string[];
  monthlyBudgetUsd: number | null;
  craAcknowledgement: "confirmed_not_eligibility_decisioning" | "needs_review";
}

export function slugifyCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function validateInterviewClient(iv: ClientInterview): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!iv.companyName.trim()) reasons.push("Company name is required");
  if (iv.description.trim().length < 20) reasons.push("Description must be at least 20 characters");
  if (iv.goals.trim().length < 20) reasons.push("90-day goals must be at least 20 characters");
  if (!iv.industry.trim()) reasons.push("Industry is required");
  if (iv.monthlyBudgetUsd !== null && (!Number.isFinite(iv.monthlyBudgetUsd) || iv.monthlyBudgetUsd < 0))
    reasons.push("Budget must be a non-negative number or blank");
  if (iv.tenantSlug && !/^[a-z0-9][a-z0-9\-]*$/.test(iv.tenantSlug))
    reasons.push("Slug must be lowercase, alphanumeric + hyphens");

  const combined = `${iv.description} ${iv.goals} ${iv.industry}`.toLowerCase();
  const triggered = CRA_TRIGGER_KEYWORDS.filter((k) => combined.includes(k));
  if (triggered.length > 0 && iv.craAcknowledgement !== "confirmed_not_eligibility_decisioning") {
    reasons.push(
      `CRA territory keyword(s) detected (${triggered.join(", ")}). Confirm the use case does NOT make eligibility decisions in credit, employment, housing, insurance, or government benefits.`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/** Build the Architect prompt — same structure as core composeArchitectPrompt. */
export function composeArchitectPromptClient(iv: ClientInterview): string {
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

export const ONBOARDING_STEPS: Array<{ kind: string; description: string; humanGated: boolean }> = [
  { kind: "validate_interview", description: "Validate interview shape + CRA pre-check", humanGated: false },
  { kind: "create_tenant", description: "Create the tenants row with slug + budget cap", humanGated: false },
  { kind: "seed_baseline_skills", description: "Seed shared skills (pnpm seed:phase-1)", humanGated: false },
  { kind: "seed_baseline_mcps", description: "Register connector MCPs", humanGated: false },
  { kind: "architect_propose", description: "Generate Architect blueprint from this prompt", humanGated: false },
  { kind: "operator_review_blueprint", description: "Review warnings (overlap, CRA, model picks) and approve", humanGated: true },
  { kind: "seed_blueprint", description: "Run seedFromBlueprint (agents created at autonomy=propose, enabled=false)", humanGated: false },
  { kind: "enable_runners", description: "Enable agents one at a time after first dry-run", humanGated: true },
  { kind: "post_onboarding_health_check", description: "Run pnpm launch:check", humanGated: false },
];
