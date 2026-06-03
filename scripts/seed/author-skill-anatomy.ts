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
import { readdirSync } from "node:fs";
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

// The fleet-wide non-negotiables — true for EVERY agent skill (doctrine §3/#4 + the autonomy gate).
// Applied to any skill without bespoke guardrails so the whole library states its rails at the point
// of use (reinforcing the universal verification-before-completion / clarify-before-acting skills).
const UNIVERSAL_GUARDRAILS = [
  "Propose any irreversible or side-effecting action for approval; auto-run only reversible, in-scope steps.",
  "Verify before reporting done — every claim traces to a tool result or knowledge file; never fabricate.",
  "Large outputs go to files/knowledge and you return the path — never dump them into context.",
];

// One keyword-derived domain rail on top of the baseline (best-effort, not bespoke).
function domainRail(key: string): string | null {
  if (/monitor|watch|scan|health|track|detect|anomaly|guardian|telemetry|aging|position|audit/.test(key))
    return "Read/monitor only — surface findings and propose; never act on the account from this skill.";
  if (/send|email|sms|outreach|comms|notify|launch|publish|charge|bill|pay|contract|deploy|dunning|discount|refund|payout|gesture/.test(key))
    return "This touches an irreversible/external action — route it through the approval gate; never auto-execute.";
  if (/report|summary|brief|memo|forecast|model|analysis|recommend|propos|plan|teardown|review|evaluation|capacity/.test(key))
    return "Draft for review; decisions and anything client-facing need human sign-off.";
  return null;
}

function genericGuardrails(key: string): string[] {
  const rail = domainRail(key);
  return rail ? [rail, ...UNIVERSAL_GUARDRAILS] : [...UNIVERSAL_GUARDRAILS];
}

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

  // Whole library: bespoke guardrails where defined, else universal baseline + a domain rail.
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    const skill = d.name;
    const file = join(SKILLS_DIR, skill, "SKILL.md");
    let md: string;
    try { md = await readFile(file, "utf8"); } catch { missing.push(`${skill} (no file)`); continue; }

    const hasGuardrails = /^##\s+Guardrails\b/m.test(md);
    // ## Steps is only expected when the body actually has numbered steps.
    const hasNumberedSteps = /^1\.\s/m.test(md);
    const stepsOk = !hasNumberedSteps || /^##\s+Steps\b/m.test(md);
    if (hasGuardrails && stepsOk) { already++; continue; }
    if (checkOnly) { missing.push(skill); continue; }

    await writeFile(file, transform(md, GUARDRAILS[skill] ?? genericGuardrails(skill)));
    authored++;
  }

  console.log(`Anatomy: ${dirs.length} skills | already conformed: ${already} | authored: ${authored} (${ANATOMY_SKILLS.length} bespoke)`);
  if (checkOnly && missing.length) {
    console.error(`✗ ${missing.length} skill(s) missing canonical ## Steps/## Guardrails: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
    process.exit(1);
  }
  if (checkOnly) console.log("✓ every skill has canonical ## Guardrails (+ ## Steps where it has steps).");
  process.exit(0);
}

const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((err) => { console.error(err); process.exit(1); });
