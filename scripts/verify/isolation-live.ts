// scripts/verify/isolation-live.ts
//
// HARD GATE #2 verification — run AFTER seed-phase-9 against a live Supabase
// with ≥2 tenants. Per main §6 + CLAUDE.md non-negotiable #5: no external
// launch until tool.rls-test runs against the live data plane and reports
// ZERO cross-tenant leaks.
//
// D-01: RLS_TEST_DATABASE_URL MUST be a Supabase `authenticated`-role
// connection string. Service-role bypasses RLS by design and produces a
// false-pass on every vector. The hard-fail-if-unset check below catches
// the most common misconfiguration; the operator must also visually
// confirm the connection role (the verbatim runbook in
// docs/acqu-phase-9-agent-manifest.md walks the steps).

import { createDb } from "@agent-os/db";
import { runIsolationSuite } from "@agent-os/tool-rls-test";
import { TENANT_IDS } from "@agent-os/shared";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required (general ops connection)");
  }
  if (!process.env.RLS_TEST_DATABASE_URL) {
    throw new Error(
      "RLS_TEST_DATABASE_URL required (D-01 — must be a non-service-role authenticated connection; service-role bypasses RLS and would produce a silent false-pass on every vector)",
    );
  }
  const userA = process.env.RLS_TEST_USER_A;
  const userB = process.env.RLS_TEST_USER_B;
  if (!userA || !userB) {
    throw new Error(
      "RLS_TEST_USER_A and RLS_TEST_USER_B required — user UUIDs from auth.users; A must be a member of tenants.acqu and B must be a member of tenants.cliently",
    );
  }

  const db = createDb(process.env.RLS_TEST_DATABASE_URL);

  // Test BOTH directions: A reads B (expect 0) AND B reads A (expect 0).
  // Asymmetry catches policies that protect one direction but not the other.
  const tenantPairs = [
    { tenantA: TENANT_IDS.acqu, tenantB: TENANT_IDS.cliently, userA, userB },
    { tenantA: TENANT_IDS.cliently, tenantB: TENANT_IDS.acqu, userA: userB, userB: userA },
  ];

  console.log("▸ HARD GATE #2 — running tool.rls-test against live Supabase");
  console.log(`  tenantPairs: ${tenantPairs.length} (both directions)`);
  console.log("");

  const result = await runIsolationSuite({ tenantPairs }, { db });

  console.log("");
  console.log(`HARD GATE: passed=${result.passed} count=${result.count} resultsPath=${result.resultsPath}`);

  if (!result.passed) {
    console.error("HARD GATE FAILED — external launch blocked per main §6.");
    console.error(`Inspect ${result.resultsPath} for vectors with actual > 0; each is a cross-tenant leak.`);
    process.exit(1);
  }

  console.log("HARD GATE PASSED — Phase 10 unblocked.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
