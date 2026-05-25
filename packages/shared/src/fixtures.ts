// Canonical demo dataset. Used by the DB seed (packages/db) AND the app's
// demo-data fallback so the UI is always populated, with or without Supabase.
// IDs are stable so cross-references resolve deterministically.
import type {
  Agent,
  ApiKey,
  Approval,
  CostDay,
  Document,
  Job,
  KnowledgeFolder,
  Mcp,
  Profile,
  Project,
  Routine,
  Run,
  RunActivity,
  Skill,
  Tag,
  Tenant,
  TenantMember,
} from "./types.js";

const ACQU = "10000000-0000-0000-0000-000000000001";
const CLIENTLY = "10000000-0000-0000-0000-000000000002";
export const DEMO_USER_ID = "20000000-0000-0000-0000-000000000001";

export const TENANT_IDS = { acqu: ACQU, cliently: CLIENTLY };

export const demoTenants: Tenant[] = [
  {
    id: ACQU,
    name: "Acqu",
    slug: "acqu",
    type: "internal",
    status: "active",
    monthlyBudgetUsd: 2500,
    createdAt: "2026-01-02T00:00:00Z",
  },
  {
    id: CLIENTLY,
    name: "Cliently",
    slug: "cliently",
    type: "internal",
    status: "active",
    monthlyBudgetUsd: 1500,
    createdAt: "2026-02-10T00:00:00Z",
  },
];

export const demoProfile: Profile = {
  userId: DEMO_USER_ID,
  email: "you@acqu.co",
  name: "Founder",
  avatarUrl: null,
};

export const demoMembers: TenantMember[] = [
  { tenantId: ACQU, userId: DEMO_USER_ID, role: "owner" },
  { tenantId: CLIENTLY, userId: DEMO_USER_ID, role: "owner" },
];

// --- Projects ---
const P = {
  adOps: "30000000-0000-0000-0000-000000000001",
  clientSuccess: "30000000-0000-0000-0000-000000000002",
  founderOps: "30000000-0000-0000-0000-000000000003",
  growth: "30000000-0000-0000-0000-000000000004",
  core: "30000000-0000-0000-0000-000000000005",
  docs: "30000000-0000-0000-0000-000000000006",
  support: "30000000-0000-0000-0000-000000000007",
};

export const demoProjects: Project[] = [
  { id: P.adOps, tenantId: ACQU, name: "Ad-Ops", description: "Meta ad operations, creative tests, budget proposals." },
  { id: P.clientSuccess, tenantId: ACQU, name: "Client Success", description: "Onboarding, weekly reports, health & churn." },
  { id: P.founderOps, tenantId: ACQU, name: "Founder Ops", description: "Inbox triage, daily vitals, the Brief." },
  { id: P.growth, tenantId: ACQU, name: "Growth", description: "Lead scoring & routing." },
  { id: P.core, tenantId: CLIENTLY, name: "Cliently Core", description: "The product codebase." },
  { id: P.docs, tenantId: CLIENTLY, name: "Cliently Docs", description: "Product documentation." },
  { id: P.support, tenantId: CLIENTLY, name: "Cliently Support", description: "Customer support agent." },
];

const STARTER = [
  "meta", "marketing", "sales", "systems", "ops", "dev",
  "content", "finance", "client-success", "creative", "research",
];
export const demoTags: Tag[] = [ACQU, CLIENTLY].flatMap((tid) =>
  STARTER.map((name, i) => ({ id: `tag-${tid.slice(-1)}-${i}`, tenantId: tid, name })),
);

// --- Agents ---
const A = {
  adOps: "40000000-0000-0000-0000-000000000001",
  clientComms: "40000000-0000-0000-0000-000000000002",
  intel: "40000000-0000-0000-0000-000000000003",
  ea: "40000000-0000-0000-0000-000000000004",
  vitals: "40000000-0000-0000-0000-000000000005",
  briefing: "40000000-0000-0000-0000-000000000006",
  lead: "40000000-0000-0000-0000-000000000007",
  dev: "40000000-0000-0000-0000-000000000008",
  qa: "40000000-0000-0000-0000-000000000009",
  docs: "40000000-0000-0000-0000-00000000000a",
  support: "40000000-0000-0000-0000-00000000000b",
};
export const AGENT_IDS = A;

