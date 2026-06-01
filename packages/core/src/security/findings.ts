// security/findings.ts — the single insert helper Phase-9 security agents call.
//
// Every Phase-9 agent (tenant-isolation-tester, secrets-rotation, access-auditor,
// security-anomaly-watchdog) writes its observations into ONE table via this
// helper. The category discriminator + payload jsonb keeps the surface uniform
// while letting each agent ship its own structured detail.
//
// Mirrors appendActivity's shape (lifecycle.ts) — single insert, returns the row.

import { schema, type Db } from "@agent-os/db";

export type FindingCategory = "isolation" | "rotation" | "access" | "anomaly";
export type FindingSeverity = "low" | "medium" | "high" | "critical";

export interface FindingArgs {
  tenantId: string;
  agentId?: string | null;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  payload?: Record<string, unknown>;
}

export type SecurityFinding = typeof schema.securityFindings.$inferSelect;

export async function recordFinding(db: Db, args: FindingArgs): Promise<SecurityFinding> {
  const [row] = await db
    .insert(schema.securityFindings)
    .values({
      tenantId: args.tenantId,
      agentId: args.agentId ?? null,
      category: args.category,
      severity: args.severity,
      title: args.title,
      payload: args.payload ?? {},
    })
    .returning();
  return row!;
}
