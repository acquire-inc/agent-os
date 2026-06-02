// scripts/seed/author-allowed-tools.ts — one-time/idempotent authoring of skill→allowed-tools
// least-privilege (Phase 9, 09-03). Fills a sensible `allowed-tools:` frontmatter list into every
// SKILL.md that lacks one; NEVER overwrites an existing declaration (same contract as
// authorPrimarySkill). The lists are inferred from the skill's name/key by domain keyword, always
// including the universal infra tools every skill legitimately uses (knowledge read + run-summary).
//
// allowed-tools is currently surfaced on bundle.skills[].allowedTools (not yet enforced), so this
// is safe to populate — it operationalizes least-privilege ahead of enforcement. Run:
//   pnpm --filter @agent-os/seed exec tsx author-allowed-tools.ts          (writes)
//   pnpm --filter @agent-os/seed exec tsx author-allowed-tools.ts --check  (CI: fail if any missing)
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_TOOLS } from "./_tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(here, "..", "..", "external", "acqu-skills");

// Every skill reads knowledge (tool.21) and writes its run-summary (tool.22).
const BASE = ["tool.21", "tool.22"];

// Domain keyword → tools the skill's workflow may call. A skill unions all matching rows.
// Matched against `${key} ${name}` lowercased. Order-independent.
const RULES: { re: RegExp; tools: string[] }[] = [
  { re: /\bad(s|-)|creative|campaign|pixel|meta|launch|swipe|ugc/, tools: ["tool.1", "tool.4", "tool.6", "tool.7", "tool.20"] },
  { re: /launch|arcads/, tools: ["tool.2", "tool.arcads-launcher"] },
  { re: /vitals|brief|report|dashboard|metric|snapshot/, tools: ["tool.1", "tool.18", "tool.17"] },
  { re: /dunning|billing|collections|invoice|overdue/, tools: ["tool.billing-engine", "tool.dunning-engine", "tool.ar-ledger", "tool.18"] },
  { re: /expense|spend|bookkeep|payable/, tools: ["tool.expense-feed", "tool.bill-pay-bridge"] },
  { re: /margin|unit-econ|forecast|cash|revenue|reinvest|treasury|budget|econom/, tools: ["tool.unit-economics-engine", "tool.forecast-model", "tool.revenue-ledger", "tool.cash-feed"] },
  { re: /contract/, tools: ["tool.contract-engine", "tool.contract-tracker"] },
  { re: /pricing|discount|offer|packaging/, tools: ["tool.price-book", "tool.pricing-recommender-engine", "tool.offer-registry"] },
  { re: /lead|sales|deal|proposal|discovery|objection|qualif/, tools: ["tool.18", "tool.deal-desk", "tool.discovery-brief", "tool.objection-knowledge"] },
  { re: /client|churn|onboard|success|qbr|save|loyal|retention/, tools: ["tool.client-health-score", "tool.churn-signal-engine", "tool.onboarding-orchestrator", "tool.18"] },
  { re: /connector|health|integration|rate-limit/, tools: ["tool.connector-healthcheck", "tool.rate-limit-tracker"] },
  { re: /security|access|audit|isolation|vault|anomaly/, tools: ["tool.vault-auditor", "tool.access-log-analyzer", "tool.isolation-test-suite"] },
  { re: /dev|deploy|code|release|incident|error|reliab|e2e|test/, tools: ["tool.deploy-bridge", "tool.code-review-bot", "tool.error-watch", "tool.incident-log"] },
  { re: /agent|workforce|eval|fleet|skill|portfolio/, tools: ["tool.agent-registry", "tool.agent-eval-suite", "tool.agent-performance-tracker"] },
  { re: /content|video|transcript|brand|social|engine/, tools: ["tool.content-calendar", "tool.transcript-to-content", "tool.video-clip-finder"] },
  { re: /competitor|market|scout|vertical|partner|teardown/, tools: ["tool.competitor-radar", "tool.competitor-offer-scraper", "tool.partner-registry"] },
  { re: /comms|approval|notify|slack|clarify/, tools: ["tool.17"] },
  { re: /memory|consolidat|playbook|win-detection|capture/, tools: ["tool.memory-consolidation-engine", "tool.save-play-library"] },
  { re: /meeting|calendar|schedul/, tools: ["tool.calendar-bridge"] },
  { re: /risk|compliance|decision|memo/, tools: ["tool.risk-register", "tool.compliance-ruleset"] },
];

/** Infer a least-privilege allowed-tools list for a skill from its key + name. */
export function inferAllowedTools(key: string, name: string): string[] {
  const hay = `${key} ${name}`.toLowerCase();
  const out = new Set<string>(BASE);
  for (const { re, tools } of RULES) if (re.test(hay)) for (const t of tools) out.add(t);
  // Safety: only emit tools that exist in the catalog (or are universal infra).
  return [...out].filter((t) => KNOWN_TOOLS[t] || BASE.includes(t)).sort();
}

function parseFrontmatter(md: string): { lines: string[]; open: number; close: number } | null {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const close = lines.indexOf("---", 1);
  return close === -1 ? null : { lines, open: 0, close };
}

function field(lines: string[], close: number, key: string): string {
  for (let i = 1; i < close; i++) {
    const m = lines[i]!.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (m) return m[1]!.trim();
  }
  return "";
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const dirs = (await readdir(SKILLS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  let authored = 0;
  let already = 0;
  const missing: string[] = [];

  for (const d of dirs) {
    const file = join(SKILLS_DIR, d.name, "SKILL.md");
    let md: string;
    try { md = await readFile(file, "utf8"); } catch { continue; }
    const fm = parseFrontmatter(md);
    if (!fm) { missing.push(`${d.name} (no frontmatter)`); continue; }
    const { lines, close } = fm;

    if (lines.slice(1, close).some((l) => /^allowed-tools:/.test(l))) { already++; continue; }

    if (checkOnly) { missing.push(d.name); continue; }

    const name = field(lines, close, "name") || d.name;
    const tools = inferAllowedTools(d.name, name);
    lines.splice(close, 0, `allowed-tools: [${tools.join(", ")}]`);
    await writeFile(file, lines.join("\n"));
    authored++;
  }

  console.log(`Skills: ${dirs.length} | already had allowed-tools: ${already} | authored: ${authored}`);
  if (checkOnly && missing.length) {
    console.error(`✗ ${missing.length} skill(s) missing allowed-tools: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (checkOnly) console.log("✓ every skill declares allowed-tools.");
  process.exit(0);
}

const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((err) => { console.error(err); process.exit(1); });