function agent(p: Partial<Agent> & Pick<Agent, "id" | "tenantId" | "key" | "name">): Agent {
  return {
    persona: null,
    backend: "claude-agent-sdk",
    model: "claude-sonnet-4-6",
    thinkingLevel: "medium",
    autonomy: "execute_safe",
    knowledgeScope: { folders: [], tags: [] },
    budgetCapUsd: 50,
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
    projectIds: [],
    tags: [],
    skillKeys: [],
    mcpKeys: [],
    ...p,
  };
}

export const demoAgents: Agent[] = [
  agent({ id: A.adOps, tenantId: ACQU, key: "ad-ops", name: "Ad-Ops", persona: "Runs daily Meta performance pulls, proposes creative tests and budget shifts.", autonomy: "propose", model: "claude-sonnet-4-6", projectIds: [P.adOps], tags: ["meta", "marketing", "ops"], skillKeys: ["daily-ad-ops", "creative-generation"], mcpKeys: ["pipeboard", "close", "slack"] }),
  agent({ id: A.clientComms, tenantId: ACQU, key: "client-comms", name: "Client Comms", persona: "Handles onboarding and weekly client reporting.", projectIds: [P.clientSuccess], tags: ["client-success", "ops"], skillKeys: ["client-onboarding", "weekly-client-reporting"], mcpKeys: ["close", "slack", "drive"] }),
  agent({ id: A.intel, tenantId: ACQU, key: "intel", name: "Intel", persona: "Scans client health and churn risk from transcripts and CRM.", projectIds: [P.clientSuccess], tags: ["client-success", "research"], skillKeys: ["client-health-scan", "churn-risk-detection"], mcpKeys: ["fireflies", "pgvector"] }),
  agent({ id: A.ea, tenantId: ACQU, key: "ea", name: "EA", persona: "Inbox triage and scheduling for the founder.", autonomy: "propose", model: "claude-haiku-4-5", thinkingLevel: "low", projectIds: [P.founderOps], tags: ["systems", "ops"], skillKeys: ["clarify-before-acting"], mcpKeys: ["gmail", "slack"] }),
  agent({ id: A.vitals, tenantId: ACQU, key: "vitals", name: "Vitals", persona: "Pulls daily company vitals every morning.", model: "claude-haiku-4-5", projectIds: [P.founderOps], tags: ["systems", "ops"], mcpKeys: ["close", "pipeboard"] }),
  agent({ id: A.briefing, tenantId: ACQU, key: "briefing", name: "Briefing", persona: "Compiles the morning Brief.", model: "claude-sonnet-4-6", projectIds: [P.founderOps], tags: ["systems", "content"], mcpKeys: ["slack"] }),
  agent({ id: A.lead, tenantId: ACQU, key: "lead", name: "Lead Router", persona: "Scores and routes inbound leads.", projectIds: [P.growth], tags: ["sales"], skillKeys: ["lead-routing-qualification"], mcpKeys: ["close", "slack"] }),
  agent({ id: A.dev, tenantId: CLIENTLY, key: "dev", name: "Dev", persona: "Spec-driven development on the Cliently codebase using GSD.", model: "claude-opus-4-7", thinkingLevel: "high", autonomy: "propose", projectIds: [P.core], tags: ["dev", "systems"], skillKeys: ["gsd", "systematic-debugging"], mcpKeys: ["github", "playwright"] }),
  agent({ id: A.qa, tenantId: CLIENTLY, key: "qa", name: "QA", persona: "Verification before completion.", projectIds: [P.core], tags: ["dev"], skillKeys: ["verification-before-completion"], mcpKeys: ["github", "playwright"] }),
  agent({ id: A.docs, tenantId: CLIENTLY, key: "docs", name: "Docs", persona: "Writes and maintains product documentation.", model: "claude-sonnet-4-6", projectIds: [P.docs], tags: ["dev", "content"], mcpKeys: ["github"] }),
  agent({ id: A.support, tenantId: CLIENTLY, key: "support", name: "Support", persona: "Answers customer questions.", enabled: false, projectIds: [P.support], tags: ["dev", "client-success"], mcpKeys: ["slack", "github"] }),
];

