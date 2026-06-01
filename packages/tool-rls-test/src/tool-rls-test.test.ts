// Static surface tests for @agent-os/tool-rls-test. No live DB.
// Live RLS verification lives in scripts/verify/isolation-live.ts (plan 09-06).
// Run: pnpm --filter @agent-os/tool-rls-test test

import {
  ATTACK_VECTORS,
  IsolationInputSchema,
  REGISTERED_COUNT_FLOOR,
  assertVectorsAppendOnly,
  runIsolationSuite,
} from "./index.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  console.log("• Zod input schema");
  const validParse = IsolationInputSchema.safeParse({
    tenantPairs: [{
      userA: "11111111-1111-1111-1111-111111111111",
      userB: "22222222-2222-2222-2222-222222222222",
      tenantA: "33333333-3333-3333-3333-333333333333",
      tenantB: "44444444-4444-4444-4444-444444444444",
    }],
  });
  assert(validParse.success, "accepts valid input shape");

  const emptyParse = IsolationInputSchema.safeParse({ tenantPairs: [] });
  assert(!emptyParse.success, "rejects empty tenantPairs (min 1)");

  const badUuid = IsolationInputSchema.safeParse({
    tenantPairs: [{ userA: "not-a-uuid", userB: "x", tenantA: "y", tenantB: "z" }],
  });
  assert(!badUuid.success, "rejects non-UUID identifiers");

  console.log("• ATTACK_VECTORS registry");
  assert(Object.isFrozen(ATTACK_VECTORS), "ATTACK_VECTORS is frozen");
  assert(ATTACK_VECTORS.length >= 20, `>= 20 vectors registered (have ${ATTACK_VECTORS.length})`);
  assert(REGISTERED_COUNT_FLOOR === ATTACK_VECTORS.length, "registered count floor matches length at load");

  const ids = ATTACK_VECTORS.map((v) => v.id);
  const idsUnique = new Set(ids).size === ids.length;
  assert(idsUnique, "all vector IDs unique");

  const idsFormat = ids.every((id) => /^AV-\d{3}$/.test(id));
  assert(idsFormat, "all vector IDs match AV-NNN format");

  console.log("• Append-only enforcement");
  // The function should NOT throw on the current registry (it matches the floor).
  let ok = true;
  try { assertVectorsAppendOnly(); } catch { ok = false; }
  assert(ok, "assertVectorsAppendOnly doesn't throw on the current registry");

  console.log("• runIsolationSuite surface");
  assert(typeof runIsolationSuite === "function", "runIsolationSuite is exported as a function");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
