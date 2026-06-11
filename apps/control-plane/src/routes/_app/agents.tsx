import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Boxes, Cable, Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { architect, hasAdminKey } from "#/lib/api";
import { AUTONOMY_LEVELS, THINKING_LEVELS, type Agent, type Autonomy, type Job, type Mcp, type Run, type ThinkingLevel } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Drawer } from "#/components/ui/drawer";
import { Avatar, Input, Separator, StatusDot } from "#/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { addUserAgent, setAgentOverride } from "#/lib/agent-store";
import { AGENT_TEMPLATES, TEMPLATE_CATEGORIES, blankAgent, templateToAgent, type AgentTemplate } from "#/lib/agent-templates";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentInProject, RUN_STATUS_LABEL, statusBadgeVariant } from "#/lib/helpers";
import { hasAllTags, matchesSearch } from "#/lib/helpers";
import { cn, formatUsd, relativeTime } from "#/lib/utils";

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
  const [deployOpen, setDeployOpen] = useState(false);
  const qc = useQueryClient();

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
        actions={<Button size="sm" onClick={() => setDeployOpen(true)}><Plus className="size-4" /> New agent</Button>}
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

      {selected && (
        <AgentDrawer
          agent={selected}
          tenantId={tenantId!}
          onClose={() => setSelected(null)}
          onUpdated={(a) => setSelected(a)}
        />
      )}

      {tenantId && (
        <DeployAgentDrawer
          open={deployOpen}
          onClose={() => setDeployOpen(false)}
          tenantId={tenantId}
          onDeployed={(a) => {
            qc.invalidateQueries({ queryKey: ["agents", tenantId] });
            setDeployOpen(false);
            setSelected(a);
          }}
        />
      )}
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

