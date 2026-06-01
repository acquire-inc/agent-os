// security/access-audit.test.ts — captures the rendered SQL via a mock
// db.execute and asserts the Pitfall 4 mitigation clauses are present.
// Run: pnpm --filter @agent-os/core run test:security

import { findOrphanedGrants } from "./access-audit.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

/** Stub Db that captures the rendered SQL fragments + params from db.execute. */
function makeCaptureDb() {
  const captured: { text: string; params: unknown[] } = { text: "", params: [] };
  const db = {
    execute: async (q: { queryChunks?: unknown[]; getSQL?: () => unknown }) => {
      // drizzle sql tagged templates expose a SQL token tree via `.queryChunks`;
      // we don't need to render to vendor dialect — concatenating string parts
      // and counting parameters gives enough signal to assert filter clauses.
      const chunks = (q.queryChunks ?? []) as Array<{ value?: string[] } | unknown>;
      let text = "";
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === "object" && "value" in c && Array.isArray((c as { value: string[] }).value)) {
          text += (c as { value: string[] }).value.join("");
        } else {
          params.push(c);
        }
      }
      captured.text = text;
      captured.params = params;
      return { rows: [] } as unknown as never;
    },
  } as unknown as Parameters<typeof findOrphanedGrants>[0];
  return { db, captured };
}

async function main() {
  console.log("• findOrphanedGrants surface");
  assert(typeof findOrphanedGrants === "function", "findOrphanedGrants is a function");

  console.log("• findOrphanedGrants — rendered SQL encodes Pitfall 4 mitigation");
  const { db, captured } = makeCaptureDb();
  await findOrphanedGrants(db, "00000000-0000-0000-0000-000000000000");
  assert(
    captured.text.includes("lifecycle_state = 'archived'"),
    "filters lifecycle_state = 'archived'",
  );
  assert(
    captured.text.includes("interval '30 days'"),
    "filters archived > 30 days (Pitfall 4)",
  );
  assert(
    /from\s+oauth_credentials\s+oc/.test(captured.text),
    "reads from oauth_credentials oc",
  );
  assert(
    /join\s+agents\s+a/.test(captured.text),
    "joins agents (lifecycle_state source)",
  );
  assert(
    captured.text.includes("oc.tenant_id ="),
    "tenant-scoped (oc.tenant_id ='d via param)",
  );

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
