import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Shield, Zap } from "lucide-react";
import { Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { hasAdminKey, platformHealth } from "#/lib/api";

export const Route = createFileRoute("/_app/health")({ component: HealthPage });

function HealthPage() {
  const noKey = !hasAdminKey();
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["platformHealth"],
    queryFn: () => platformHealth.get(),
    enabled: !noKey,
    refetchInterval: 30_000,
  });

  if (noKey) {
    return (
      <Page>
        <PageHeader title="Platform health" description="Live operational snapshot." />
        <Card className="max-w-2xl p-5">
          <p className="text-sm text-muted-foreground">
            Paste an admin API key on Settings → API Connection to load platform health.
          </p>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Platform health"
        description="Live operational snapshot. Auto-refreshes every 30 seconds. Pair with `pnpm launch:check` for the offline gate."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />

      {isLoading && <Card className="p-5"><p className="text-sm text-muted-foreground">Loading…</p></Card>}
      {error && (
        <Card className="p-5">
          <p className="text-sm text-destructive">Failed to load: {(error as Error).message}</p>
        </Card>
      )}

      {data && (
        <div className="space-y-5">
          {/* Safety alarm strip — biggest priority */}
          <Card className={data.safety.cantfailEventsLast24h > 0 ? "border-destructive" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {data.safety.cantfailEventsLast24h === 0 ? (
                  <CheckCircle2 className="size-5 text-success" />
                ) : (
                  <AlertTriangle className="size-5 text-destructive" />
                )}
                Safety
              </CardTitle>
              <CardDescription>
                Cant-fail invariant violations in the last 24 hours.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">
                {data.safety.cantfailEventsLast24h}{" "}
                <span className="text-sm font-normal text-muted-foreground">events</span>
              </p>
              {data.safety.cantfailEventsLast24h > 0 && (
                <p className="mt-2 text-sm text-destructive">
                  Read the relay events for `cantfail.*` immediately. Each is a safety invariant violation.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Queues — what needs operator attention */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<Activity className="size-4" />}
              label="Open approvals"
              value={data.queues.pendingApprovals}
              help="Decisions awaiting a human"
            />
            <KpiCard
              icon={<Activity className="size-4" />}
              label="Improvement proposals"
              value={data.queues.pendingImprovementProposals}
              help="V2 P4 prompt amendments"
            />
            <KpiCard
              icon={<Activity className="size-4" />}
              label="Manager proposals"
              value={data.queues.pendingManagerProposals}
              help="V2 P8 pause/retire"
            />
            <KpiCard
              icon={<Zap className="size-4" />}
              label="Active leases"
              value={data.queues.activeLeases}
              help="I-003 in-flight arbitration"
            />
          </div>

          {/* Feature flags — see what's running */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="size-5 text-muted-foreground" />
                Feature flags
              </CardTitle>
              <CardDescription>
                Kill switches per V2 loop. Defaults are enabled; disable via env var AOS_FEATURE_*_DISABLED=1
                (restart required). See docs/feature-flags.md.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {Object.entries(data.featureFlags).map(([name, state]) => (
                  <div key={name} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-mono text-xs">{name}</span>
                    <Badge variant={state === "enabled" ? "success" : "warning"}>{state}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Footer */}
          <p className="text-xs text-muted-foreground">
            Last refreshed {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"} · Endpoint:{" "}
            <code className="rounded bg-muted px-1">/api/admin/platform/health</code>
          </p>
        </div>
      )}
    </Page>
  );
}

function KpiCard({ icon, label, value, help }: { icon: React.ReactNode; label: string; value: number; help: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </Card>
  );
}
