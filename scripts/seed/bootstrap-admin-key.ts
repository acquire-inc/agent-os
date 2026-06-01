// scripts/seed/bootstrap-admin-key.ts
// Mint the FIRST admin API key for a fresh deploy. This is the one privileged operation that
// can't go through the API — every /api/* route requires a key, and POST /api/admin/keys itself
// requires an admin key, so a fresh DB has no way to bootstrap. This script writes the first key
// directly (it runs with DB access, the trust boundary the API key would otherwise prove).
//
// Idempotent-ish: a deploy should have exactly one bootstrap admin key. If one already exists
// (by name), we DON'T print a new secret (the hash is one-way — the raw is unrecoverable); pass
// --force to mint an additional one. After this, mint all further keys via POST /api/admin/keys.
//
// Usage:
//   DATABASE_URL=... pnpm tsx scripts/seed/bootstrap-admin-key.ts            # mint if absent
//   DATABASE_URL=... pnpm tsx scripts/seed/bootstrap-admin-key.ts --force    # always mint a new one
//   DATABASE_URL=... pnpm tsx scripts/seed/bootstrap-admin-key.ts --runner   # also mint a runner key

import { createApiKey } from "@agent-os/core";
import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS, DEMO_USER_ID } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";

const BOOTSTRAP_NAME = "bootstrap-admin";
const RUNNER_NAME = "bootstrap-runner";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tenantId = TENANT_IDS.acqu;
  const force = process.argv.includes("--force");
  const alsoRunner = process.argv.includes("--runner");

  // Confirm the Acqu tenant exists (db:seed must have run first).
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Acqu tenant not found — run `pnpm --filter @agent-os/db seed` first.");

  const [existingAdmin] = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.tenantId, tenantId), eq(schema.apiKeys.kind, "admin"), eq(schema.apiKeys.name, BOOTSTRAP_NAME)))
    .limit(1);

  if (existingAdmin && !force) {
    console.log(`▸ A bootstrap admin key already exists (id=${existingAdmin.id}, created ${existingAdmin.createdAt.toISOString()}).`);
    console.log("  The raw secret is one-way-hashed and cannot be reprinted. To mint a NEW one, re-run with --force,");
    console.log("  or use it to mint scoped keys via:  POST /api/admin/keys  { kind, name }");
  } else {
    const { raw, row } = await createApiKey(db, { tenantId, kind: "admin", name: BOOTSTRAP_NAME, createdBy: DEMO_USER_ID });
    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("  ADMIN API KEY (shown ONCE — copy it now; it is not recoverable)");
    console.log("════════════════════════════════════════════════════════════════════");
    console.log(`  ${raw}`);
    console.log(`  id=${row?.id}  tenant=Acqu  kind=admin  name=${BOOTSTRAP_NAME}`);
    console.log("════════════════════════════════════════════════════════════════════");
    console.log("  Use as:  Authorization: Bearer <key>   (or  x-api-key: <key>)");
    console.log("  Mint further keys via:  POST /api/admin/keys  { kind, name }\n");
  }

  if (alsoRunner) {
    const { raw, row } = await createApiKey(db, { tenantId, kind: "runner", name: RUNNER_NAME, createdBy: DEMO_USER_ID });
    console.log("──────────────────────────────────────────────────────────────────");
    console.log("  RUNNER API KEY (shown ONCE) — set as RUNNER_API_KEY for the runner");
    console.log(`  ${raw}`);
    console.log(`  id=${row?.id}  kind=runner  name=${RUNNER_NAME}`);
    console.log("──────────────────────────────────────────────────────────────────\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
