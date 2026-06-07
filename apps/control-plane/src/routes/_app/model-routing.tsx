import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Cpu, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { Agent, ModelRoutingEvent } from "@agent-os/shared";
import { EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentMap } from "#/lib/helpers";
import { formatUsd, relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/model-routing")({ component: ModelRoutingPage });

type Filter = "all" | "applied" | "audit";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "applied", label: "Applied" },
  { key: "audit", label: "Audit only" },
];

function ModelRoutingPage() {
  const { activeTenant } = useApp();
  const tenantId = activeTenant?.id;
  const [filter, setFilter] = useState<Filter>("all");

  const { data: events = [] } = useQuery<ModelRoutingEvent[]>({
    queryKey: ["modelRoutingRecent", tenantId],
    queryFn: () => data.modelRoutingRecent(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const amap = agentMap(agents);

  const filtered = events.filter((e) => {
    if (filter === "applied") return e.payload.applied === true;
    if (filter === "audit") return e.payload.applied === false;
    return true;
  });

  const appliedCount = events.filter((e) => e.payload.applied).length;
  const auditCount = events.length - appliedCount;
  const totalCost = events
    .filter((e) => e.payload.applied && typeof e.payload.cost_usd === "number")
    .reduce((s, e) => s + (e.payload.cost_usd ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Model routing"
        description="Every model-pick decision the router has made. Audit-only entries record the recommended fork; applied entries are picks that actually ran."
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Recent picks" value={events.length.toString()} />
        <StatCard label="Realized forks" value={appliedCount.toString()} subtext={`${auditCount} audit-only`} />
        <StatCard label="Spend on forks" value={formatUsd(totalCost)} subtext="from applied picks only" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "primary" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Cpu className="size-8" />}
          title="No routing events yet"
          description="Once your agents start running, every model pick will land here."
        />
      ) : (
        <section>
          <SectionLabel>Decisions · {filtered.length}</SectionLabel>
          <div className="space-y-3">
            {filtered.map((e) => (
              <RoutingCard key={e.id} ev={e} agentName={amap.get(e.agentId ?? "")?.name ?? "System"} />
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}

function StatCard({ label, value, subtext }: { label: string; value: string; subtext?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {subtext && <div className="mt-0.5 text-xs text-muted-foreground">{subtext}</div>}
    </Card>
  );
}

function RoutingCard({ ev, agentName }: { ev: ModelRoutingEvent; agentName: string }) {
  const p = ev.payload;
  const target = p.applied ? (p.model_ran ?? p.agent_model) : (p.recommended_slug ?? p.agent_model);
  const isForked = target !== p.agent_model;
  const isCantFail = p.source === "cant_fail_pin";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{agentName}</span>
          {isCantFail && (
            <Badge variant="warning">
              <ShieldAlert className="size-3" />
              T-critical
            </Badge>
          )}
          {p.task_label && <span className="text-xs text-muted-foreground truncate">{p.task_label}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={p.applied ? "success" : "default"}>{p.applied ? "applied" : "audit"}</Badge>
          {p.source && <Badge variant="outline">{p.source}</Badge>}
          <span className="text-xs text-muted-foreground">{relativeTime(ev.occurredAt)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.agent_model}</code>
        {isForked && (
          <>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{target}</code>
          </>
        )}
      </div>

      {p.reason && <p className="mt-2 text-sm text-muted-foreground">{p.reason}</p>}

      {(p.applied && (p.cost_usd != null || p.tokens_in != null)) && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {p.cost_usd != null && <span>cost: {formatUsd(p.cost_usd)}</span>}
          {p.tokens_in != null && <span>in: {p.tokens_in.toLocaleString()}</span>}
          {p.tokens_out != null && <span>out: {p.tokens_out.toLocaleString()}</span>}
        </div>
      )}
    </Card>
  );
}