function AgentDrawer({ agent, tenantId, onClose, onUpdated }: { agent: Agent; tenantId: string; onClose: () => void; onUpdated: (a: Agent) => void }) {
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
          <AgentControlPanel agent={agent} tenantId={tenantId} onSaved={onUpdated} />
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

// --- Editable agent control surface -----------------------------------------

const AUTONOMY_LABEL: Record<Autonomy, string> = {
  propose: "Propose",
  execute_safe: "Execute safe",
  execute_full: "Execute full",
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
  labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-all",
            value === o ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function AgentControlPanel({ agent, tenantId, onSaved }: { agent: Agent; tenantId: string; onSaved: (a: Agent) => void }) {
  const qc = useQueryClient();
  const { data: mcps = [] } = useQuery({ queryKey: ["mcps", tenantId], queryFn: () => data.mcps(tenantId), enabled: Boolean(tenantId) });

  const [enabled, setEnabled] = useState(agent.enabled);
  const [autonomy, setAutonomy] = useState<Autonomy>(agent.autonomy);
  const [thinking, setThinking] = useState<ThinkingLevel>(agent.thinkingLevel);
  const [budget, setBudget] = useState(agent.budgetCapUsd != null ? String(agent.budgetCapUsd) : "");
  const [escalation, setEscalation] = useState(agent.escalationPolicy ?? "");
  const [bindings, setBindings] = useState<string[]>(agent.mcpKeys ?? []);

  const bound = (mcp: Mcp) => bindings.some((b) => b.toLowerCase() === mcp.name.toLowerCase());
  const toggle = (mcp: Mcp) =>
    setBindings((b) =>
      bound(mcp) ? b.filter((x) => x.toLowerCase() !== mcp.name.toLowerCase()) : [...b, mcp.name],
    );

  const patch = {
    enabled,
    autonomy,
    thinkingLevel: thinking,
    budgetCapUsd: budget.trim() === "" ? null : Number(budget),
    escalationPolicy: escalation.trim() === "" ? null : escalation.trim(),
    mcpKeys: bindings,
  };
  const baseline = {
    enabled: agent.enabled,
    autonomy: agent.autonomy,
    thinkingLevel: agent.thinkingLevel,
    budgetCapUsd: agent.budgetCapUsd,
    escalationPolicy: agent.escalationPolicy,
    mcpKeys: agent.mcpKeys ?? [],
  };
  const dirty = JSON.stringify(patch) !== JSON.stringify(baseline);
  const budgetInvalid = budget.trim() !== "" && (Number.isNaN(Number(budget)) || Number(budget) < 0);

  const save = useMutation({
    mutationFn: async () => {
      setAgentOverride(tenantId, agent.id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", tenantId] });
      onSaved({ ...agent, ...patch });
    },
  });

  function reset() {
    setEnabled(agent.enabled);
    setAutonomy(agent.autonomy);
    setThinking(agent.thinkingLevel);
    setBudget(agent.budgetCapUsd != null ? String(agent.budgetCapUsd) : "");
    setEscalation(agent.escalationPolicy ?? "");
    setBindings(agent.mcpKeys ?? []);
  }

  return (
    <div className="space-y-5">
      {/* Enabled */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-subtle px-3.5 py-2.5">
        <div>
          <p className="text-sm font-medium">{enabled ? "Active" : "Paused"}</p>
          <p className="text-xs text-muted-foreground">{enabled ? "This agent runs on its triggers." : "Triggers are suppressed until re-enabled."}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((e) => !e)}
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", enabled ? "bg-primary" : "bg-muted-foreground/30")}
        >
          <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div>
        <SubLabel>Autonomy</SubLabel>
        <Segmented value={autonomy} options={AUTONOMY_LEVELS} onChange={setAutonomy} labels={AUTONOMY_LABEL} />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {autonomy === "propose" && "Proposes every action for approval — nothing runs unattended."}
          {autonomy === "execute_safe" && "Runs reversible actions; proposes anything irreversible."}
          {autonomy === "execute_full" && "Runs autonomously within its budget and tool scope."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <SubLabel>Thinking</SubLabel>
          <Segmented value={thinking} options={THINKING_LEVELS} onChange={setThinking} />
        </div>
        <div>
          <SubLabel>Budget cap (per run)</SubLabel>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No cap" inputMode="decimal" />
          </div>
          {budgetInvalid && <p className="mt-1 text-xs text-danger">Enter a non-negative number.</p>}
        </div>
      </div>

      <div>
        <SubLabel>Connector access ({bindings.length})</SubLabel>
        <p className="mb-2 text-xs text-muted-foreground">Which tools this agent may act through.</p>
        {mcps.length === 0 ? (
          <Muted>No connectors available.</Muted>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {mcps.map((m) => {
              const on = bound(m);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    on ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Cable className="size-3" />
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <SubLabel>Escalation policy</SubLabel>
        <textarea
          value={escalation}
          onChange={(e) => setEscalation(e.target.value)}
          rows={2}
          placeholder="Default — propose anything irreversible."
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <ChipGroup icon={<Sparkles className="size-3.5" />} label="Skills (read-only)" items={agent.skillKeys ?? []} />

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {dirty && (
          <Button type="button" variant="ghost" onClick={reset}>
            Reset
          </Button>
        )}
        <Button type="button" disabled={!dirty || budgetInvalid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </div>
  );
}

// --- Deploy agent (template gallery) ----------------------------------------

function DeployAgentDrawer({
  open,
  onClose,
  tenantId,
  onDeployed,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  onDeployed: (a: Agent) => void;
}) {
  const [cat, setCat] = useState("All");
  const [blankName, setBlankName] = useState("");

  const templates = AGENT_TEMPLATES.filter((t) => cat === "All" || t.category === cat);

  function deploy(template: AgentTemplate) {
    const a = templateToAgent(tenantId, template);
    addUserAgent(tenantId, a);
    onDeployed(a);
  }
  function deployBlank() {
    const a = blankAgent(tenantId, blankName);
    addUserAgent(tenantId, a);
    setBlankName("");
    onDeployed(a);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={
        <div>
          <h2 className="text-base font-semibold">Deploy an agent</h2>
          <p className="text-xs text-muted-foreground">Start from a template — it lands in propose mode for you to tune.</p>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {["All", ...TEMPLATE_CATEGORIES].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                cat === c ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.key} className="flex flex-col rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t.name}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">{t.category}</Badge>
              </div>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{t.persona}</p>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {t.connectors.slice(0, 3).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-md border border-border bg-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <Cable className="size-2.5" /> {c}
                  </span>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => deploy(t)}>
                <Plus className="size-3.5" /> Deploy
              </Button>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-dashed border-border p-4">
          <SubLabel>Or start blank</SubLabel>
          <div className="flex items-center gap-2">
            <Input value={blankName} onChange={(e) => setBlankName(e.target.value)} placeholder="Agent name" />
            <Button size="sm" variant="outline" onClick={deployBlank} disabled={!blankName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
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
