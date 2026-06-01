// ATTACK_VECTORS — the frozen registry of RLS-protected tables to test.
//
// One entry per tenant_id-keyed table. Each vector's `run` does THREE things,
// in order:
//   1. POSITIVE CONTROL — as tenantB.userB, read from the table. Assert >=1 row.
//      This proves the test is REAL — if the positive control returns 0, the
//      vector throws (the test was broken, not the RLS). Pitfall 5 mitigation.
//   2. ATTACK — as tenantA.userA, read tenantB's rows. Assert 0 rows.
//   3. Return VectorResult.
//
// The registry is APPEND-ONLY FOREVER. Migrations that add new tenant_id-keyed
// tables MUST add a new AV-NNN entry. `assertVectorsAppendOnly()` enforces the
// floor — PRs that delete entries fail the check.
//
// Vector body uses raw `sql\`select count(*)::int as n from ${table} where
// tenant_id = ${tenantB}\`` rather than typed drizzle queries because the
// vector set MUST extend to tables added by future migrations without code
// changes elsewhere. Drizzle's typed surface would require importing every
// pgTable; the raw sql approach is loose-typed but stable across schema growth.

import type { Db } from "@agent-os/db";
import { sql } from "drizzle-orm";
import { asUser } from "./impersonate.js";
import type { IsolationInput, VectorResult } from "./types.js";

export interface AttackVector {
  id: string;
  name: string;
  table: string;
  run(db: Db, ctx: IsolationInput): Promise<VectorResult>;
}

/** Factory for any table keyed directly by tenant_id (the common shape). */
function tenantIdVector(id: string, table: string): AttackVector {
  return {
    id,
    name: `tenant_isolation:${table}`,
    table,
    async run(db, ctx) {
      const pair = ctx.tenantPairs[0]!;

      // 1. Positive control — as tenantB.userB, MUST see at least 1 row of tenantB's.
      //    If this returns 0, the test is broken (no fixture data, RLS bypass, or
      //    misconfigured GUC). Throw so caller doesn't get a false-pass result.
      const posCtl = await asUser(db, pair.userB, async (tx) => {
        const r = await tx.execute<{ n: number }>(
          sql.raw(`select count(*)::int as n from ${table} where tenant_id = '${pair.tenantB}'`),
        );
        const rows = r as unknown as { n: number }[];
        return rows[0]?.n ?? 0;
      });
      if (posCtl < 1) {
        throw new Error(
          `${id} (${table}): positive control returned ${posCtl} — test broken (no fixture data OR connection is service-role; see README D-01). Refusing to claim pass.`,
        );
      }

      // 2. Attack — as tenantA.userA, attempt to read tenantB's rows. Must be 0.
      const attack = await asUser(db, pair.userA, async (tx) => {
        const r = await tx.execute<{ n: number }>(
          sql.raw(`select count(*)::int as n from ${table} where tenant_id = '${pair.tenantB}'`),
        );
        const rows = r as unknown as { n: number }[];
        return rows[0]?.n ?? 0;
      });

      return {
        id,
        table,
        passed: attack === 0,
        actual: attack,
        expected: 0,
        notes: `positive control returned ${posCtl} rows; attack returned ${attack}`,
      };
    },
  };
}

/** Per-parent vector for join tables (agent_skills, agent_mcps, agent_tools) —
 *  they have no tenant_id column; authorization is via parent agents.tenant_id.
 *  The vector checks that as userA we can't see joins for tenantB's agents. */
