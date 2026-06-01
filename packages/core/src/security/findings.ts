// security/findings.ts — the single insert helper Phase-9 security agents call.
//
// Every Phase-9 agent (tenant-isolation-tester, secrets-rotation, access-auditor,
// security-anomaly-watchdog) writes its observations into ONE table via this
// helper. The category discriminator + payload jsonb keeps the surface uniform
// while letting each agent ship its own structured detail.
//
// Wave C: mirrors to relay_events.finding.recorded in the SAME transaction.
// Atomic — if the emit fails (e.g., closed-namespace rejection), the legacy
// security_findings insert rolls back too. No catch-and-swallow.

import { schema, type Db } from "@agent-os/db";
import { emit } from "../relay/emit.js";

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
  return await db.transaction(async (tx) => {
    const [row] = await tx
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
    if (!row) throw new Error("recordFinding: insert returned no row");

    // Mirror to Relay. Same-tx — if this throws, the security_findings insert
    // rolls back. The Relay can never miss a finding event.
    await emit(tx, {
      tenantId: args.tenantId,
      eventName: "finding.recorded",
      actor: "agent",
      agentId: args.agentId ?? null,
      runId: (args.payload?.run_id as string | undefined) ?? null,
      payload: {
        finding_id: row.id,
        category: args.category,
        severity: args.severity,
        title: args.title,
      },
    });

    return row;
  });
}
