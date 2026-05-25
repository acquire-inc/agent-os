// Unified data access. Runs on built-in demo fixtures when Supabase is not
// configured; otherwise reads from Supabase (RLS scopes rows to the user's
// tenants). Both paths share one interface so the UI never branches.
import {
  demoAgents,
  demoApprovals,
  demoCostDays,
  demoDocuments,
  demoFolders,
  demoJobs,
  demoMcps,
  demoProjects,
  demoRoutines,
  demoRunActivity,
  demoRuns,
  demoSkills,
  demoTags,
  demoTenants,
  type Agent,
  type Approval,
  type CostDay,
  type Document,
  type Job,
  type KnowledgeFolder,
  type Mcp,
  type Project,
  type Routine,
  type Run,
  type RunActivity,
  type Skill,
  type Tag,
  type Tenant,
} from "@agent-os/shared";
import { isSupabaseConfigured, supabase } from "./supabase";

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function mapRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as T;
}

async function sb<T>(table: string, tenantId: string, order?: string): Promise<T[]> {
  if (!supabase) return [];
  let q = supabase.from(table).select("*").eq("tenant_id", tenantId);
  if (order) q = q.order(order, { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => mapRow<T>(r as Record<string, unknown>));
}

function byTenant<T extends { tenantId: string }>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => r.tenantId === tenantId);
}

export const data = {
  async tenants(): Promise<Tenant[]> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase.from("tenants").select("*").order("created_at");
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<Tenant>(r as Record<string, unknown>));
    }
    return demoTenants;
  },

  async projects(tenantId: string): Promise<Project[]> {
    return isSupabaseConfigured ? sb<Project>("projects", tenantId) : byTenant(demoProjects, tenantId);
  },

  async tags(tenantId: string): Promise<Tag[]> {
    return isSupabaseConfigured ? sb<Tag>("tags", tenantId) : byTenant(demoTags, tenantId);
  },

  async agents(tenantId: string): Promise<Agent[]> {
    if (isSupabaseConfigured) return sb<Agent>("agents", tenantId);
    return byTenant(demoAgents, tenantId);
  },

  async jobs(tenantId: string): Promise<Job[]> {
    return isSupabaseConfigured ? sb<Job>("jobs", tenantId) : byTenant(demoJobs, tenantId);
  },

  async runs(tenantId: string): Promise<Run[]> {
    return isSupabaseConfigured
      ? sb<Run>("runs", tenantId, "scheduled_for")
      : byTenant(demoRuns, tenantId);
  },

  async runActivity(runId: string): Promise<RunActivity[]> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase.from("run_activity").select("*").eq("run_id", runId).order("ts");
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<RunActivity>(r as Record<string, unknown>));
    }
    return demoRunActivity.filter((a) => a.runId === runId);
  },

  async routines(tenantId: string): Promise<Routine[]> {
    return isSupabaseConfigured ? sb<Routine>("routines", tenantId) : byTenant(demoRoutines, tenantId);
  },

  async skills(tenantId: string): Promise<Skill[]> {
    return isSupabaseConfigured ? sb<Skill>("skills", tenantId) : byTenant(demoSkills, tenantId);
  },

  async mcps(tenantId: string): Promise<Mcp[]> {
    return isSupabaseConfigured ? sb<Mcp>("mcps", tenantId) : byTenant(demoMcps, tenantId);
  },

  async folders(tenantId: string): Promise<KnowledgeFolder[]> {
    return isSupabaseConfigured ? sb<KnowledgeFolder>("knowledge_folders", tenantId) : byTenant(demoFolders, tenantId);
  },

  async documents(tenantId: string): Promise<Document[]> {
    return isSupabaseConfigured ? sb<Document>("documents", tenantId) : byTenant(demoDocuments, tenantId);
  },

  async approvals(tenantId: string): Promise<Approval[]> {
    return isSupabaseConfigured ? sb<Approval>("approvals", tenantId) : byTenant(demoApprovals, tenantId);
  },

  async costDays(tenantId: string): Promise<CostDay[]> {
    if (isSupabaseConfigured) return [];
    return byTenant(demoCostDays, tenantId);
  },
};
