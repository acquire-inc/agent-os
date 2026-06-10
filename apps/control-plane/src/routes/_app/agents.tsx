import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Boxes, Cable, Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { architect, hasAdminKey } from "#/lib/api";
import type { Agent, Job, Run } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Drawer } from "#/components/ui/drawer";
import { Avatar, Separator, StatusDot } from "#/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentInProject, RUN_STATUS_LABEL, statusBadgeVariant } from "#/lib/helpers";
import { hasAllTags, matchesSearch } from "#/lib/helpers";
import { formatUsd, relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/agents")({ component: AgentsPage });

const SORTS = [
  { value: "name", label: "Name" },
  { value: "mtd", label: "MTD spend" },
  { value: "cost", label: "All-time cost" },
  { value: "recent", label: "Recently active" },
];
const SOURCES = [
  { value: "all", label: "All backends" },
  { value: "claude-agent-sdk", label: "Claude Agent SDK" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

function AgentsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("name");
  const [selected, setSelected] = useState<Agent | null>(null);

  const { data: agents = [], isLoading } = useQuery({ queryKey: ["agents", tenantId], queryFn: () => data.agents(tenantId!), enabled: Boolean(tenantId) });
  const { data: runs = [] } = useQuery({ queryKey: ["runs", tenantId], queryFn: () => data.runs(tenantId!), enabled: Boolean(tenantId) });
  // Phase 66: month-to-date spend per agent, sourced from applied
  // model.routed events (same wire as the Cost dashboard).
  const { data: mtdByAgent = new Map<string, number>() } = useQuery({
    queryKey: ["agentSpendThisMonth", tenantId],
    queryFn: () => data.agentSpendThisMonth(tenantId!),
    enabled: Boolean(tenantId),
  });

  const costByAgent = new Map<string, number>();
  const lastRunByAgent = new Map<string, Run>();
  for (const r of runs) {
    costByAgent.set(r.agentId, (costByAgent.get(r.agentId) ?? 0) + r.costUsd);
    const prev = lastRunByAgent.get(r.agentId);
    const t = r.startedAt ?? r.scheduledFor ?? "";
    if (!prev || t > (prev.startedAt ?? prev.scheduledFor ?? "")) lastRunByAgent.set(r.agentId, r);
  }

  const filtered = agents
    .filter((a) => agentInProject(a, activeProjectId))
    .filter((a) => f.filters.source === "all" || a.backend === f.filters.source)
    .filter((a) => hasAllTags(a.tags, f.filters.tags))
    .filter((a) => matchesSearch([a.name, a.key, a.persona ?? ""], f.filters.search));

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "mtd") return (mtdByAgent.get(b.id) ?? 0) - (mtdByAgent.get(a.id) ?? 0);
    if (f.filters.sort === "cost") return (costByAgent.get(b.id) ?? 0) - (costByAgent.get(a.id) ?? 0);
    if (f.filters.sort === "recent") {
      const at = lastRunByAgent.get(a.id)?.startedAt ?? "";
      const bt = lastRunByAgent.get(b.id)?.startedAt ?? "";
      return bt.localeCompare(at);
    }
    return a.name.localeCompare(b.name);
  });

  const allTags = [...new Set(agents.flatMap((a) => a.tags ?? []))].sort();

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Your workforce — each with a persona, model, autonomy, skills, and connectors."
        actions={<Button size="sm"><Plus className="size-4" /> New agent</Button>}
      />
      <div className="mb-4">
        <FilterBar
          filters={f.filters}
          onSearch={f.setSearch}
          onToggleTag={f.toggleTag}
          onSource={f.setSource}
          onSort={f.setSort}
          availableTags={allTags}
          sources={SOURCES}
          sortOptions={SORTS}
          searchPlaceholder="Search agents…"
        />
      </div>

      {isLoading ? (
        <CardGridSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Boxes className="size-8" />} title="No agents here yet" description="Create an agent or switch project scope." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              cost={costByAgent.get(a.id) ?? 0}
              mtdSpend={mtdByAgent.get(a.id) ?? 0}
              lastRun={lastRunByAgent.get(a.id)}
              onClick={() => setSelected(a)}
            />
          ))}
        </div>
      )}

      {selected && <AgentDrawer agent={selected} tenantId={tenantId!} onClose={() => setSelected(null)} />}
    </Page>
  );
}

