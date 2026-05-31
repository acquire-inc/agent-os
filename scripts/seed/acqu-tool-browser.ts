// scripts/seed/acqu-tool-browser.ts
// Seeds the `tool.browser` registry row for tenant Acqu — DATA ONLY.
//
// Per 07-RESEARCH Open Question 1, the row is seeded UNBOUND: no agent binding
// in Phase 7. The first real consumer (Phase 8, e.g. creative-miner) adds the
// binding via its own AgentSpec.tools field. requiresApproval=true is the
// deny-by-default safety posture (the PreToolUse autonomy gate enforces it).
import { createDb, schema } from "@agent-os/db";
import { ensureTool } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

// Hand-written JSON Schema — mirrors packages/tool-browser/src/types.ts
// BrowserToolInputSchema. Avoids a zod-to-json-schema dep for one row.
const INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", format: "uri" },
    instruction: { type: "string", minLength: 1 },
    extractSchema: { type: "object" },
  },
  required: ["url", "instruction"],
} as const;

export async function seedToolBrowser() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tool = await ensureTool(db, TENANT_ID, {
    key: "tool.browser",
    name: "Browser",
    kind: "custom",
    description: "Headless web automation (SSRF-guarded; Browserbase + Stagehand backend lands in Phase 8)",
    inputSchema: INPUT_SCHEMA,
    requiresApproval: true,
    reversible: false,
  });
  const [verify] = await db.select().from(schema.tools).where(eq(schema.tools.id, tool.id));
  console.log(`Seeded tool: ${verify!.key} (id=${verify!.id}) for tenant acqu`);
  console.log(`  kind              ${verify!.kind}`);
  console.log(`  requires_approval ${verify!.requiresApproval}`);
  console.log(`  bound agents      0 (unbound — first consumer binds in Phase 8, RESEARCH OQ1)`);
  return verify!;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedToolBrowser()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
