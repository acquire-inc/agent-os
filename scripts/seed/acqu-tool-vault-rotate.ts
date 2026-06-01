// scripts/seed/acqu-tool-vault-rotate.ts
// Seeds the `tool.vault-rotate` registry row for tenant Acqu — DATA ONLY.
//
// CRITICAL INVARIANT: requiresApproval=true. Per doctrine v2 D5.3 L1254 +
// Phase-9 D-03, client OAuth credentials NEVER rotate unilaterally —
// rotation goes through the PreToolUse approval gate (hook 1c). Any PR
// flipping this flag to false must be rejected. The secrets-rotation
// agent (seeded in 09-05) is T-critical and inherits this gate.
import { createDb, schema } from "@agent-os/db";
import { ensureTool } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    mcpId: { type: "string", format: "uuid" },
    provider: { type: "string", enum: ["close", "meta", "stripe"] },
  },
  required: ["mcpId", "provider"],
} as const;

export async function seedToolVaultRotate() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tool = await ensureTool(db, TENANT_ID, {
    key: "tool.vault-rotate",
    name: "Vault Rotate",
    kind: "custom",
    description:
      "OAuth credential rotation — propose-gated per doctrine v2 D5.3 L1254 (client creds never rotate unilaterally)",
    inputSchema: INPUT_SCHEMA,
    // D-03 invariant — DO NOT flip to false. PreToolUse hook enforces approval.
    requiresApproval: true,
    reversible: false,
  });
  const [verify] = await db.select().from(schema.tools).where(eq(schema.tools.id, tool.id));
  console.log(`Seeded tool: ${verify!.key} (id=${verify!.id}) for tenant acqu`);
  console.log(`  kind              ${verify!.kind}`);
  console.log(`  requires_approval ${verify!.requiresApproval}  ← D-03 invariant`);
  console.log(`  bound agents      0 (binds in 09-05 to secrets-rotation, T-critical)`);
  return verify!;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedToolVaultRotate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
