import { schema, type Db } from "@agent-os/db";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

const { apiKeys } = schema;

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface ApiKeyContext {
  tenantId: string;
  kind: "runner" | "external" | "admin";
  keyId: string;
}

/** Verify a raw API key against the store; returns its tenant + kind, or null. */
export async function verifyApiKey(db: Db, raw: string): Promise<ApiKeyContext | null> {
  if (!raw) return null;
  const hash = hashApiKey(raw);
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1);
  if (!row) return null;
  return { tenantId: row.tenantId, kind: row.kind as ApiKeyContext["kind"], keyId: row.id };
}

/** Create a new API key; returns the raw key (shown once) and the stored row. */
export async function createApiKey(
  db: Db,
  args: { tenantId: string; kind: "runner" | "external" | "admin"; name: string; createdBy?: string | null; raw?: string },
) {
  const raw = args.raw ?? `aos_${args.kind.slice(0, 3)}_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(apiKeys)
    .values({ tenantId: args.tenantId, kind: args.kind, name: args.name, hash: hashApiKey(raw), createdBy: args.createdBy ?? null })
    .returning();
  return { raw, row };
}
