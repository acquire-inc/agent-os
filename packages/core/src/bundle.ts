import { schema, type Db } from "@agent-os/db";
import { RUN_STATUSES } from "@agent-os/shared";
import { and, eq, inArray } from "drizzle-orm";

const { agents, agentMcps, agentSkills, documents, envVars, jobRefs, jobs, mcps, runs, skills } = schema;

export interface Bundle {
  run: {
    id: string;
    status: string;
    triggerSource: string;
    scheduledFor: string | null;
    sdkSessionId: string | null;
  };
  job: { name: string; instructions: string; scheduleCron: string } | null;
  agent: {
    key: string;
    name: string;
    persona: string | null;
    backend: string;
    model: string;
    thinkingLevel: string;
    autonomy: string;
    escalationPolicy: string | null;
    budgetCapUsd: number | null;
    runnerKind: string;
  };
  docs: { id: string; name: string; type: string }[];
  skills: { key: string; name: string; description: string; version: string; source: string; repoPath: string | null }[];
  mcpServers: {
    name: string;
    transport: string;
    endpoint: string | null;
    authType: string;
    scope: string;
    credentials: { vaultRef?: string; token?: string; ttlSeconds: number } | null;
  }[];
  knowledge: { chunk: string; source: string }[];
  envVars: Record<string, string>;
  autonomy: string;
  escalationPolicy: string | null;
  budgetCapUsd: number | null;
  knowledgeScope: { folders: string[]; tags: string[] };
  api: {
    statusUrl: string;
    activityUrl: string;
    approvalsUrl: string;
    validStatuses: readonly string[];
  };
}

/** Resolves a fresh, short-TTL credential for an MCP at bundle-build time. */
export type TokenResolver = (mcpId: string) => Promise<{ token: string; ttlSeconds: number } | null>;

/** Retrieves knowledge chunks relevant to a query within the agent's scope. */
export type KnowledgeRetriever = (query: string, namespaces: string[]) => Promise<{ chunk: string; source: string }[]>;

export interface BundleOptions {
  /** When provided, real per-run tokens are injected (vault). Else a vaultRef placeholder is used. */
  resolveToken?: TokenResolver;
  /** When provided, the agent's knowledge_scope is vector-retrieved into the bundle. */
  retrieveKnowledge?: KnowledgeRetriever;
  /** Decrypts a stored env-var value (vault). Without it, env vars are omitted — never ship ciphertext. */
  decryptEnv?: (blob: string) => string;
}

/** Assemble everything a runner needs to construct a fully configured agent run. */
export async function buildBundle(db: Db, runId: string, baseUrl: string, opts: BundleOptions = {}): Promise<Bundle | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return null;

  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  if (!agent) return null;

  const job = run.jobId ? (await db.select().from(jobs).where(eq(jobs.id, run.jobId)).limit(1))[0] : null;

  // Collect references attached to the job, plus skills/mcps attached to the agent.
  const refs = run.jobId ? await db.select().from(jobRefs).where(eq(jobRefs.jobId, run.jobId)) : [];
  const docRefIds = refs.filter((r) => r.refType === "doc").map((r) => r.refId);
  const envRefIds = refs.filter((r) => r.refType === "envvar").map((r) => r.refId);

  const agentSkillRows = await db.select().from(agentSkills).where(eq(agentSkills.agentId, agent.id));
  const agentMcpRows = await db.select().from(agentMcps).where(eq(agentMcps.agentId, agent.id));
  const skillIds = agentSkillRows.map((r) => r.skillId);
  const mcpIds = agentMcpRows.map((r) => r.mcpId);

  const [docRows, skillRows, mcpRows, envRows] = await Promise.all([
    docRefIds.length ? db.select().from(documents).where(inArray(documents.id, docRefIds)) : Promise.resolve([]),
    skillIds.length ? db.select().from(skills).where(inArray(skills.id, skillIds)) : Promise.resolve([]),
    mcpIds.length ? db.select().from(mcps).where(inArray(mcps.id, mcpIds)) : Promise.resolve([]),
    envRefIds.length
      ? db.select().from(envVars).where(and(eq(envVars.tenantId, run.tenantId), inArray(envVars.id, envRefIds)))
      : db.select().from(envVars).where(and(eq(envVars.tenantId, run.tenantId), eq(envVars.pinned, true))),
  ]);

  const scope = (agent.knowledgeScopeJson as { folders: string[]; tags: string[] }) ?? { folders: [], tags: [] };

  // Vector-retrieve knowledge relevant to this job, scoped to the agent.
  let knowledge: { chunk: string; source: string }[] = [];
  if (opts.retrieveKnowledge) {
    const query = [job?.instructions, agent.persona].filter(Boolean).join("\n").slice(0, 2000);
    if (query) knowledge = await opts.retrieveKnowledge(query, scope.folders).catch(() => []);
  }

  return {
    run: {
      id: run.id,
      status: run.status,
      triggerSource: run.triggerSource,
      scheduledFor: run.scheduledFor ? run.scheduledFor.toISOString() : null,
      sdkSessionId: run.sdkSessionId,
    },
    job: job ? { name: job.name, instructions: job.instructions, scheduleCron: job.scheduleCron } : null,
    agent: {
      key: agent.key,
      name: agent.name,
      persona: agent.persona,
      backend: agent.backend,
      model: agent.model,
      thinkingLevel: agent.thinkingLevel,
      autonomy: agent.autonomy,
      escalationPolicy: agent.escalationPolicy,
      budgetCapUsd: agent.budgetCapUsd ? Number(agent.budgetCapUsd) : null,
      runnerKind: agent.runnerKind,
    },
    docs: docRows.map((d) => ({ id: d.id, name: d.name, type: d.type })),
    skills: skillRows.map((s) => ({
      key: s.key,
      name: s.name,
      description: s.description,
      version: s.version,
      source: s.source,
      repoPath: s.repoPath,
    })),
    mcpServers: await Promise.all(
      mcpRows.map(async (m) => {
        let credentials: { vaultRef?: string; token?: string; ttlSeconds: number } | null = null;
        if (m.authType !== "none") {
          // Resolve a fresh, short-TTL token from the vault when a resolver is supplied.
          const resolved = opts.resolveToken ? await opts.resolveToken(m.id) : null;
          credentials = resolved
            ? { token: resolved.token, ttlSeconds: resolved.ttlSeconds }
            : { vaultRef: `vault://${run.tenantId}/${m.id}`, ttlSeconds: 300 };
        }
        return { name: m.name, transport: m.transport, endpoint: m.endpoint, authType: m.authType, scope: m.scope, credentials };
      }),
    ),
    knowledge,
    // Decrypt env values via the vault; never emit ciphertext. Omit if no decryptor.
    envVars: opts.decryptEnv
      ? Object.fromEntries(envRows.flatMap((e) => {
          try {
            return [[e.key, opts.decryptEnv!(e.encryptedValue)]] as [string, string][];
          } catch {
            return [];
          }
        }))
      : {},
    autonomy: agent.autonomy,
    escalationPolicy: agent.escalationPolicy,
    budgetCapUsd: agent.budgetCapUsd ? Number(agent.budgetCapUsd) : null,
    knowledgeScope: scope,
    api: {
      statusUrl: `${baseUrl}/api/runs/${run.id}/status`,
      activityUrl: `${baseUrl}/api/runs/${run.id}/activity`,
      approvalsUrl: `${baseUrl}/api/runs/${run.id}/approvals`,
      validStatuses: RUN_STATUSES,
    },
  };
}
