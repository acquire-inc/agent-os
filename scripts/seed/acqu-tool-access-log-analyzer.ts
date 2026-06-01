// scripts/seed/acqu-tool-access-log-analyzer.ts
// Seeds the `tool.access-log-analyzer` registry row for tenant Acqu — DATA ONLY.
//
// Read-only 24h-rolling usage anomaly scan over audit_log. Pitfall 3
// mitigation lives in the SQL itself (24h current window + 8d→1d baseline
// + absolute floor n>10 + 5× ratio). Binds to security-anomaly-watchdog
// in 09-05.
import { createDb, schema } from "@agent-os/db";
import { ensureTool } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    tenantId: { type: "string", format: "uuid" },
    hours: { type: "integer", minimum: 1, maximum: 168 },
  },
  required: ["tenantId"],
} as const;

export async function seedToolAccessLogAnalyzer() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tool = await ensureTool(db, TENANT_ID, {
    key: "tool.access-log-analyzer",
    name: "Access Log Analyzer",
    kind: "custom",
    description:
      "Read-only 24h-rolling usage anomaly scan over audit_log + autonomy_events",
    inputSchema: INPUT_SCHEMA,
    requiresApproval: false,
    reversible: true,
  });
  const [verify] = await db.select().from(schema.tools).where(eq(schema.tools.id, tool.id));
  console.log(`Seeded tool: ${verify!.key} (id=${verify!.id}) for tenant acqu`);
  console.log(`  kind              ${verify!.kind}`);
  console.log(`  requires_approval ${verify!.requiresApproval}`);
  console.log(`  bound agents      0 (binds in 09-05 to security-anomaly-watchdog)`);
  return verify!;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedToolAccessLogAnalyzer()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
