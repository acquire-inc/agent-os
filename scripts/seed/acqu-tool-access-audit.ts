// scripts/seed/acqu-tool-access-audit.ts
// Seeds the `tool.access-audit` registry row for tenant Acqu — DATA ONLY.
//
// Read-only orphan-grant inventory. Filters lifecycle_state = 'archived'
// AND archived > 30 days (Pitfall 4 — respects Phase 8.5 non-destructive
// archive). Binds to access-auditor in 09-05.
import { createDb, schema } from "@agent-os/db";
import { ensureTool } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    tenantId: { type: "string", format: "uuid" },
  },
  required: ["tenantId"],
} as const;

export async function seedToolAccessAudit() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tool = await ensureTool(db, TENANT_ID, {
    key: "tool.access-audit",
    name: "Access Audit",
    kind: "custom",
    description:
      "Read-only orphan-grant inventory (filters archived agents >30d per Pitfall 4)",
    inputSchema: INPUT_SCHEMA,
    requiresApproval: false,
    reversible: true,
  });
  const [verify] = await db.select().from(schema.tools).where(eq(schema.tools.id, tool.id));
  console.log(`Seeded tool: ${verify!.key} (id=${verify!.id}) for tenant acqu`);
  console.log(`  kind              ${verify!.kind}`);
  console.log(`  requires_approval ${verify!.requiresApproval}`);
  console.log(`  bound agents      0 (binds in 09-05 to access-auditor)`);
  return verify!;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedToolAccessAudit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
