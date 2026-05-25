import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, KeyRound, Link2, Lock, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import type { Mcp } from "@agent-os/shared";
import { EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { StatusDot } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { inProjectScope } from "#/lib/helpers";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/connections")({ component: ConnectionsPage });

function ConnectionsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;

  const { data: mcps = [] } = useQuery({
    queryKey: ["mcps", tenantId],
    queryFn: () => data.mcps(tenantId!),
    enabled: Boolean(tenantId),
  });

  const connectable = mcps.filter(
    (m) => m.authType !== "none" && inProjectScope(m.projectId, activeProjectId),
  );

  const needsAttention = connectable.filter((m) => m.status !== "connected");
  const connected = connectable.filter((m) => m.status === "connected");

  return (
    <Page>
      <PageHeader
        title="Connections"
        description="Authorize the services your agents act through. You log in once; tokens are encrypted in the vault and injected fresh per run."
        actions={
          <Button size="sm">
            <Link2 className="size-4" /> New connection
          </Button>
        }
      />

      <Card className="mb-6 p-3">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          <span>
            Agents never see long-lived credentials or perform OAuth. Access tokens are short-TTL and resolved per run.
          </span>
        </div>
      </Card>

      {connectable.length === 0 ? (
        <EmptyState
          icon={<Plug className="size-8" />}
          title="No connections yet"
          description="Add a connection to let your agents act through Close, Slack, Meta, and more."
        />
      ) : (
        <div className="space-y-8">
          {needsAttention.length > 0 && (
            <section>
              <SectionLabel>Needs attention · {needsAttention.length}</SectionLabel>
              <div className="space-y-3">
                {needsAttention.map((m) => (
                  <ConnectionCard key={m.id} mcp={m} />
                ))}
              </div>
            </section>
          )}

          {connected.length > 0 && (
            <section>
              <SectionLabel>Connected · {connected.length}</SectionLabel>
              <div className="space-y-3">
                {connected.map((m) => (
                  <ConnectionCard key={m.id} mcp={m} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}

function ConnectionCard({ mcp }: { mcp: Mcp }) {
  const isAttention = mcp.status !== "connected";

  const statusBadge = () => {
    switch (mcp.status) {
      case "connected":
        return <Badge variant="success">Connected</Badge>;
      case "needs_reauth":
        return <Badge variant="warning">Reauthorize</Badge>;
      case "error":
        return <Badge variant="danger">Error</Badge>;
      default:
        return <Badge variant="default">Disconnected</Badge>;
    }
  };

  const actionButton = () => {
    if (mcp.status === "connected") {
      return (
        <Button variant="outline" size="sm">
          Manage
        </Button>
      );
    }
    const label =
      mcp.status === "needs_reauth" ? "Reconnect" : mcp.status === "error" ? "Retry" : "Connect";
    return (
      <Button variant="primary" size="sm">
        <RefreshCw className="size-4" /> {label}
      </Button>
    );
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        {/* LEFT */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground">
            {mcp.name[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={mcp.status} />
              <span className="font-semibold leading-tight">{mcp.name}</span>
              {isAttention && (
                <AlertTriangle className="size-4 shrink-0 text-warning" />
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {mcp.authType === "oauth" ? (
                <ShieldCheck className="size-3.5 shrink-0" />
              ) : (
                <KeyRound className="size-3.5 shrink-0" />
              )}
              <span>{mcp.authType === "oauth" ? "OAuth 2.0" : "API key"}</span>
              <span aria-hidden>·</span>
              <span>{mcp.scope}</span>
              <span aria-hidden>·</span>
              <span>checked {relativeTime(mcp.lastHealthCheck)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge()}
          {actionButton()}
        </div>
      </div>
    </Card>
  );
}
