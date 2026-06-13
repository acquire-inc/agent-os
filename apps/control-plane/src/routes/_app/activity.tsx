import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Cable, FileText, MessageSquareWarning, Play, Radio, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import type { FleetActivityItem, FleetActivityKind } from "@agent-os/shared";
import { markActivityViewed } from "#/components/onboarding-checklist";
import { EmptyState, Page, PageHeader } from "#/components/shell/page";
import { KpiCard } from "#/components/shell/metrics";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Avatar } from "#/components/ui/misc";
import { Menu, MenuItem, MenuLabel } from "#/components/ui/menu";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentInProject, agentMap } from "#/lib/helpers";
import { cn } from "#/lib/utils";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/activity")({ component: ActivityPage });

const KIND_FILTERS: { value: FleetActivityKind | "all"; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "tool", label: "Tool calls" },
  { value: "proposal", label: "Proposals" },
  { value: "summary", label: "Summaries" },
  { value: "lease", label: "Lease decisions" },
  { value: "handoff", label: "Handoffs" },
  { value: "critic", label: "Critic quorum" },
  { value: "improvement", label: "Improvements" },
  { value: "circuit", label: "Circuit-breaker" },
];

function kindMeta(kind: FleetActivityKind): { icon: typeof Wrench; tone: string; label: string } {
  switch (kind) {
    case "tool":
      return { icon: Wrench, tone: "text-info", label: "Tool call" };
    case "proposal":
      return { icon: MessageSquareWarning, tone: "text-warning", label: "Proposal" };
    case "summary":
      return { icon: FileText, tone: "text-success", label: "Summary" };
    case "start":
      return { icon: Play, tone: "text-muted-foreground", label: "Started" };
    case "lease":
      return { icon: Radio, tone: "text-warning", label: "Lease" };
    case "handoff":
      return { icon: Wrench, tone: "text-info", label: "Handoff" };
    case "critic":
      return { icon: MessageSquareWarning, tone: "text-success", label: "Critic" };
    case "improvement":
      return { icon: FileText, tone: "text-info", label: "Improvement" };
    case "circuit":
      return { icon: Radio, tone: "text-destructive", label: "Circuit" };
    default:
      return { icon: Radio, tone: "text-muted-foreground", label: "Status" };
  }
}

function ActivityPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const [kind, setKind] = useState<FleetActivityKind | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  // Mark the onboarding "watch it work" step complete on first view.
  useEffect(() => {
    markActivityViewed();
  }, []);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["fleetActivity", tenantId],
    queryFn: () => data.fleetActivity(tenantId!),
    enabled: Boolean(tenantId),
    refetchInterval: 15_000, // keep the feed feeling live
  });
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const amap = agentMap(agents);
  const inScope = (item: FleetActivityItem) => agentInProject(amap.get(item.agentId), activeProjectId);

  const scoped = items.filter(inScope);
  const filtered = scoped
    .filter((i) => agentFilter === "all" || i.agentId === agentFilter)
    .filter((i) => kind === "all" || i.kind === kind);

  const toolCalls = scoped.filter((i) => i.kind === "tool").length;
  const proposals = scoped.filter((i) => i.kind === "proposal").length;
  const activeAgents = new Set(scoped.map((i) => i.agentId)).size;
  const connectors = new Set(scoped.filter((i) => i.connector).map((i) => i.connector)).size;

  const activeAgentList = [...new Set(scoped.map((i) => i.agentId))]
    .map((id) => ({ id, name: amap.get(id)?.name ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const agentLabel = agentFilter === "all" ? "All agents" : amap.get(agentFilter)?.name ?? "All agents";

  return (
    <Page>
      <PageHeader
        title="Activity"
        description="Everything your agents are doing across every connected tool — one live stream."
        actions={
          <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Live
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Actions (24h)" value={String(scoped.length)} note="Agent actions across the fleet in the last day." />
        <KpiCard label="Tool calls" value={String(toolCalls)} note="Connector calls your agents made." />
        <KpiCard label="Proposals" value={String(proposals)} goodDirection="down" note="Actions awaiting an operator decision." />
        <KpiCard label="Active agents" value={`${activeAgents} · ${connectors} tools`} note="Agents that acted, and connectors touched." />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_FILTERS.map((kf) => (
            <button
              key={kf.value}
              type="button"
              onClick={() => setKind(kf.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                kind === kf.value ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {kf.label}
            </button>
          ))}
        </div>
        <Menu
          align="end"
          panelClassName="max-h-72 overflow-y-auto"
          trigger={
            <span className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted">
              {agentLabel}
            </span>
          }
        >
          {(close) => (
            <>
              <MenuLabel>Filter by agent</MenuLabel>
              <MenuItem active={agentFilter === "all"} onClick={() => { setAgentFilter("all"); close(); }}>
                All agents
              </MenuItem>
              {activeAgentList.map((a) => (
                <MenuItem key={a.id} active={agentFilter === a.id} onClick={() => { setAgentFilter(a.id); close(); }}>
                  {a.name}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>

      {isLoading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="size-7 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Radio className="size-8" />} title="Nothing here" description="No activity matches these filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((item) => (
              <ActivityRow key={item.id} item={item} agentName={amap.get(item.agentId)?.name ?? "Unknown"} />
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
}

function ActivityRow({ item, agentName }: { item: FleetActivityItem; agentName: string }) {
  const meta = kindMeta(item.kind);
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
      <Avatar name={agentName} className="size-7 shrink-0 text-[10px]" />
      <Icon className={cn("size-4 shrink-0", meta.tone)} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm font-medium">{agentName}</span>
        {item.connector && (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
            <Cable className="size-3" /> {item.connector}
          </Badge>
        )}
        {item.kind === "proposal" && <Badge variant="warning" className="shrink-0 text-[10px]">awaiting approval</Badge>}
        <span className={cn("truncate text-sm", item.kind === "tool" ? "font-mono text-muted-foreground" : "text-muted-foreground")}>
          {item.message}
        </span>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.ts)}</span>
    </div>
  );
}
