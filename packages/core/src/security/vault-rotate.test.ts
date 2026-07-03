// security/vault-rotate.test.ts — unit tests with mock db.
// No live DB, no live HTTP. Run: pnpm --filter @agent-os/core run test:security
//
// Note: test:security runs the *.test.ts pattern, so this file is auto-included.

import { metaRefresher, stripeRefresher } from "./refreshers/stubs.js";
import { rotateCredential } from "./vault-rotate.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
async function assertRejects(fn: () => Promise<unknown>, match: string, msg: string) {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${msg} — expected throw, resolved`);
  } catch (e) {
    if ((e as Error).message.includes(match)) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg} — wrong error: ${(e as Error).message}`);
    }
  }
}

/** Minimal stub of Drizzle's chainable select surface for the no-expiry path.
 *  rotateCredential's only DB read is .select().from(...).where(...).limit(1). */
function mockDb(row: Record<string, unknown> | null) {
  const result = row ? [row] : [];
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => result,
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: "stub" }] }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  } as unknown as Parameters<typeof rotateCredential>[0];
}

async function main() {
  console.log("• rotateCredential surface");
  assert(typeof rotateCredential === "function", "rotateCredential is a function");

  console.log("• rotateCredential — no credential row → not rotated");
  const noCred = await rotateCredential(mockDb(null), Buffer.alloc(32), "mcp-1", async () => null, "t1");
  assert(noCred.rotated === false, "returns rotated: false");
  assert(noCred.reason === "no credential for mcpId", "reports no-credential reason");

  console.log("• rotateCredential — no expiresAt → manual rotation required");
  const noExpiry = await rotateCredential(
    mockDb({
      id: "c1",
      tenantId: "t1",
      mcpId: "mcp-1",
      vaultRef: "vault-blob",
      scopes: [],
      expiresAt: null,
    }),
    Buffer.alloc(32),
    "mcp-1",
    async () => null,
    "t1",
  );
  assert(noExpiry.rotated === false, "returns rotated: false");
  assert(noExpiry.reason?.includes("manual provider rotation"), "reports manual-rotation reason");

  console.log("• Meta + Stripe stubs throw fail-closed (D-03)");
  await assertRejects(() => metaRefresher("token"), "operator: implement", "metaRefresher throws expected error");
  await assertRejects(() => stripeRefresher("token"), "operator: implement", "stripeRefresher throws expected error");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
