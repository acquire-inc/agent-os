// Pure unit tests for V2 P10 auto-onboarding (Viktor flow).
// Run: pnpm --filter @agent-os/core test:onboarding
import {
  composeArchitectPrompt,
  planOnboardingSteps,
  validateOnboardingInterview,
  type OnboardingInterview,
} from "./onboarding.js";

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

const iv = (overrides: Partial<OnboardingInterview> = {}): OnboardingInterview => ({
  companyName: "Northwind Marketing",
  description: "Performance marketing agency running Meta ads for DTC brands.",
  industry: "marketing, dtc",
  goals: "Cut wasted ad spend; improve ROAS by 15%; ship weekly briefings to clients.",
  connectorsInUse: ["pipeboard-meta", "slack", "close"],
  monthlyBudgetUsd: 500,
  craAcknowledgement: "confirmed_not_eligibility_decisioning",
  ...overrides,
});

async function main() {
  console.log("\n[validate — happy]");
  {
    const r = validateOnboardingInterview(iv());
    assert(r.ok, "valid interview accepted");
    assert(r.suggestedSlug === "northwind-marketing", "slug derived from company name");
  }

  console.log("\n[validate — required fields]");
  for (const drop of ["companyName", "description", "industry", "goals"] as const) {
    const v = iv();
    (v as unknown as Record<string, unknown>)[drop] = "";
    const r = validateOnboardingInterview(v);
    assert(!r.ok, `${drop} required → fail`);
  }
  {
    const r = validateOnboardingInterview(iv({ description: "too short" }));
    assert(!r.ok && r.reasons.some((m) => /at least 20/.test(m)), "short description rejected");
  }

  console.log("\n[validate — budget shape]");
  {
    const r = validateOnboardingInterview(iv({ monthlyBudgetUsd: -100 }));
    assert(!r.ok && r.reasons.some((m) => /non-negative/.test(m)), "negative budget rejected");
  }
  {
    const r = validateOnboardingInterview(iv({ monthlyBudgetUsd: NaN as unknown as number }));
    assert(!r.ok, "NaN budget rejected");
  }
  {
    const r = validateOnboardingInterview(iv({ monthlyBudgetUsd: null }));
    assert(r.ok, "null budget accepted (uncapped — operator review)");
  }

  console.log("\n[validate — slug shape]");
  {
    const r = validateOnboardingInterview(iv({ tenantSlug: "Has Capitals" }));
    assert(!r.ok && r.reasons.some((m) => /tenantSlug/.test(m)), "non-slug shape rejected");
  }
  {
    const r = validateOnboardingInterview(iv({ tenantSlug: "valid-slug" }));
    assert(r.ok, "valid slug accepted");
    assert(r.suggestedSlug === "valid-slug", "provided slug used as suggestion");
  }

  console.log("\n[validate — CRA pre-check]");
  {
    const r = validateOnboardingInterview(
      iv({
        description: "We do credit underwriting for buy-now-pay-later customers.",
        craAcknowledgement: "needs_review",
      }),
    );
    assert(!r.ok, "CRA territory + unconfirmed → fail");
    assert(r.reasons.some((m) => /CRA/i.test(m)), "rationale names CRA");
    assert(r.reasons.some((m) => /credit/.test(m)), "trigger keyword surfaced");
  }
  {
    const r = validateOnboardingInterview(
      iv({
        description: "We do credit underwriting for buy-now-pay-later customers.",
        craAcknowledgement: "confirmed_not_eligibility_decisioning",
      }),
    );
    assert(
      r.ok === true || r.reasons.every((m) => !/CRA/i.test(m)),
      "operator confirmation lifts the CRA pre-check (other validation still runs)",
    );
  }

  console.log("\n[composeArchitectPrompt — deterministic, complete shape]");
  {
    const p = composeArchitectPrompt(iv());
    assert(/# New tenant onboarding/.test(p), "block leads with header");
    assert(/Northwind Marketing/.test(p), "company name carried");
    assert(/## 90-day goals/.test(p), "section: 90-day goals");
    assert(/## Tools in use/.test(p), "section: tools");
    assert(/pipeboard-meta/.test(p), "connector listed");
    assert(/## Architect task/.test(p), "section: architect task");
    assert(/CRA/.test(p), "constraint mentions CRA");
    assert(/cant-fail/i.test(p), "constraint mentions cant-fail");
    assert(/execute_full/.test(p), "constraint excludes execute_full");
    assert(/\$500\.00/.test(p), "budget formatted");
  }
  {
    const p = composeArchitectPrompt(iv({ monthlyBudgetUsd: null }));
    assert(/uncapped/.test(p), "null budget rendered as 'uncapped — operator review'");
  }
  {
    const p = composeArchitectPrompt(iv({ connectorsInUse: [] }));
    assert(/none specified yet/.test(p), "empty connectors rendered with guidance");
  }
  // Determinism check.
  {
    const a = composeArchitectPrompt(iv());
    const b = composeArchitectPrompt(iv());
    assert(a === b, "deterministic — same input, same string");
  }

  console.log("\n[planOnboardingSteps — ordered checklist]");
  {
    const steps = planOnboardingSteps(iv());
    assert(steps[0]!.kind === "validate_interview", "first step is validate");
    assert(steps.some((s) => s.kind === "architect_propose"), "includes architect propose");
    assert(steps.some((s) => s.kind === "operator_review_blueprint" && s.humanGated), "operator review is human-gated");
    assert(steps.some((s) => s.kind === "enable_runners" && s.humanGated), "enabling runners is human-gated");
    assert(steps[steps.length - 1]!.kind === "post_onboarding_health_check", "last step is health check");
  }
  {
    // Empty connectors marks seed_baseline_mcps as human-gated (operator must specify).
    const steps = planOnboardingSteps(iv({ connectorsInUse: [] }));
    const mcpStep = steps.find((s) => s.kind === "seed_baseline_mcps")!;
    assert(mcpStep.humanGated, "empty connectors → mcp seed step is human-gated");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
