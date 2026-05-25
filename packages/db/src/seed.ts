// Seeds the canonical demo dataset (from @agent-os/shared/fixtures) into Postgres.
// Idempotent: clears demo tenants first, then re-inserts.
// Usage: DATABASE_URL=... pnpm --filter @agent-os/db seed
import {
  AGENT_IDS,
  DEMO_USER_ID,
  TENANT_IDS,
  demoAgents,
  demoApprovals,
  demoDocuments,
  demoFolders,
  demoJobs,
  demoMcps,
  demoMembers,
  demoProfile,
  demoProjects,
  demoRoutines,
  demoRunActivity,
  demoRuns,
  demoSkills,
  demoTags,
  demoTenants,
} from "@agent-os/shared";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { prepare: false, max: 1 });
  const json = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

  try {
    // Reset demo tenants (cascades to all tenant-scoped rows).
    await sql`delete from tenants where id in ${sql([TENANT_IDS.acqu, TENANT_IDS.cliently])}`;
    await sql`delete from auth.users where id = ${DEMO_USER_ID}`;

    // Identity
    await sql`insert into auth.users (id, email) values (${DEMO_USER_ID}, ${demoProfile.email})
      on conflict (id) do nothing`;
    await sql`insert into profiles (user_id, email, name, avatar_url)
      values (${demoProfile.userId}, ${demoProfile.email}, ${demoProfile.name}, ${demoProfile.avatarUrl})
      on conflict (user_id) do update set email = excluded.email, name = excluded.name`;

    for (const t of demoTenants) {
      await sql`insert into tenants (id, name, slug, type, status, monthly_budget_usd, created_at)
        values (${t.id}, ${t.name}, ${t.slug}, ${t.type}, ${t.status}, ${t.monthlyBudgetUsd}, ${t.createdAt})`;
    }
    for (const m of demoMembers) {
      await sql`insert into tenant_members (tenant_id, user_id, role) values (${m.tenantId}, ${m.userId}, ${m.role})`;
    }
    for (const p of demoProjects) {
      await sql`insert into projects (id, tenant_id, name, description) values (${p.id}, ${p.tenantId}, ${p.name}, ${p.description})`;
    }
    for (const tag of demoTags) {
      await sql`insert into tags (id, tenant_id, name) values (gen_random_uuid(), ${tag.tenantId}, ${tag.name})
        on conflict (tenant_id, name) do nothing`;
    }

    for (const a of demoAgents) {
      await sql`insert into agents (id, tenant_id, key, name, persona, backend, model, thinking_level,
          autonomy, knowledge_scope_json, budget_cap_usd, escalation_policy, runner_kind, enabled)
        values (${a.id}, ${a.tenantId}, ${a.key}, ${a.name}, ${a.persona}, ${a.backend}, ${a.model},
          ${a.thinkingLevel}, ${a.autonomy}, ${json(a.knowledgeScope)}, ${a.budgetCapUsd},
          ${a.escalationPolicy}, ${a.runnerKind}, ${a.enabled})`;
      for (const pid of a.projectIds ?? []) {
        await sql`insert into project_entities (project_id, entity_type, entity_id, tenant_id)
          values (${pid}, 'agent', ${a.id}, ${a.tenantId}) on conflict do nothing`;
      }
    }

    for (const j of demoJobs) {
      await sql`insert into jobs (id, tenant_id, agent_id, name, schedule_cron, instructions, model_override, thinking_override, enabled)
        values (${j.id}, ${j.tenantId}, ${j.agentId}, ${j.name}, ${j.scheduleCron}, ${j.instructions}, ${j.modelOverride}, ${j.thinkingOverride}, ${j.enabled})`;
    }

    for (const r of demoRuns) {
      await sql`insert into runs (id, tenant_id, agent_id, job_id, status, trigger_source, scheduled_for,
          claimed_by, started_at, ended_at, tokens_in, tokens_out, cost_usd, summary, sdk_session_id)
        values (${r.id}, ${r.tenantId}, ${r.agentId}, ${r.jobId}, ${r.status}, ${r.triggerSource}, ${r.scheduledFor},
          ${r.claimedBy}, ${r.startedAt}, ${r.endedAt}, ${r.tokensIn}, ${r.tokensOut}, ${r.costUsd}, ${r.summary}, ${r.sdkSessionId})`;
    }
    for (const ev of demoRunActivity) {
      const run = demoRuns.find((r) => r.id === ev.runId);
      if (!run) continue;
      await sql`insert into run_activity (id, run_id, tenant_id, ts, kind, message)
        values (gen_random_uuid(), ${ev.runId}, ${run.tenantId}, ${ev.ts}, ${ev.kind}, ${ev.message})`;
    }

    for (const ro of demoRoutines) {
      await sql`insert into routines (id, tenant_id, project_id, name, cadence, job_ids, enabled)
        values (${ro.id}, ${ro.tenantId}, ${ro.projectId}, ${ro.name}, ${ro.cadence}, ${ro.jobIds}, ${ro.enabled})`;
    }

    for (const s of demoSkills) {
      await sql`insert into skills (id, tenant_id, project_id, key, name, description, version, source, repo_path, scope, enabled)
        values (${s.id}, ${s.tenantId}, ${s.projectId}, ${s.key}, ${s.name}, ${s.description}, ${s.version}, ${s.source}, ${s.repoPath}, ${s.scope}, ${s.enabled})`;
    }
    // Link skills to agents by key.
    for (const a of demoAgents) {
      for (const key of a.skillKeys ?? []) {
        const skill = demoSkills.find((s) => s.key === key && s.tenantId === a.tenantId);
        if (skill) await sql`insert into agent_skills (agent_id, skill_id) values (${a.id}, ${skill.id}) on conflict do nothing`;
      }
    }

    for (const m of demoMcps) {
      await sql`insert into mcps (id, tenant_id, project_id, name, transport, endpoint, auth_type, scope, status, last_health_check)
        values (${m.id}, ${m.tenantId}, ${m.projectId}, ${m.name}, ${m.transport}, ${m.endpoint}, ${m.authType}, ${m.scope}, ${m.status}, ${m.lastHealthCheck})`;
    }
    // Link MCPs to agents by fuzzy-matching mcpKeys against mcp names.
    for (const a of demoAgents) {
      for (const key of a.mcpKeys ?? []) {
        const m = demoMcps.find(
          (x) => x.tenantId === a.tenantId && (x.name.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(x.name.split(/\s|×/)[0]!.toLowerCase())),
        );
        if (m) await sql`insert into agent_mcps (agent_id, mcp_id) values (${a.id}, ${m.id}) on conflict do nothing`;
      }
    }

    for (const f of demoFolders) {
      await sql`insert into knowledge_folders (id, tenant_id, project_id, parent_id, name, path)
        values (gen_random_uuid(), ${f.tenantId}, ${f.projectId}, null, ${f.name}, ${f.path})`;
    }
    for (const d of demoDocuments) {
      await sql`insert into documents (id, tenant_id, project_id, folder_id, name, type, source, vector_namespace, vector_indexed, version, updated_at)
        values (gen_random_uuid(), ${d.tenantId}, ${d.projectId}, null, ${d.name}, ${d.type}, ${d.source}, ${d.vectorNamespace}, ${d.vectorIndexed}, ${d.version}, ${d.updatedAt})`;
    }

    for (const ap of demoApprovals) {
      await sql`insert into approvals (id, run_id, tenant_id, agent_id, context, proposed_action, options_json, status, created_at)
        values (gen_random_uuid(), ${ap.runId}, ${ap.tenantId}, ${ap.agentId}, ${ap.context}, ${ap.proposedAction}, ${json(ap.options)}, ${ap.status}, ${ap.createdAt})`;
    }

    const counts = await sql`select
      (select count(*) from tenants) as tenants,
      (select count(*) from agents) as agents,
      (select count(*) from jobs) as jobs,
      (select count(*) from runs) as runs,
      (select count(*) from skills) as skills,
      (select count(*) from mcps) as mcps,
      (select count(*) from approvals) as approvals`;
    console.log("Seed complete:", counts[0]);
    void AGENT_IDS;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
