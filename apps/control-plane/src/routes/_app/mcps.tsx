import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Cable, Globe, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import type { Agent, Mcp } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { EmptyState, Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Separator, StatusDot } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { hasAllTags, inProjectScope, matchesSearch } from "#/lib/helpers";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/mcps")({ component: McpsPage });

const SORTS = [
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
];

const SOURCES = [
  { value: "all", label: "All auth" },
  { value: "oauth", label: "OAuth" },
  { value: "api_key", label: "API key" },
  { value: "none", label: "No auth" },
];

const STATUS_BADGE: Record<Mcp["status"], { variant: "success" | "warning" | "default" | "danger"; label: string }> = {
  connected: { variant: "success", label: "Connected" },
  needs_reauth: { variant: "warning", label: "Needs reauth" },
  disconnected: { variant: "default", label: "Disconnected" },
  error: { variant: "danger", label: "Error" },
};

function agentCountForMcp(mcp: Mcp, agents: Agent[]): number {
  const nameLower = mcp.name.toLowerCase();
  return agents.filter((a) =>
    (a.mcpKeys ?? []).some((key) => nameLower.includes(key) || key.includes(nameLower)),
  ).length;
}

function McpsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("name");

  const { data: mcps = [] } = useQuery({
    queryKey: ["mcps", tenantId],
    queryFn: () => data.mcps(tenantId!),
    enabled: Boolean(tenantId),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const filtered = mcps
    .filter((m) => inProjectScope(m.projectId, activeProjectId))
    .filter((m) => f.filters.source === "all" || m.authType === f.filters.source)
    .filter((m) => hasAllTags(m.tags, f.filters.tags))
    .filter((m) => matchesSearch([m.name], f.filters.search));

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "status") return a.status.localeCompare(b.status);
    return a.name.localeCompare(b.name);
  });

  const availableTags = [...new Set(mcps.flatMap((m) => m.tags ?? []))].sort();

  return (
    <Page>
      <PageHeader
        title="MCPs"
        description="The connector layer — what your agents act through."
        actions={
          <Button size="sm">
            <Plus className="size-4" /> Add MCP
          </Button>
        }
      />

      <div className="mb-4">
        <FilterBar
          filters={f.filters}
          onSearch={f.setSearch}
          onToggleTag={f.toggleTag}
          onSource={f.setSource}
          onSort={f.setSort}
          availableTags={availableTags}
          sources={SOURCES}
          sortOptions={SORTS}
          searchPlaceholder="Search MCPs…"
        />
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Cable className="size-8" />}
          title="No MCPs match your filters"
          description="Add a connector or switch project scope."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((mcp) => (
            <McpCard key={mcp.id} mcp={mcp} agentCount={agentCountForMcp(mcp, agents)} />
          ))}
        </div>
      )}
    </Page>
  );
}

function McpCard({ mcp, agentCount }: { mcp: Mcp; agentCount: number }) {
  const statusInfo = STATUS_BADGE[mcp.status] ?? { variant: "default" as const, label: mcp.status };

  return (
    <Card className="p-5">
      {/* Row 1: status dot + name + transport badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={mcp.status} />
          <span className="font-semibold truncate">{mcp.name}</span>
        </div>
        <Badge variant="outline" className="shrink-0 capitalize">
          {mcp.transport}
        </Badge>
      </div>

      {/* Row 2: auth type + scope + status badge */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          {mcp.authType === "oauth" && <ShieldCheck className="size-3.5" />}
          {mcp.authType === "api_key" && <KeyRound className="size-3.5" />}
          {mcp.authType === "none" && <Globe className="size-3.5" />}
          <span className="capitalize">{mcp.authType === "api_key" ? "API key" : mcp.authType}</span>
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="capitalize">{mcp.scope}</span>
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </div>

      {/* Tag badges */}
      {(mcp.tags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(mcp.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <Separator className="my-3" />

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{agentCount} {agentCount === 1 ? "agent" : "agents"}</span>
          {mcp.lastHealthCheck && (
            <span>Checked {relativeTime(mcp.lastHealthCheck)}</span>
          )}
        </div>
        {mcp.status === "needs_reauth" && (
          <Button size="sm" variant="secondary">
            <RefreshCw className="size-3.5" /> Reconnect
          </Button>
        )}
      </div>
    </Card>
  );
}
