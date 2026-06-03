// scripts/seed/author-skill-anatomy.ts — bring the thin primary skills to canonical anatomy
// (Phase 12). These skills had good step content but no `## Steps`/`## Guardrails` structure and,
// critically, no explicit safety rails. This adds a `## Steps` header and a function-specific
// `## Guardrails` section grounded in the doctrine non-negotiables (propose-not-execute, the launch/
// payment gates, verification, "large outputs go to files"). Idempotent: skips any skill that
// already has a `## Guardrails` section; never rewrites existing steps. Keeps frontmatter intact.
// Run:
//   pnpm --filter @agent-os/seed exec tsx author-skill-anatomy.ts          (writes)
//   pnpm --filter @agent-os/seed exec tsx author-skill-anatomy.ts --check  (CI gate)
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(here, "..", "..", "external", "acqu-skills");

// skill key → guardrail bullets (the "never do X / escalate Y" rails the steps don't state).
const GUARDRAILS: Record<string, string[]> = {
  "creative-generation": [
    "Change exactly ONE variable per variant — never all at once, or you can't read what moved the metric.",
    "No creative goes live until `ad-claim-compliance` clears the copy (Gate 1) — substantiation is mandatory.",
    "Propose the test at minimum-viable budget; never auto-spend past the budget cap.",
  ],
  "lead-routing-qualification": [
    "Disqualify with a recorded reason — never silently drop a lead.",
    "For ambiguous ICP fit, ask one clarifying question rather than guessing.",
    "Routing/assignment is reversible; outbound contact is not — propose outbound, don't auto-send.",
  ],
  "client-onboarding": [
    "Do not start fulfillment before `first_payment.received` — the payment gate is a hard precondition (E.1).",
    "Surface any missing access (ad accounts, analytics, brand assets) as an Approval; never fabricate placeholder access.",
    "Confirm the 30/60/90 plan + success metrics with the AM before committing them to the client.",
  ],
  "churn-risk-detection": [
    "Surface as a proposal with options (send now / draft / escalate / do nothing) — never auto-send client outreach.",
    "A confirmed RED gets same-day founder escalation; don't sit on it.",
    "Quantify the signal — don't assert churn from a single weak data point.",
  ],
  "weekly-client-reporting": [
    "Draft for AM review (propose); never send a client report without approval.",
    "Every number traces to a source (verification-before-completion) — no figures from memory.",
    "Call out misses honestly; never bury a bad week.",
  ],
  "client-health-scan": [
    "Read-only assessment — never act on an account from this skill; hand RED accounts to churn-risk-detection.",
    "Flag stale or missing inputs as a finding rather than scoring around them.",
  ],
  "memory-consolidation": [
    "Resolve contradictions toward the newest VERIFIED fact; never overwrite a verified fact with an unverified one.",
    "Keep decisions/results/learnings, drop transient noise — but never delete the record of a decision.",
    "Large content goes to Knowledge with the path referenced — never dumped inline (non-negotiable #4).",
  ],
  "competitor-ad-teardown": [
    "Adapt angles — never copy a competitor's creative or claims (legal + brand risk).",
    "Any adapted claim still passes `ad-claim-compliance` before it runs.",
    "Treat ad longevity as a SIGNAL of a winner, not proof — validate against our own data.",
  ],
  "content-engine": [
    "Draft for review; queue only approved pieces — never auto-publish.",
    "Keep brand voice and cite the concrete example/number that makes it credible — no invented stats.",
    "Run brand-voice + claim checks before anything client-facing ships.",
  ],
  "proposal-drafting": [
    "Pricing always needs human sign-off — propose tiers, never commit a price.",
    "Ground scope in the client's stated goals + discovery notes; don't promise outcomes you can't substantiate.",
    "Route to contract-drafter / approval before anything is sent or signed.",
  ],
  "meeting-prep": [
    "Read-only prep — never contact the client or change deal state from this skill.",
    "Every fact in the brief traces to CRM/transcript; flag unknowns instead of guessing.",
  ],
  "playbook-capture": [
    "Capture failures as well as wins — a failed run's lesson is as valuable as a win's.",
    "Store in Knowledge by path and tag for retrieval — never inline a large artifact into context.",
    "Capture the guardrails that kept it safe, not just the steps.",
  ],
};

export const ANATOMY_SKILLS = Object.keys(GUARDRAILS);

function transform(md: string, guardrails: string[]): string {
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  const lines = md.split(/\r?\n/);
  // Insert a `## Steps` header before the first numbered step, if not already present.
  if (!lines.some((l) => /^##\s+Steps\b/.test(l))) {
    const firstStep = lines.findIndex((l) => /^1\.\s/.test(l));
    if (firstStep > 0) lines.splice(firstStep, 0, "## Steps");
  }
  let out = lines.join(eol).replace(/\s+$/, "");
  out += `${eol}${eol}## Guardrails${eol}` + guardrails.map((g) => `- ${g}`).join(eol) + eol;
  return out;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  let authored = 0;
  let already = 0;
  const missing: string[] = [];

  for (const [skill, guardrails] of Object.entries(GUARDRAILS)) {
    const file = join(SKILLS_DIR, skill, "SKILL.md");
    let md: string;
    try { md = await readFile(file, "utf8"); } catch { missing.push(`${skill} (no file)`); continue; }

    const hasGuardrails = /^##\s+Guardrails\b/m.test(md);
    const hasSteps = /^##\s+Steps\b/m.test(md);
    if (hasGuardrails && hasSteps) { already++; continue; }
    if (checkOnly) { missing.push(skill); continue; }

    await writeFile(file, transform(md, guardrails));
    authored++;
  }

  console.log(`Anatomy skills: ${ANATOMY_SKILLS.length} | already conformed: ${already} | authored: ${authored}`);
  if (checkOnly && missing.length) {
    console.error(`✗ ${missing.length} skill(s) missing canonical ## Steps/## Guardrails: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (checkOnly) console.log("✓ every targeted primary skill has canonical ## Steps + ## Guardrails.");
  process.exit(0);
}

const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((err) => { console.error(err); process.exit(1); });
