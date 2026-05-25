import { schema, type Db } from "@agent-os/db";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "./crypto.js";

export * from "./crypto.js";

const { oauthCredentials, envVars, mcps } = schema;

interface StoredTokens {
  access: string;
  refresh?: string;
}

export interface StoreCredentialArgs {
  tenantId: string;
  mcpId: string;
  accessToken: string;
  refreshToken?: string;
  scopes?: string[];
  expiresAt?: Date | null;
}

/** Encrypt OAuth tokens and persist; the DB row holds only the ciphertext (vault_ref). */
export async function storeCredential(db: Db, key: Buffer, args: StoreCredentialArgs) {
  const blob = encrypt(JSON.stringify({ access: args.accessToken, refresh: args.refreshToken } satisfies StoredTokens), key);
  await db.delete(oauthCredentials).where(and(eq(oauthCredentials.tenantId, args.tenantId), eq(oauthCredentials.mcpId, args.mcpId)));
  const [row] = await db
    .insert(oauthCredentials)
    .values({
      tenantId: args.tenantId,
      mcpId: args.mcpId,
      vaultRef: blob,
      scopes: args.scopes ?? [],
      expiresAt: args.expiresAt ?? null,
      status: "connected",
    })
    .returning();
  // Reflect health on the MCP row.
  await db.update(mcps).set({ status: "connected", lastHealthCheck: new Date() }).where(eq(mcps.id, args.mcpId));
  return row;
}

export type Refresher = (refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date } | null>;

export interface ResolvedToken {
  token: string;
  expiresAt: Date | null;
}

/**
 * Resolve a usable access token for an MCP. If expired and a refresher is given,
 * refresh + re-store; otherwise flag the connection needs_reauth and return null.
 */
export async function resolveAccessToken(db: Db, key: Buffer, mcpId: string, refresher?: Refresher): Promise<ResolvedToken | null> {
  const [cred] = await db.select().from(oauthCredentials).where(eq(oauthCredentials.mcpId, mcpId)).limit(1);
  if (!cred) return null;

  const expired = cred.expiresAt ? cred.expiresAt.getTime() <= Date.now() : false;
  let tokens: StoredTokens;
  try {
    tokens = JSON.parse(decrypt(cred.vaultRef, key)) as StoredTokens;
  } catch {
    await markNeedsReauth(db, cred.id, mcpId);
    return null;
  }

  if (expired) {
    if (refresher && tokens.refresh) {
      const refreshed = await refresher(tokens.refresh).catch(() => null);
      if (refreshed) {
        await storeCredential(db, key, {
          tenantId: cred.tenantId,
          mcpId,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? tokens.refresh,
          scopes: cred.scopes,
          expiresAt: refreshed.expiresAt ?? null,
        });
        return { token: refreshed.accessToken, expiresAt: refreshed.expiresAt ?? null };
      }
    }
    await markNeedsReauth(db, cred.id, mcpId);
    return null;
  }

  return { token: tokens.access, expiresAt: cred.expiresAt };
}

async function markNeedsReauth(db: Db, credId: string, mcpId: string) {
  await db.update(oauthCredentials).set({ status: "needs_reauth" }).where(eq(oauthCredentials.id, credId));
  await db.update(mcps).set({ status: "needs_reauth" }).where(eq(mcps.id, mcpId));
}

/**
 * A resolver suitable for the /next Bundle builder: returns a short-TTL token
 * for an MCP, or null if the connection needs reauth / has no creds.
 */
export function makeBundleTokenResolver(db: Db, key: Buffer, refresher?: Refresher) {
  return async (mcpId: string): Promise<{ token: string; ttlSeconds: number } | null> => {
    const resolved = await resolveAccessToken(db, key, mcpId, refresher);
    if (!resolved) return null;
    const ttl = resolved.expiresAt ? Math.max(0, Math.floor((resolved.expiresAt.getTime() - Date.now()) / 1000)) : 300;
    return { token: resolved.token, ttlSeconds: Math.min(ttl, 300) };
  };
}

// --- Env var encryption (same key) ---
export function encryptEnvValue(value: string, key: Buffer): string {
  return encrypt(value, key);
}
export function decryptEnvValue(blob: string, key: Buffer): string {
  return decrypt(blob, key);
}

export async function setEnvVar(db: Db, key: Buffer, args: { tenantId: string; projectId?: string | null; key: string; value: string; pinned?: boolean }) {
  const [row] = await db
    .insert(envVars)
    .values({ tenantId: args.tenantId, projectId: args.projectId ?? null, key: args.key, encryptedValue: encrypt(args.value, key), pinned: args.pinned ?? false })
    .returning();
  return row;
}
