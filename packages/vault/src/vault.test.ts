// Vault integration test. Run: DATABASE_URL=... pnpm --filter @agent-os/vault test
import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";
import {
  classifyCredential,
  decrypt,
  encrypt,
  generateVaultKey,
  makeBundleTokenResolver,
  parseClientCredential,
  resolveAccessToken,
  resolveCredential,
  setEnvVar,
  storeCredential,
  tenantCredToken,
} from "./index.js";

let passed = 0,
  failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDb(url);
  const key = Buffer.from(generateVaultKey(), "base64");
  const tenantId = TENANT_IDS.acqu;
  // Use a real seeded MCP (Close).
  const mcpId = "90000000-0000-0000-0000-000000000001";

  console.log("\n[crypto]");
  const blob = encrypt("super-secret-token", key);
  assert(decrypt(blob, key) === "super-secret-token", "encrypt/decrypt round-trips");
  assert(blob !== "super-secret-token" && !blob.includes("super-secret"), "ciphertext does not leak plaintext");
  let tampered = blob.slice(0, -4) + (blob.endsWith("AAAA") ? "BBBB" : "AAAA");
  let threw = false;
  try {
    decrypt(tampered, key);
  } catch {
    threw = true;
  }
  assert(threw, "tampered ciphertext fails GCM auth");
  const wrongKey = Buffer.from(generateVaultKey(), "base64");
  threw = false;
  try {
    decrypt(blob, wrongKey);
  } catch {
    threw = true;
  }
  assert(threw, "wrong key cannot decrypt");

  console.log("\n[credentials]");
  await db.delete(schema.oauthCredentials).where(eq(schema.oauthCredentials.mcpId, mcpId));
  await storeCredential(db, key, { tenantId, mcpId, accessToken: "at_live_123", refreshToken: "rt_456", scopes: ["read", "write"], expiresAt: new Date(Date.now() + 3600_000) });
  const [stored] = await db.select().from(schema.oauthCredentials).where(eq(schema.oauthCredentials.mcpId, mcpId));
  assert(stored !== undefined && !stored.vaultRef.includes("at_live_123"), "stored credential is encrypted at rest");
  const resolved = await resolveAccessToken(db, key, mcpId);
  assert(resolved?.token === "at_live_123", "resolveAccessToken returns the live token");

  console.log("\n[expiry + refresh]");
  await storeCredential(db, key, { tenantId, mcpId, accessToken: "at_expired", refreshToken: "rt_456", expiresAt: new Date(Date.now() - 1000) });
  const noRefresh = await resolveAccessToken(db, key, mcpId);
  assert(noRefresh === null, "expired token without refresher returns null");
  const [afterFail] = await db.select().from(schema.oauthCredentials).where(eq(schema.oauthCredentials.mcpId, mcpId));
  assert(afterFail?.status === "needs_reauth", "expired token flags connection needs_reauth");

  await storeCredential(db, key, { tenantId, mcpId, accessToken: "at_expired2", refreshToken: "rt_456", expiresAt: new Date(Date.now() - 1000) });
  const refreshed = await resolveAccessToken(db, key, mcpId, async (rt) => (rt === "rt_456" ? { accessToken: "at_fresh", refreshToken: "rt_789", expiresAt: new Date(Date.now() + 3600_000) } : null));
  assert(refreshed?.token === "at_fresh", "refresher mints a fresh token on expiry");
  const reResolved = await resolveAccessToken(db, key, mcpId);
  assert(reResolved?.token === "at_fresh", "refreshed token is persisted");

  console.log("\n[bundle resolver]");
  const resolver = makeBundleTokenResolver(db, key);
  const bundleTok = await resolver(mcpId);
  assert(bundleTok?.token === "at_fresh" && bundleTok.ttlSeconds <= 300, "bundle resolver returns short-TTL token");
  assert((await resolver("00000000-0000-0000-0000-000000000000")) === null, "bundle resolver returns null for unknown mcp");

  console.log("\n[env vars]");
  const ev = await setEnvVar(db, key, { tenantId, key: "STRIPE_KEY", value: "sk_test_xyz", pinned: true });
  assert(ev !== undefined && !ev.encryptedValue.includes("sk_test_xyz"), "env var stored encrypted");
  assert(decrypt(ev!.encryptedValue, key) === "sk_test_xyz", "env var decrypts to original");

  console.log("\n[credential namespacing (v3 C)]");
  assert(classifyCredential("AGENTIC_N8N_API_KEY") === "infra", "AGENTIC_* classified infra");
  assert(classifyCredential("CLIENT_ACQU_STRIPE_KEY") === "client", "CLIENT_* classified client");
  assert(classifyCredential("RANDOM_KEY") === "unknown", "unprefixed classified unknown");
  assert(tenantCredToken("william-roofing") === "WILLIAM_ROOFING", "tenant token uppercases + underscores");
  assert(parseClientCredential("CLIENT_ACQU_STRIPE_KEY")?.name === "STRIPE_KEY", "client cred name parsed");
  // infra present → ok; infra missing → fail loud
  assert((await resolveCredential("AGENTIC_X", "acqu", async () => "v")).status === "ok", "infra present → ok");
  assert((await resolveCredential("AGENTIC_X", "acqu", async () => null)).status === "fail", "infra missing → fail loud");
  // client missing → pause; client present → ok; wrong tenant → fail
  assert((await resolveCredential("CLIENT_ACQU_KEY", "acqu", async () => null)).status === "pause", "client missing → pause for paste-back");
  assert((await resolveCredential("CLIENT_ACQU_KEY", "acqu", async () => "v")).status === "ok", "client present → ok");
  assert((await resolveCredential("CLIENT_OTHER_KEY", "acqu", async () => "v")).status === "fail", "cross-tenant client cred → fail");
  assert((await resolveCredential("WAT", "acqu", async () => "v")).status === "fail", "unknown class → fail loud");

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