function AgentCard({ agent, cost, mtdSpend, lastRun, onClick }: { agent: Agent; cost: number; mtdSpend: number; lastRun?: Run; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="cursor-pointer p-5 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-pop)]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={agent.name} className="size-10 rounded-xl" />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold leading-tight">{agent.name}</p>
              {!agent.enabled && <Badge>paused</Badge>}
            </div>
            <p className="font-mono text-xs text-muted-foreground">{agent.key}</p>
          </div>
        </div>
        {lastRun && <StatusDot status={lastRun.status} pulse={lastRun.status === "running"} />}
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{agent.persona ?? "No description."}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline">{agent.model.replace("claude-", "")}</Badge>
        <Badge variant="primary">{agent.autonomy}</Badge>
        {(agent.tags ?? []).slice(0, 2).map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>
      <Separator className="my-3" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{lastRun ? `Last run ${relativeTime(lastRun.startedAt ?? lastRun.scheduledFor)}` : "No runs yet"}</span>
        <div className="flex items-center gap-3 font-mono">
          <span title="Month-to-date spend from applied model.routed events">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">MTD</span> {formatUsd(mtdSpend)}
          </span>
          {cost > 0 && Math.abs(cost - mtdSpend) > 0.005 && (
            <span title="All-time cost from the runs table" className="text-muted-foreground/60">
              {formatUsd(cost)}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function AgentDrawer({ agent, tenantId, onClose }: { agent: Agent; tenantId: string; onClose: () => void }) {
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs", tenantId], queryFn: () => data.jobs(tenantId) });
  const { data: runs = [] } = useQuery({ queryKey: ["runs", tenantId], queryFn: () => data.runs(tenantId) });
  const { data: approvals = [] } = useQuery({ queryKey: ["approvals", tenantId], queryFn: () => data.approvals(tenantId) });

  const agentJobs = jobs.filter((j) => j.agentId === agent.id);
  const agentRuns = runs.filter((r) => r.agentId === agent.id);
  const agentApprovals = approvals.filter((a) => a.agentId === agent.id);

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-2xl"
      title={
        <div className="flex items-center gap-3">
          <Avatar name={agent.name} className="size-9 rounded-xl" />
          <div>
            <p className="font-semibold leading-tight">{agent.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{agent.key}</p>
          </div>
        </div>
      }
    >
      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="runs">Runs ({agentRuns.length})</TabsTrigger>
          <TabsTrigger value="approvals">Approvals ({agentApprovals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <p className="text-sm">{agent.persona ?? "No description."}</p>
          <RemixPanel agentKey={agent.key} agentName={agent.name} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Backend" value={agent.backend} />
            <Field label="Model" value={agent.model} />
            <Field label="Thinking" value={agent.thinkingLevel} />
            <Field label="Autonomy" value={agent.autonomy} />
            <Field label="Runner" value={agent.runnerKind} />
            <Field label="Budget cap" value={agent.budgetCapUsd ? formatUsd(agent.budgetCapUsd) : "—"} />
          </div>
          <div>
            <SubLabel>Jobs</SubLabel>
            {agentJobs.length === 0 ? <Muted>No jobs.</Muted> : (
              <div className="space-y-2">
                {agentJobs.map((j) => <JobRow key={j.id} job={j} />)}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <ChipGroup icon={<Sparkles className="size-3.5" />} label="Skills" items={agent.skillKeys ?? []} />
          <ChipGroup icon={<Cable className="size-3.5" />} label="MCPs / connectors" items={agent.mcpKeys ?? []} />
          <div>
            <SubLabel>Knowledge scope</SubLabel>
            <Muted>
              {(agent.knowledgeScope?.folders?.length ?? 0) === 0 && (agent.knowledgeScope?.tags?.length ?? 0) === 0
                ? "Inherits tenant defaults."
                : [...(agent.knowledgeScope?.folders ?? []), ...(agent.knowledgeScope?.tags ?? [])].join(", ")}
            </Muted>
          </div>
          <div>
            <SubLabel>Escalation policy</SubLabel>
            <Muted>{agent.escalationPolicy ?? "Default — propose anything irreversible."}</Muted>
          </div>
        </TabsContent>

        <TabsContent value="runs">
          {agentRuns.length === 0 ? <Muted>No runs yet.</Muted> : (
            <div className="space-y-2">
              {agentRuns.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-subtle px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={r.status} pulse={r.status === "running"} />
                    <div>
                      <p className="text-sm font-medium">{RUN_STATUS_LABEL[r.status]}</p>
                      <p className="text-xs text-muted-foreground">{relativeTime(r.startedAt ?? r.scheduledFor)}</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{r.costUsd > 0 ? formatUsd(r.costUsd) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="approvals">
          {agentApprovals.length === 0 ? <Muted>No approvals from this agent.</Muted> : (
            <div className="space-y-2">
              {agentApprovals.map((a) => (
                <div key={a.id} className="rounded-lg border border-border bg-subtle px-3.5 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={a.status === "open" ? "warning" : "default"}>{a.status}</Badge>
                  </div>
                  <p className="text-sm">{a.proposedAction}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Drawer>
  );
}

function RemixPanel({ agentKey, agentName }: { agentKey: string; agentName: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const noKey = !hasAdminKey();
  const remix = useMutation({
    mutationFn: () => architect.remix(agentKey, instruction),
    onSuccess: (r) => {
      setOpen(false);
      setInstruction("");
      navigate({ to: "/architect", search: { focus: r.blueprint.id } });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
      >
        <Wand2 className="size-3.5" /> Remix this agent
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-subtle p-3">
      <p className="mb-2 text-xs font-medium">Remix {agentName}</p>
      <p className="mb-2 text-xs text-muted-foreground">
        One-line instruction. The Architect returns a single-agent blueprint with the same key —
        landing in DB demotes the agent to autonomy=propose until you approve again.
      </p>
      {noKey && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-600">
          <AlertCircle className="size-3.5" /> Set an admin key on /settings first.
        </p>
      )}
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder='e.g. "switch to weekly on Mondays at 09:00"'
        rows={2}
        className="w-full rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        disabled={noKey || remix.isPending}
      />
      {remix.isError && (
        <p className="mt-2 text-xs text-destructive">{(remix.error as Error).message}</p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={() => remix.mutate()} disabled={noKey || !instruction.trim() || remix.isPending}>
          {remix.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          Propose remix
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}
function SubLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
function ChipGroup({ icon, label, items }: { icon: React.ReactNode; label: string; items: string[] }) {
  return (
    <div>
      <SubLabel>{label}</SubLabel>
      {items.length === 0 ? <Muted>None attached.</Muted> : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium">
              {icon}
              {i}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function JobRow({ job }: { job: Job }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-subtle px-3.5 py-2.5">
      <div>
        <p className="text-sm font-medium">{job.name}</p>
        <p className="font-mono text-xs text-muted-foreground">{job.scheduleCron}</p>
      </div>
      <Badge variant={statusBadgeVariant(job.enabled ? "done" : "skipped")}>{job.enabled ? "enabled" : "paused"}</Badge>
    </div>
  );
}