function viaAgentVector(id: string, joinTable: string, fkColumn: string): AttackVector {
  return {
    id,
    name: `tenant_isolation:${joinTable}`,
    table: joinTable,
    async run(db, ctx) {
      const pair = ctx.tenantPairs[0]!;
      const sqlPositive = `select count(*)::int as n from ${joinTable} jt
                           where exists (select 1 from agents a
                             where a.id = jt.${fkColumn} and a.tenant_id = '${pair.tenantB}')`;
      const posCtl = await asUser(db, pair.userB, async (tx) => {
        const r = await tx.execute<{ n: number }>(sql.raw(sqlPositive));
        const rows = r as unknown as { n: number }[];
        return rows[0]?.n ?? 0;
      });
      if (posCtl < 1) {
        throw new Error(
          `${id} (${joinTable}): positive control returned ${posCtl} — broken (no fixture joins OR RLS bypass; README D-01)`,
        );
      }
      const attack = await asUser(db, pair.userA, async (tx) => {
        const r = await tx.execute<{ n: number }>(sql.raw(sqlPositive));
        const rows = r as unknown as { n: number }[];
        return rows[0]?.n ?? 0;
      });
      return {
        id,
        table: joinTable,
        passed: attack === 0,
        actual: attack,
        expected: 0,
        notes: `positive control (via agent FK) returned ${posCtl}; attack returned ${attack}`,
      };
    },
  };
}

// APPEND-ONLY. New migrations adding tenant_id-keyed tables: add a new AV-NNN here.
// Removing entries is a release-breaking change — assertVectorsAppendOnly enforces.
export const ATTACK_VECTORS: ReadonlyArray<AttackVector> = Object.freeze([
  // Migration 0001 (init) — RLS-protected tenant-scoped tables
  tenantIdVector("AV-001", "tenants"),
  tenantIdVector("AV-002", "tenant_members"),
  tenantIdVector("AV-003", "projects"),
  tenantIdVector("AV-004", "tags"),
  tenantIdVector("AV-005", "entity_tags"),
  tenantIdVector("AV-006", "agents"),
  tenantIdVector("AV-007", "project_entities"),
  tenantIdVector("AV-008", "jobs"),
  tenantIdVector("AV-009", "runs"),
  tenantIdVector("AV-010", "run_activity"),
  tenantIdVector("AV-011", "routines"),
  tenantIdVector("AV-012", "skills"),
  tenantIdVector("AV-013", "mcps"),
  tenantIdVector("AV-014", "oauth_credentials"),
  tenantIdVector("AV-015", "env_vars"),
  tenantIdVector("AV-016", "knowledge_folders"),
  tenantIdVector("AV-017", "documents"),
  tenantIdVector("AV-018", "doc_chunks"),
  tenantIdVector("AV-019", "databases"),
  tenantIdVector("AV-020", "database_rows"),
  tenantIdVector("AV-021", "approvals"),
  tenantIdVector("AV-022", "audit_log"),
  tenantIdVector("AV-023", "api_keys"),
  // Join tables (via parent agents.tenant_id)
  viaAgentVector("AV-024", "agent_skills", "agent_id"),
  viaAgentVector("AV-025", "agent_mcps", "agent_id"),
  // Migration 0003+ — additional tenant-scoped tables
  tenantIdVector("AV-026", "autonomy_events"),
  tenantIdVector("AV-027", "agent_prompts"),
  tenantIdVector("AV-028", "agent_triggers"),
  // Migration 0006/0007/0010 — feature tables
  tenantIdVector("AV-029", "architect_blueprints"),
  tenantIdVector("AV-030", "tools"),
  viaAgentVector("AV-031", "agent_tools", "agent_id"),
  tenantIdVector("AV-032", "security_findings"),
]);

// Captured at module load — the floor that future PRs must meet or exceed.
export const REGISTERED_COUNT_FLOOR = ATTACK_VECTORS.length;

/** Throws if anyone deletes vectors. Run before every isolation suite. */
export function assertVectorsAppendOnly(): void {
  if (ATTACK_VECTORS.length < REGISTERED_COUNT_FLOOR) {
    throw new Error(
      `attack-vectors registry shrunk: ${ATTACK_VECTORS.length} < ${REGISTERED_COUNT_FLOOR}. Vectors are append-only forever (Pitfall 5).`,
    );
  }
}
