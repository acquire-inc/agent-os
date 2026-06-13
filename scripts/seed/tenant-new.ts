// Provision a brand new tenant from an onboarding interview.
//
// Usage:
//   DATABASE_URL=... pnpm tenant:new --file ./interview.json
//   DATABASE_URL=... pnpm tenant:new --json '{"companyName":...}'
//
// The interview JSON shape is OnboardingInterview from @agent-os/core.
// This script walks the planOnboardingSteps() side-effect list:
//   1. validate_interview (auto)
//   2. create_tenant (auto)
//   3. seed_baseline_skills (auto, no-op for now — operator runs seed:phase-1)
//   4. seed_baseline_mcps (auto when connectors specified; otherwise skipped
//      with a note to run seed scripts manually)
//   5. architect_propose (PRINTS the Architect prompt — operator runs the
//      /architect endpoint with that prompt to generate a blueprint)
//   6. operator_review_blueprint (human-gated — operator reviews in the UI)
//   7. seed_blueprint (operator runs after review)
//   8. enable_runners (human-gated — operator enables one at a time)
//   9. post_onboarding_health_check (PRINTS the command to run)
//
// The script is conservative: it creates the tenant row and exits with
// clear next-step instructions. Side effects beyond tenant creation
// (architect call, blueprint seed, agent enable) are HUMAN-GATED in the
// onboarding doctrine and stay that way.

import { readFileSync } from "node:fs";
import { exit, argv } from "node:process";
import {
  composeOnboardingArchitectPrompt,
  planOnboardingSteps,
  validateOnboardingInterview,
  type OnboardingInterview,
} from "@agent-os/core";
import { createDb, schema } from "@agent-os/db";

function parseArgs(): OnboardingInterview {
  const fileIdx = argv.indexOf("--file");
  const jsonIdx = argv.indexOf("--json");
  let raw: string | null = null;
  if (fileIdx > -1 && argv[fileIdx + 1]) {
    raw = readFileSync(argv[fileIdx + 1]!, "utf-8");
  } else if (jsonIdx > -1 && argv[jsonIdx + 1]) {
    raw = argv[jsonIdx + 1]!;
  }
  if (!raw) {
    console.error("Usage: pnpm tenant:new --file ./interview.json | --json '<inline json>'");
    exit(2);
  }
  return JSON.parse(raw) as OnboardingInterview;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    exit(2);
  }

  const iv = parseArgs();
  const validation = validateOnboardingInterview(iv);
  if (!validation.ok) {
    console.error("Interview rejected:");
    for (const r of validation.reasons) console.error(`  • ${r}`);
    exit(1);
  }
  const slug = iv.tenantSlug ?? validation.suggestedSlug!;
  console.log("");
  console.log(`▸ Onboarding "${iv.companyName}" (slug: ${slug})`);
  console.log("");

  const db = createDb(url);

  // Step: create_tenant.
  console.log("▸ Step 2/9: create_tenant");
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: iv.companyName,
      slug,
      type: "external",
      status: "active",
      monthlyBudgetUsd: iv.monthlyBudgetUsd != null ? String(iv.monthlyBudgetUsd) : null,
    })
    .returning({ id: schema.tenants.id, slug: schema.tenants.slug });
  console.log(`  ✓ tenant created: ${tenant!.id}`);
  console.log("");

  // Step: baseline_skills + baseline_mcps — operator-runs.
  console.log("▸ Step 3/9: seed_baseline_skills");
  console.log(`  → run: pnpm seed:phase-1  (after this script, with TENANT_ID=${tenant!.id})`);
  console.log("");
  console.log("▸ Step 4/9: seed_baseline_mcps");
  if (iv.connectorsInUse.length === 0) {
    console.log("  ⚠ no connectors specified — operator should add via UI / API before seeding agents");
  } else {
    console.log(`  → connectors to add (UI Connectors tab): ${iv.connectorsInUse.join(", ")}`);
  }
  console.log("");

  // Step: architect_propose — emit the prompt; operator runs the architect.
  console.log("▸ Step 5/9: architect_propose");
  console.log("  → Run the Architect with the following prompt:");
  console.log("");
  console.log("─────── Architect prompt ───────");
  console.log(composeOnboardingArchitectPrompt(iv));
  console.log("────────────────────────────────");
  console.log("");
  console.log("  Example call:");
  console.log(`    curl -X POST $AOS_BASE_URL/api/admin/architect/propose \\`);
  console.log(`      -H "Authorization: Bearer $AOS_ADMIN_KEY" \\`);
  console.log(`      -H "content-type: application/json" \\`);
  console.log(`      -d '{ "prompt": "<above prompt>", "mode": "team" }'`);
  console.log("");

  // Steps 6-9: human-gated.
  console.log("▸ Step 6/9: operator_review_blueprint — HUMAN");
  console.log("  → /architect UI to review warnings (overlap, CRA, model picks)");
  console.log("");
  console.log("▸ Step 7/9: seed_blueprint");
  console.log("  → POST /api/admin/architect/seed { blueprintId } after review");
  console.log("");
  console.log("▸ Step 8/9: enable_runners — HUMAN");
  console.log("  → flip enabled=true one at a time after first dry-run");
  console.log("");
  console.log("▸ Step 9/9: post_onboarding_health_check");
  console.log("  → run: pnpm launch:check");
  console.log("");

  // Summary.
  const steps = planOnboardingSteps(iv);
  const autoCount = steps.filter((s) => !s.humanGated).length;
  const humanCount = steps.filter((s) => s.humanGated).length;
  console.log(`✓ Tenant provisioned. ${autoCount} auto step(s) + ${humanCount} human-gated step(s) remaining.`);
  console.log(`  Tenant ID: ${tenant!.id}`);
  console.log(`  Slug:      ${slug}`);
  console.log("");

  exit(0);
}

main().catch((err) => {
  console.error("tenant:new failed:", err);
  exit(1);
});
