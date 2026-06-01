// vault-rotate.ts — eager OAuth credential rotation for the `secrets-rotation`
// agent (Phase 9, T-critical / CANT_FAIL).
//
// Composes the vault substrate (decrypt → refresher → storeCredential) the same
// way resolveAccessToken does lazily, but eager: agent cron triggers, scans
// soon-to-expire credentials, rotates ahead of expiry.
//
// Pitfall 2 — race condition mid-agent-run:
//   The `secrets-rotation` agent runs on a fixed cron window (04:00 daily, set
//   in the agent seed — plan 09-04). We do NOT invalidate in-flight tokens
//   issued by `makeBundleTokenResolver`; those carry ≤300s TTL by contract
//   (packages/vault/src/index.ts:102-103) and expire naturally. New runs after
//   rotation pick up the fresh token via resolveAccessToken's normal path.
//   This trades a sub-300s window of stale-token reads for zero coordination
//   complexity. If that window matters later, gate the cron behind a "no live
//   runs" check on the runs table.
//
// On refresher failure: record a 'rotation' / high finding so the operator
// sees the gap before the credential expires. NEVER swallow the failure.

import { schema, type Db } from "@agent-os/db";
import { decrypt, storeCredential, type Refresher } from "@agent-os/vault";
import { eq } from "drizzle-orm";
import { recordFinding } from "./findings.js";

const { oauthCredentials } = schema;

export interface RotateResult {
  rotated: boolean;
  reason?: string;
}

interface StoredTokens {
  access: string;
  refresh?: string;
}

export async function rotateCredential(
  db: Db,
  key: Buffer,
  mcpId: string,
  refresher: Refresher,
): Promise<RotateResult> {
  const [cred] = await db
    .select()
    .from(oauthCredentials)
    .where(eq(oauthCredentials.mcpId, mcpId))
    .limit(1);

  if (!cred) return { rotated: false, reason: "no credential for mcpId" };
  if (!cred.expiresAt) {
    return { rotated: false, reason: "no expiry — manual provider rotation required" };
  }

  const tokens = JSON.parse(decrypt(cred.vaultRef, key)) as StoredTokens;
  if (!tokens.refresh) {
    return { rotated: false, reason: "no refresh token — needs_reauth flow" };
  }

  const fresh = await refresher(tokens.refresh);
  if (!fresh) {
    await recordFinding(db, {
      tenantId: cred.tenantId,
      category: "rotation",
      severity: "high",
      title: `rotation failed for mcp ${mcpId}`,
      payload: { mcpId },
    });
    return { rotated: false, reason: "provider refresh failed" };
  }

  await storeCredential(db, key, {
    tenantId: cred.tenantId,
    mcpId,
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? tokens.refresh,
    scopes: cred.scopes,
    expiresAt: fresh.expiresAt ?? null,
  });
  return { rotated: true };
}
