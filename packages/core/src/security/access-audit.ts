// access-audit.ts — orphaned-grant detector for the `access-auditor` agent.
//
// Pitfall 4 (RESEARCH.md): Phase 8.5 introduced non-destructive archive —
// agents move to lifecycle_state = 'archived' but their bindings (agent_mcps,
// agent_skills, agent_tools) are intentionally PRESERVED so history queries
// resolve cleanly. A naive "any archived-agent binding is orphaned" check
// would false-positive every archived agent's connectors. The 30-day grace
// window is the policy: archived for less than 30 days = recent, ignore;
// archived more than 30 days with live OAuth credentials = real stale grant.
//
// Returns rows for the agent to wrap in recordFinding ('access' / medium)
// downstream — this module reads only, never writes findings itself.

import { type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

export interface OrphanedGrantRow extends Record<string, unknown> {
  cred_id: string;
  mcp_id: string;
  mcp_name: string;
  agent_key: string;
  lifecycle_state: string;
  lifecycle_changed_at: Date | string | null;
}

export async function findOrphanedGrants(db: Db, tenantId: string) {
  return db.execute<OrphanedGrantRow>(sql`
    select oc.id as cred_id, oc.mcp_id, m.name as mcp_name,
           a.key as agent_key, a.lifecycle_state, a.lifecycle_changed_at
    from oauth_credentials oc
    join agent_mcps am on am.mcp_id = oc.mcp_id
    join agents a on a.id = am.agent_id
    join mcps m on m.id = oc.mcp_id
    where oc.tenant_id = ${tenantId}
      and a.lifecycle_state = 'archived'
      and a.lifecycle_changed_at < now() - interval '30 days'
  `);
}
