// Impersonate a Supabase user inside a transaction by setting the GUC
// `request.jwt.claim.sub` — the same GUC `auth.uid()` reads, which
// `is_tenant_member()` consults. SET LOCAL is transaction-scoped; the
// connection's default identity is unaffected for other queries.
//
// Caller MUST supply a non-service-role connection (D-01). Otherwise RLS is
// bypassed and every test passes false. See README for the false-pass signal.

import type { Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

export async function asUser<T>(
  db: Db,
  userId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // GUC name is verbatim from supabase/migrations/0001_init.sql L39 — DO NOT rename.
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}
