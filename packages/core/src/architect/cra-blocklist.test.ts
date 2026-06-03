// CRA prohibition blocklist tests.
// Run: pnpm --filter @agent-os/core test:cra

import {
  CRA_CATEGORIES,
  CRA_KEYWORDS,
  CraProhibitionError,
  assertNotCraProhibited,
  checkCraProhibition,
  type CraCategory,
} from "./cra-blocklist.js";
import { hydrate, type ResolverContext } from "./hydrate.js";
import type { TeamBlueprintProposal } from "./types.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const TENANT = "11111111-1111-1111-1111-111111111111";

// One known-bad sample per category — must trigger the predicate.
const KNOWN_BAD: Record<CraCategory, string> = {
  credit: "Decide credit eligibility for incoming loan applicants based on bureau data.",
  employment: "Run employment screening on each candidate and flag those who fail the eligibility bar.",
  housing: "Review every rental application and produce a tenant screening recommendation.",
  insurance: "Perform insurance underwriting to assign each policy applicant a risk class.",
  "government-benefit":
    "Determine benefit eligibility for SNAP applicants based on submitted documents.",
};

// Lookalike phrases that mention the domain in NON-eligibility contexts —
// must NOT trigger.
const KNOWN_GOOD: string[] = [
  "Credit the customer's deposit to the right ledger account each morning.",
  "Track employment history for the company directory page.",
  "Update the tenant's contact info in the CRM when they email.",
  "Draft an insurance reminder email when a renewal is upcoming.",
  "Watch government regulatory feeds for new ad-claim guidance.",
];

async function main() {
  console.log("• Group 1 — every category has at least 5 trigger keywords");
  for (const cat of CRA_CATEGORIES) {
    assert(
      CRA_KEYWORDS[cat].length >= 5,
      `category ${cat} has >= 5 keywords (actual: ${CRA_KEYWORDS[cat].length})`,
    );
  }

  console.log("\n• Group 2 — known-bad samples trigger per category");
  for (const cat of CRA_CATEGORIES) {
    const result = checkCraProhibition(KNOWN_BAD[cat]);
    assert(result.prohibited === true, `${cat}: known-bad sample is prohibited`);
    assert(result.category === cat, `${cat}: matched category is ${cat}`);
    assert(
      result.matchedKeyword !== null && CRA_KEYWORDS[cat].includes(result.matchedKeyword),
      `${cat}: matched keyword is in the bank`,
    );
  }

  console.log("\n• Group 3 — known-good samples do NOT trigger (lookalike protection)");
  for (let i = 0; i < KNOWN_GOOD.length; i++) {
    const result = checkCraProhibition(KNOWN_GOOD[i]!);
    assert(
      result.prohibited === false,
      `lookalike #${i + 1} is NOT prohibited: "${KNOWN_GOOD[i]!.slice(0, 50)}..."`,
    );
  }

  console.log("\n• Group 4 — assertNotCraProhibited throws CraProhibitionError on match");
  try {
    assertNotCraProhibited(KNOWN_BAD.credit, "test:credit");
    failed++;
    console.error(`  ✗ assertNotCraProhibited should have thrown on KNOWN_BAD.credit`);
  } catch (e) {
    assert(e instanceof CraProhibitionError, "thrown error is CraProhibitionError");
    const cra = e as CraProhibitionError;
    assert(cra.category === "credit", "thrown error.category is credit");
    assert(cra.source === "test:credit", "thrown error.source is test:credit");
    assert(
      cra.matchedKeyword.length > 0,
      `thrown error.matchedKeyword is populated (${cra.matchedKeyword})`,
    );
  }

  console.log("\n• Group 5 — assertNotCraProhibited does NOT throw on clean text");
  try {
    assertNotCraProhibited(KNOWN_GOOD[0]!, "test:clean");
    assert(true, "clean text does not throw");
  } catch (e) {
    failed++;
    console.error(`  ✗ clean text threw unexpectedly: ${(e as Error).message}`);
  }

  console.log("\n• Group 6 — hydrate() refuses a CRA-touching blueprint");
  const proposal: TeamBlueprintProposal = {
    teamName: "Test Team",
    rationale: "single agent, CRA-touching for refusal test",
    agents: [
      {
        key: "loan-eligibility-screener",
        name: "Loan Eligibility Screener",
        role: "Decide credit eligibility for incoming loan applicants based on bureau data.",
        systemPrompt: "Score each applicant against the underwriting rubric.",
        model: "nousresearch/hermes-4-70b",
        thinkingLevel: "low",
        autonomy: "propose",
        knowledgeScope: { folders: [], tags: [] },
        budgetCapUsd: "0.10",
        cron: null,
        skillKeys: [],
        mcpNames: [],
      },
    ],
    proposedSkills: [],
    proposedMcps: [],
  };
  const ctx: ResolverContext = {
    knownSkillKeys: new Set(),
    knownMcpNames: new Set(),
  };
  const out = hydrate(TENANT, proposal, ctx);
  assert(out.agents.length === 0, "hydrate refused the CRA-touching blueprint");
  assert(
    out.warnings.some((w) => w.includes("CRA-prohibited")),
    "warning mentions CRA-prohibited",
  );
  assert(
    out.warnings.some((w) => w.includes("credit")),
    "warning names matched category (credit)",
  );
  assert(
    out.warnings.some((w) => w.includes("loan-eligibility-screener")),
    "warning names the refused blueprint key",
  );

  console.log("\n• Group 7 — hydrate() does NOT refuse a benign blueprint that mentions credit");
  const benignProposal: TeamBlueprintProposal = {
    teamName: "AR Team",
    rationale: "single agent, benign 'credit' usage (ledger ops)",
    agents: [
      {
        key: "ar-ledger-reconciler",
        name: "AR Ledger Reconciler",
        role: "Credit the customer's deposit to the right ledger account each morning.",
        systemPrompt: "Watch the deposits queue and write entries to the correct account.",
        model: "nousresearch/hermes-4-70b",
        thinkingLevel: "low",
        autonomy: "propose",
        knowledgeScope: { folders: [], tags: [] },
        budgetCapUsd: "0.10",
        cron: null,
        skillKeys: [],
        mcpNames: [],
      },
    ],
    proposedSkills: [],
    proposedMcps: [],
  };
  const benignOut = hydrate(TENANT, benignProposal, ctx);
  assert(benignOut.agents.length === 1, "benign blueprint hydrates to one spec");
  assert(
    !benignOut.warnings.some((w) => w.includes("CRA-prohibited")),
    "no CRA-prohibited warning on benign blueprint",
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("unexpected:", e);
  process.exit(1);
});
