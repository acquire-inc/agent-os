// scripts/seed/acqu-tool-rls-test.ts
// Seeds the `tool.rls-test` registry row for tenant Acqu — DATA ONLY.
//
// Seeded UNBOUND. The Phase-9 `tenant-isolation-tester` agent (seeded in
// plan 09-05) binds it via AgentSpec.tools. Read-only attack surface — no
// approval required (false-pass is detected by positive controls in
// attack-vectors.ts, Pitfall 5).
import { createDb, schema } from "@agent-os/db";
import { ensureTool } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

// Mirrors packages/tool-rls-test/src/types.ts IsolationInputSchema.
const INPUT_SCHEMA = {
  type: "object",
  properties: {
    tenantPairs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          userA: { type: "string", format: "uuid" },
          userB: { type: "string", format: "uuid" },
          tenantA: { type: "string", format: "uuid" },
          tenantB: { type: "string", format: "uuid" },
        },
        required: ["userA", "userB", "tenantA", "tenantB"],
      },
    },
    tables: { type: "array", items: { type: "string" } },
  },
  required: ["tenantPairs"],
} as const;

export async function seedToolRlsTest() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tool = await ensureTool(db, TENANT_ID, {
    key: "tool.rls-test",
    name: "RLS Test Suite",
    kind: "custom",
    description:
      "Cross-tenant query attack suite with append-only vector registry and positive controls (Pitfall 5 mitigation)",
    inputSchema: INPUT_SCHEMA,
    requiresApproval: false,
    reversible: true,
  });
  const [verify] = await db.select().from(schema.tools).where(eq(schema.tools.id, tool.id));
  console.log(`Seeded tool: ${verify!.key} (id=${verify!.id}) for tenant acqu`);
  console.log(`  kind              ${verify!.kind}`);
  console.log(`  requires_approval ${verify!.requiresApproval}`);
  console.log(`  bound agents      0 (binds in 09-05 to tenant-isolation-tester)`);
  return verify!;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedToolRlsTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