// --- Jobs ---
const J = {
  adPull: "50000000-0000-0000-0000-000000000001",
  weeklyReport: "50000000-0000-0000-0000-000000000002",
  healthScan: "50000000-0000-0000-0000-000000000003",
  inboxTriage: "50000000-0000-0000-0000-000000000004",
  dailyVitals: "50000000-0000-0000-0000-000000000005",
  theBrief: "50000000-0000-0000-0000-000000000006",
  leadScore: "50000000-0000-0000-0000-000000000007",
};
export const JOB_IDS = J;

export const demoJobs: Job[] = [
  { id: J.adPull, tenantId: ACQU, agentId: A.adOps, name: "Daily performance pull", scheduleCron: "0 7 * * *", instructions: "Pull yesterday's Meta performance across all accounts; flag anomalies; propose budget shifts and 2 creative tests.", modelOverride: null, thinkingOverride: null, enabled: true, tags: ["meta", "marketing"] },
  { id: J.weeklyReport, tenantId: ACQU, agentId: A.clientComms, name: "Weekly client reporting", scheduleCron: "0 7 * * 6", instructions: "Generate the weekly client report from CRM + ad data; draft the summary email.", modelOverride: null, thinkingOverride: null, enabled: true, tags: ["client-success"] },
  { id: J.healthScan, tenantId: ACQU, agentId: A.intel, name: "Client health scan", scheduleCron: "0 6 * * 1", instructions: "Scan transcripts and CRM signals for churn risk; rank accounts.", modelOverride: null, thinkingOverride: null, enabled: true, tags: ["client-success", "research"] },
  { id: J.inboxTriage, tenantId: ACQU, agentId: A.ea, name: "Inbox triage", scheduleCron: "0 8,12,16 * * *", instructions: "Triage the founder's inbox into action / waiting / FYI; draft replies for approval.", modelOverride: null, thinkingOverride: null, enabled: true, tags: ["ops"] },
  { id: J.dailyVitals, tenantId: ACQU, agentId: A.vitals, name: "Daily vitals", scheduleCron: "30 6 * * *", instructions: "Pull revenue, spend, pipeline, and cash vitals.", modelOverride: null, thinkingOverride: null, enabled: true, tags: ["systems"] },
  { id: J.theBrief, tenantId: ACQU, agentId: A.briefing, name: "The morning Brief", scheduleCron: "0 8 * * *", instructions: "Compile vitals + ad-ops + inbox into a single Brief and post to Slack.", modelOverride: null, thinkingOverride: null, enabled: true, tags: ["systems", "content"] },
  { id: J.leadScore, tenantId: ACQU, agentId: A.lead, name: "Score & route new leads", scheduleCron: "*/30 * * * *", instructions: "Score new inbound leads and route to the right rep.", modelOverride: "claude-haiku-4-5", thinkingOverride: "low", enabled: true, tags: ["sales"] },
];

