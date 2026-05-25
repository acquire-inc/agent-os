import { schema, type Db } from "@agent-os/db";
import { eq } from "drizzle-orm";

const {
  tenants, tenantMembers, projects, agents, agentSkills, agentMcps, projectEntities,
  jobs, routines, skills, mcps,
} = schema;

export interface ProvisionResult {
  tenantId: string;
  counts: { projects: number; agents: number; jobs: number; routines: number; skills: number; mcps: number };
}

/**
 * Provision a new (client) tenant by cloning a template tenant's workforce —
 * projects, agents (+ skill/MCP attachments), jobs, routines, skills, and MCP
 * definitions — with fresh IDs and remapped references. Runs, credentials, and
 * env vars are deliberately NOT copied (the client starts clean). This is the
 * productization: "onboard a client tenant" for the AI ROI offer (Master doc M11).
 */
export async function provisionClientTenant(
  db: Db,
  args: { name: string; slug: string; templateTenantId: string; ownerUserId: string; type?: "client" | "internal"; monthlyBudgetUsd?: number | null },
): Promise<ProvisionResult> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: args.name, slug: args.slug, type: args.type ?? "client", status: "active", monthlyBudgetUsd: args.monthlyBudgetUsd != null ? String(args.monthlyBudgetUsd) : null })
    .returning();
  const tenantId = tenant!.id;
  await db.insert(tenantMembers).values({ tenantId, userId: args.ownerUserId, role: "owner" });

  const src = args.templateTenantId;

  // Skills + MCPs (definitions) first — agents reference them.
  const skillMap = new Map<string, string>();
  for (const s of await db.select().from(skills).where(eq(skills.tenantId, src))) {
    const [row] = await db.insert(skills).values({
      tenantId, projectId: null, key: s.key, name: s.name, description: s.description, version: s.version,
      source: s.source, repoPath: s.repoPath, scope: s.scope, enabled: s.enabled,
    }).returning({ id: skills.id });
    skillMap.set(s.id, row!.id);
  }
  const mcpMap = new Map<string, string>();
  for (const m of await db.select().from(mcps).where(eq(mcps.tenantId, src))) {
    const [row] = await db.insert(mcps).values({
      tenantId, projectId: null, name: m.name, transport: m.transport, endpoint: m.endpoint,
      authType: m.authType, scope: m.scope, status: "disconnected", // client must connect their own accounts
    }).returning({ id: mcps.id });
    mcpMap.set(m.id, row!.id);
  }

  // Projects.
  const projectMap = new Map<string, string>();
  for (const p of await db.select().from(projects).where(eq(projects.tenantId, src))) {
    const [row] = await db.insert(projects).values({ tenantId, name: p.name, description: p.description }).returning({ id: projects.id });
    projectMap.set(p.id, row!.id);
  }

  // Agents + their skill/MCP attachments + project memberships.
  const agentMap = new Map<string, string>();
  for (const a of await db.select().from(agents).where(eq(agents.tenantId, src))) {
    const [row] = await db.insert(agents).values({
      tenantId, key: a.key, name: a.name, persona: a.persona, backend: a.backend, model: a.model,
      thinkingLevel: a.thinkingLevel, autonomy: a.autonomy, knowledgeScopeJson: a.knowledgeScopeJson,
      budgetCapUsd: a.budgetCapUsd, escalationPolicy: a.escalationPolicy, runnerKind: a.runnerKind,
      enabled: a.enabled, templateId: a.id, // record provenance
    }).returning({ id: agents.id });
    agentMap.set(a.id, row!.id);
  }
  for (const link of await db.select().from(agentSkills)) {
    const na = agentMap.get(link.agentId), ns = skillMap.get(link.skillId);
    if (na && ns) await db.insert(agentSkills).values({ agentId: na, skillId: ns }).onConflictDoNothing();
  }
  for (const link of await db.select().from(agentMcps)) {
    const na = agentMap.get(link.agentId), nm = mcpMap.get(link.mcpId);
    if (na && nm) await db.insert(agentMcps).values({ agentId: na, mcpId: nm }).onConflictDoNothing();
  }
  for (const pe of await db.select().from(projectEntities).where(eq(projectEntities.tenantId, src))) {
    const np = projectMap.get(pe.projectId), ne = pe.entityType === "agent" ? agentMap.get(pe.entityId) : undefined;
    if (np && ne) await db.insert(projectEntities).values({ projectId: np, entityType: "agent", entityId: ne, tenantId }).onConflictDoNothing();
  }

  // Jobs (remap agent) + routines (remap project + job ids).
  const jobMap = new Map<string, string>();
  for (const j of await db.select().from(jobs).where(eq(jobs.tenantId, src))) {
    const na = agentMap.get(j.agentId);
    if (!na) continue;
    const [row] = await db.insert(jobs).values({
      tenantId, agentId: na, name: j.name, scheduleCron: j.scheduleCron, instructions: j.instructions,
      modelOverride: j.modelOverride, thinkingOverride: j.thinkingOverride, enabled: j.enabled,
    }).returning({ id: jobs.id });
    jobMap.set(j.id, row!.id);
  }
  let routineCount = 0;
  for (const r of await db.select().from(routines).where(eq(routines.tenantId, src))) {
    const np = r.projectId ? projectMap.get(r.projectId) ?? null : null;
    const newJobIds = r.jobIds.map((id) => jobMap.get(id)).filter((x): x is string => Boolean(x));
    await db.insert(routines).values({ tenantId, projectId: np, name: r.name, cadence: r.cadence, jobIds: newJobIds, enabled: r.enabled });
    routineCount++;
  }

  return {
    tenantId,
    counts: { projects: projectMap.size, agents: agentMap.size, jobs: jobMap.size, routines: routineCount, skills: skillMap.size, mcps: mcpMap.size },
  };
}