// --- Runs ---
function iso(daysAgo: number, h = 7, m = 0): string {
  const d = new Date("2026-05-25T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

export const demoRuns: Run[] = [
  { id: "60000000-0000-0000-0000-000000000001", tenantId: ACQU, agentId: A.adOps, jobId: J.adPull, status: "running", triggerSource: "schedule", scheduledFor: iso(0), claimedBy: "runner-acqu-1", startedAt: iso(0, 7, 1), endedAt: null, tokensIn: 48000, tokensOut: 3200, costUsd: 0.42, summary: null, sdkSessionId: "sess_ad_001" },
  { id: "60000000-0000-0000-0000-000000000002", tenantId: ACQU, agentId: A.vitals, jobId: J.dailyVitals, status: "done", triggerSource: "schedule", scheduledFor: iso(0, 6, 30), claimedBy: "runner-acqu-1", startedAt: iso(0, 6, 30), endedAt: iso(0, 6, 33), tokensIn: 12000, tokensOut: 900, costUsd: 0.04, summary: "Revenue $14.2k, spend $3.1k, pipeline 23 deals, cash runway 9mo.", sdkSessionId: "sess_vit_001" },
  { id: "60000000-0000-0000-0000-000000000003", tenantId: ACQU, agentId: A.intel, jobId: J.healthScan, status: "waiting", triggerSource: "schedule", scheduledFor: iso(0, 6, 0), claimedBy: "runner-acqu-1", startedAt: iso(0, 6, 0), endedAt: null, tokensIn: 90000, tokensOut: 5400, costUsd: 0.88, summary: null, sdkSessionId: "sess_int_001" },
  { id: "60000000-0000-0000-0000-000000000004", tenantId: ACQU, agentId: A.ea, jobId: J.inboxTriage, status: "scheduled", triggerSource: "schedule", scheduledFor: iso(0, 12, 0), claimedBy: null, startedAt: null, endedAt: null, tokensIn: 0, tokensOut: 0, costUsd: 0, summary: null, sdkSessionId: null },
  { id: "60000000-0000-0000-0000-000000000005", tenantId: ACQU, agentId: A.lead, jobId: J.leadScore, status: "done", triggerSource: "schedule", scheduledFor: iso(0, 9, 30), claimedBy: "runner-acqu-1", startedAt: iso(0, 9, 30), endedAt: iso(0, 9, 31), tokensIn: 6000, tokensOut: 400, costUsd: 0.01, summary: "Scored 4 leads; routed 2 to Sarah, 1 to Mike, 1 disqualified.", sdkSessionId: "sess_lead_009" },
  { id: "60000000-0000-0000-0000-000000000006", tenantId: ACQU, agentId: A.clientComms, jobId: J.weeklyReport, status: "failed", triggerSource: "schedule", scheduledFor: iso(2, 7, 0), claimedBy: "runner-acqu-1", startedAt: iso(2, 7, 0), endedAt: iso(2, 7, 4), tokensIn: 32000, tokensOut: 2100, costUsd: 0.31, summary: "Close API returned 401 — token needs reauth.", sdkSessionId: "sess_cc_044" },
  { id: "60000000-0000-0000-0000-000000000007", tenantId: ACQU, agentId: A.briefing, jobId: J.theBrief, status: "done", triggerSource: "routine", scheduledFor: iso(1, 8, 0), claimedBy: "runner-acqu-1", startedAt: iso(1, 8, 0), endedAt: iso(1, 8, 2), tokensIn: 22000, tokensOut: 1800, costUsd: 0.12, summary: "Brief posted to #founder. 3 items flagged for review.", sdkSessionId: "sess_brf_031" },
  { id: "60000000-0000-0000-0000-000000000008", tenantId: ACQU, agentId: A.adOps, jobId: J.adPull, status: "skipped", triggerSource: "schedule", scheduledFor: iso(1, 7, 0), claimedBy: "runner-acqu-1", startedAt: iso(1, 7, 0), endedAt: iso(1, 7, 0), tokensIn: 800, tokensOut: 0, costUsd: 0, summary: "No new spend since last run — nothing to do.", sdkSessionId: null },
  { id: "60000000-0000-0000-0000-000000000009", tenantId: CLIENTLY, agentId: A.dev, jobId: null, status: "running", triggerSource: "manual", scheduledFor: iso(0, 10, 0), claimedBy: "runner-cliently-1", startedAt: iso(0, 10, 0), endedAt: null, tokensIn: 120000, tokensOut: 14000, costUsd: 2.10, summary: null, sdkSessionId: "sess_dev_120" },
  { id: "60000000-0000-0000-0000-00000000000a", tenantId: CLIENTLY, agentId: A.docs, jobId: null, status: "done", triggerSource: "manual", scheduledFor: iso(1, 14, 0), claimedBy: "runner-cliently-1", startedAt: iso(1, 14, 0), endedAt: iso(1, 14, 6), tokensIn: 40000, tokensOut: 6000, costUsd: 0.55, summary: "Updated the Connections guide and API reference.", sdkSessionId: "sess_doc_077" },
];

export const demoRunActivity: RunActivity[] = [
  { id: "a1", runId: "60000000-0000-0000-0000-000000000002", ts: iso(0, 6, 30), kind: "start", message: "Run claimed by runner-acqu-1" },
  { id: "a2", runId: "60000000-0000-0000-0000-000000000002", ts: iso(0, 6, 31), kind: "tool", message: "close.get_metrics(period=yesterday)" },
  { id: "a3", runId: "60000000-0000-0000-0000-000000000002", ts: iso(0, 6, 32), kind: "tool", message: "pipeboard.get_spend(period=yesterday)" },
  { id: "a4", runId: "60000000-0000-0000-0000-000000000002", ts: iso(0, 6, 33), kind: "summary", message: "Revenue $14.2k, spend $3.1k, pipeline 23 deals, cash runway 9mo." },
  { id: "a5", runId: "60000000-0000-0000-0000-000000000003", ts: iso(0, 6, 1), kind: "tool", message: "fireflies.list_transcripts(since=7d)" },
  { id: "a6", runId: "60000000-0000-0000-0000-000000000003", ts: iso(0, 6, 4), kind: "propose", message: "Account 'Northwind' shows churn signals — propose outreach. Awaiting approval." },
];

// --- Routines ---
export const demoRoutines: Routine[] = [
  { id: "70000000-0000-0000-0000-000000000001", tenantId: ACQU, projectId: P.founderOps, name: "Daily Founder Ops", cadence: "daily", jobIds: [J.dailyVitals, J.adPull, J.inboxTriage, J.theBrief], enabled: true },
  { id: "70000000-0000-0000-0000-000000000002", tenantId: ACQU, projectId: P.clientSuccess, name: "Weekly Client Success", cadence: "weekly", jobIds: [J.weeklyReport, J.healthScan], enabled: true },
  { id: "70000000-0000-0000-0000-000000000003", tenantId: ACQU, projectId: null, name: "Monthly Portfolio Review", cadence: "monthly", jobIds: [], enabled: false },
];

// --- Skills ---
function skill(p: Partial<Skill> & Pick<Skill, "id" | "tenantId" | "key" | "name" | "description">): Skill {
  return { projectId: null, version: "1.0.0", source: "github", repoPath: null, scope: "global", enabled: true, tags: [], ...p };
}
export const demoSkills: Skill[] = [
  skill({ id: "80000000-0000-0000-0000-000000000001", tenantId: ACQU, key: "daily-ad-ops", name: "Daily Ad Ops", description: "Pull performance, detect anomalies, propose budget + creative changes.", source: "github", repoPath: "acqu-skills/daily-ad-ops", tags: ["meta", "ops"] }),
  skill({ id: "80000000-0000-0000-0000-000000000002", tenantId: ACQU, key: "creative-generation", name: "Creative Generation", description: "Generate ad creative variations for testing.", source: "github", repoPath: "acqu-skills/creative-generation", tags: ["creative", "marketing"] }),
  skill({ id: "80000000-0000-0000-0000-000000000003", tenantId: ACQU, key: "client-onboarding", name: "Client Onboarding", description: "Run the standard client onboarding sequence.", source: "github", repoPath: "acqu-skills/client-onboarding", tags: ["client-success"] }),
  skill({ id: "80000000-0000-0000-0000-000000000004", tenantId: ACQU, key: "weekly-client-reporting", name: "Weekly Client Reporting", description: "Compile and format the weekly client report.", source: "github", repoPath: "acqu-skills/weekly-client-reporting", tags: ["client-success", "content"] }),
  skill({ id: "80000000-0000-0000-0000-000000000005", tenantId: ACQU, key: "churn-risk-detection", name: "Churn Risk Detection", description: "Detect churn signals across CRM and transcripts.", source: "github", repoPath: "acqu-skills/churn-risk-detection", tags: ["client-success", "research"] }),
  skill({ id: "80000000-0000-0000-0000-000000000006", tenantId: ACQU, key: "clarify-before-acting", name: "Clarify Before Acting", description: "Ask a multiple-choice clarifying question before taking ambiguous action.", source: "github", repoPath: "acqu-skills/clarify-before-acting", tags: ["systems"] }),
  skill({ id: "80000000-0000-0000-0000-000000000007", tenantId: ACQU, key: "lead-routing-qualification", name: "Lead Routing & Qualification", description: "Score and route inbound leads.", source: "github", repoPath: "acqu-skills/lead-routing-qualification", tags: ["sales"] }),
  skill({ id: "80000000-0000-0000-0000-000000000008", tenantId: CLIENTLY, key: "gsd", name: "GSD (Get Shit Done)", description: "Spec-driven dev: phased research → plan → execute with per-agent model selection.", source: "github", repoPath: "open-gsd/get-shit-done", tags: ["dev"] }),
  skill({ id: "80000000-0000-0000-0000-000000000009", tenantId: CLIENTLY, key: "systematic-debugging", name: "Systematic Debugging", description: "Root-cause debugging loop.", source: "github", repoPath: "obra/superpowers", tags: ["dev"] }),
  skill({ id: "80000000-0000-0000-0000-00000000000a", tenantId: CLIENTLY, key: "verification-before-completion", name: "Verification Before Completion", description: "Verify behavior in the real app before marking work done.", source: "github", repoPath: "obra/superpowers", tags: ["dev"] }),
];

// --- MCPs ---
function mcp(p: Partial<Mcp> & Pick<Mcp, "id" | "tenantId" | "name">): Mcp {
  return { projectId: null, transport: "http", endpoint: null, authType: "oauth", scope: "global", status: "connected", lastHealthCheck: iso(0, 6, 0), tags: [], ...p };
}
export const demoMcps: Mcp[] = [
  mcp({ id: "90000000-0000-0000-0000-000000000001", tenantId: ACQU, name: "Close", authType: "oauth", status: "needs_reauth", tags: ["sales", "client-success"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000002", tenantId: ACQU, name: "Pipeboard × Meta", authType: "oauth", status: "connected", tags: ["meta", "marketing"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000003", tenantId: ACQU, name: "Slack", authType: "oauth", status: "connected", tags: ["ops"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000004", tenantId: ACQU, name: "Google Drive", authType: "oauth", status: "connected", tags: ["ops"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000005", tenantId: ACQU, name: "Fireflies", authType: "api_key", status: "connected", tags: ["client-success"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000006", tenantId: ACQU, name: "Gmail", authType: "oauth", status: "connected", tags: ["ops"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000007", tenantId: ACQU, name: "pgvector Knowledge", transport: "stdio", authType: "api_key", status: "connected", tags: ["systems"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000008", tenantId: CLIENTLY, name: "GitHub", authType: "oauth", status: "connected", tags: ["dev"] }),
  mcp({ id: "90000000-0000-0000-0000-000000000009", tenantId: CLIENTLY, name: "Playwright", transport: "stdio", authType: "none", status: "connected", tags: ["dev"] }),
];

// --- Knowledge ---
export const demoFolders: KnowledgeFolder[] = [
  { id: "k1", tenantId: ACQU, projectId: P.clientSuccess, parentId: null, name: "Clients", path: "/Clients" },
  { id: "k2", tenantId: ACQU, projectId: P.adOps, parentId: null, name: "Ad Playbooks", path: "/Ad Playbooks" },
  { id: "k3", tenantId: ACQU, projectId: P.founderOps, parentId: null, name: "Memory", path: "/Memory" },
];
export const demoDocuments: Document[] = [
  { id: "d1", tenantId: ACQU, projectId: P.clientSuccess, folderId: "k1", name: "acqu_clientsuccess_playbook_onboarding_2026-03-01", type: "markdown", source: "upload", vectorNamespace: "acqu/client-success", vectorIndexed: true, version: 2, updatedAt: iso(20), tags: ["client-success"] },
  { id: "d2", tenantId: ACQU, projectId: P.adOps, folderId: "k2", name: "acqu_adops_playbook_creative-testing_2026-04-12", type: "markdown", source: "agent-generated", vectorNamespace: "acqu/ad-ops", vectorIndexed: true, version: 1, updatedAt: iso(8), tags: ["meta", "creative"] },
  { id: "d3", tenantId: ACQU, projectId: P.founderOps, folderId: "k3", name: "acqu_founderops_memory_what-we-know_2026-05-18", type: "markdown", source: "agent-generated", vectorNamespace: "acqu/memory", vectorIndexed: true, version: 7, updatedAt: iso(2), tags: ["systems"] },
  { id: "d4", tenantId: ACQU, projectId: P.clientSuccess, folderId: "k1", name: "acqu_clientsuccess_transcript_northwind-qbr_2026-05-23", type: "transcript", source: "call-transcript", vectorNamespace: "acqu/client-success", vectorIndexed: false, version: 1, updatedAt: iso(2), tags: ["client-success"] },
];

// --- Approvals ---
export const demoApprovals: Approval[] = [
  {
    id: "ap1", runId: "60000000-0000-0000-0000-000000000003", tenantId: ACQU, agentId: A.intel,
    context: "Northwind Co. shows 3 churn signals: usage down 40%, a negative QBR sentiment, and an unanswered renewal email.",
    proposedAction: "Trigger a save play: draft a check-in email from the AM and schedule a call.",
    options: [
      { key: "1A", label: "Send the check-in email now" },
      { key: "1B", label: "Draft it for me to review first" },
      { key: "1C", label: "Escalate to the founder" },
      { key: "none", label: "Do nothing" },
    ],
    status: "open", decidedBy: null, decidedAt: null, createdAt: iso(0, 6, 4),
  },
  {
    id: "ap2", runId: "60000000-0000-0000-0000-000000000001", tenantId: ACQU, agentId: A.adOps,
    context: "Campaign 'Spring-Prospecting' CPA rose 28% over 3 days while 'Retargeting-Q2' held steady.",
    proposedAction: "Shift $200/day from Spring-Prospecting to Retargeting-Q2.",
    options: [
      { key: "1A", label: "Make the shift" },
      { key: "1B", label: "Shift half ($100/day)" },
      { key: "none", label: "Hold — don't change budgets" },
    ],
    status: "open", decidedBy: null, decidedAt: null, createdAt: iso(0, 7, 20),
  },
];

// --- Cost ---
export const demoCostDays: CostDay[] = (() => {
  const rows: CostDay[] = [];
  for (let d = 13; d >= 0; d--) {
    rows.push({ tenantId: ACQU, projectId: null, agentId: null, day: iso(d, 0, 0).slice(0, 10), costUsd: Math.round((1.2 + Math.random() * 2.4) * 100) / 100, tokensIn: 200000 + Math.floor(Math.random() * 150000), tokensOut: 18000 + Math.floor(Math.random() * 12000) });
    rows.push({ tenantId: CLIENTLY, projectId: null, agentId: null, day: iso(d, 0, 0).slice(0, 10), costUsd: Math.round((0.6 + Math.random() * 1.8) * 100) / 100, tokensIn: 120000 + Math.floor(Math.random() * 90000), tokensOut: 14000 + Math.floor(Math.random() * 9000) });
  }
  return rows;
})();

// --- API keys ---
export const demoApiKeys: ApiKey[] = [
  { id: "key1", tenantId: ACQU, kind: "runner", name: "Acqu VPS runner", hashPreview: "aos_run_…7f2a", createdBy: DEMO_USER_ID, createdAt: iso(40) },
  { id: "key2", tenantId: ACQU, kind: "admin", name: "Management agent", hashPreview: "aos_adm_…91c4", createdBy: DEMO_USER_ID, createdAt: iso(35) },
];
