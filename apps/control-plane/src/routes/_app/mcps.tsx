import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Cable, Check, Globe, KeyRound, Loader2, Lock, MoreVertical, Plus, RefreshCw, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { useState } from "react";
import type { Agent, McpAuthType, McpTransport, Mcp, Scope } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Drawer } from "#/components/ui/drawer";
import { Menu, MenuItem } from "#/components/ui/menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Input, Separator, StatusDot } from "#/components/ui/misc";
import { ALL_PROJECTS, useApp } from "#/lib/app-context";
import {
  CONNECTOR_CATALOG,
  CATALOG_CATEGORIES,
  catalogEntryToMcp,
  type CatalogEntry,
} from "#/lib/connector-catalog";
import {
  addUserMcp,
  grantConnector,
  grantedScopes,
  isUserMcp,
  newMcpId,
  removeUserMcp,
  revokeConnector,
} from "#/lib/connector-store";
import { scopesFor } from "#/lib/connector-scopes";
import { data } from "#/lib/data";
import { hasAllTags, inProjectScope, matchesSearch } from "#/lib/helpers";
import { cn } from "#/lib/utils";
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
  const [addOpen, setAddOpen] = useState(false);
  const [connecting, setConnecting] = useState<Mcp | null>(null);
  const qc = useQueryClient();

  const { data: mcps = [], isLoading } = useQuery({
    queryKey: ["mcps", tenantId],
    queryFn: () => data.mcps(tenantId!),
    enabled: Boolean(tenantId),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["mcps", tenantId] });

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
  const connectedCount = mcps.filter((m) => m.status === "connected").length;

  return (
    <Page>
      <PageHeader
        title="MCPs"
        description="The connector layer — what your agents act through."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add MCP
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="success">{connectedCount} connected</Badge>
        <Badge variant="outline">{mcps.length} total</Badge>
      </div>

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

      {isLoading ? (
        <CardGridSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Cable className="size-8" />}
          title="No MCPs match your filters"
          description="Add a connector or switch project scope."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((mcp) => (
            <McpCard
              key={mcp.id}
              mcp={mcp}
              agentCount={agentCountForMcp(mcp, agents)}
              custom={tenantId ? isUserMcp(tenantId, mcp.id) : false}
              scopeCount={
                mcp.status === "connected"
                  ? (tenantId && grantedScopes(tenantId, mcp.id)?.length) || scopesFor(mcp).length
                  : 0
              }
              onConnect={() => setConnecting(mcp)}
              onDisconnect={() => {
                if (!tenantId) return;
                revokeConnector(tenantId, mcp.id);
                invalidate();
              }}
              onRemove={() => {
                if (!tenantId) return;
                removeUserMcp(tenantId, mcp.id);
                invalidate();
              }}
            />
          ))}
        </div>
      )}

      {tenantId && (
        <AddMcpDrawer
          open={addOpen}
          onClose={() => setAddOpen(false)}
          tenantId={tenantId}
          activeProjectId={activeProjectId}
          existingNames={new Set(mcps.map((m) => m.name.toLowerCase()))}
          onChanged={invalidate}
        />
      )}

      {connecting && tenantId && (
        <ConnectMcpDrawer
          mcp={connecting}
          tenantId={tenantId}
          onClose={() => setConnecting(null)}
          onConnected={() => {
            invalidate();
            setConnecting(null);
          }}
        />
      )}
    </Page>
  );
}

// --- Connect flow (OAuth realism + least-privilege scopes) -------------------

function ConnectMcpDrawer({
  mcp,
  tenantId,
  onClose,
  onConnected,
}: {
  mcp: Mcp;
  tenantId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const all = scopesFor(mcp);
  const [granted, setGranted] = useState<string[]>(all);
  const [keyVal, setKeyVal] = useState("");
  const reconnect = mcp.status === "needs_reauth";

  const connect = useMutation({
    mutationFn: async () => {
      // Mock the authorize round-trip so the flow feels real.
      await new Promise((r) => setTimeout(r, 700));
      grantConnector(tenantId, mcp.id, granted);
    },
    onSuccess: onConnected,
  });

  const toggle = (s: string) => setGranted((g) => (g.includes(s) ? g.filter((x) => x !== s) : [...g, s]));
  const needsKey = mcp.authType === "api_key";
  const canConnect = (!needsKey || keyVal.trim().length > 0) && granted.length > 0;
  const ctaLabel =
    mcp.authType === "oauth" ? `Continue with ${mcp.name}` : mcp.authType === "api_key" ? "Connect" : "Enable";

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={mcp.status} />
          <div>
            <h2 className="text-base font-semibold leading-tight">{reconnect ? "Reconnect" : "Connect"} {mcp.name}</h2>
            <p className="text-xs capitalize text-muted-foreground">{mcp.authType === "api_key" ? "API key" : mcp.authType} · {mcp.transport}</p>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-subtle p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Your agents will be able to:</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Grant only what they need — uncheck anything you'd rather withhold.</p>
          <div className="mt-3 space-y-1.5">
            {all.map((s) => {
              const on = granted.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/50"
                >
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {on && <Check className="size-3" />}
                  </span>
                  <code className="text-xs">{s}</code>
                </button>
              );
            })}
          </div>
        </div>

        {mcp.authType === "api_key" && (
          <Field label="API key" hint="Stored in the tenant vault. Never exposed to agent prompts.">
            <Input value={keyVal} onChange={(e) => setKeyVal(e.target.value)} placeholder="sk_live_…" type="password" autoFocus />
          </Field>
        )}
        {mcp.authType === "oauth" && (
          <p className="text-xs text-muted-foreground">
            You'll be sent to {mcp.name} to authorize the scopes above, then returned here.
          </p>
        )}
        {mcp.authType === "none" && (
          <p className="text-xs text-muted-foreground">No authentication required — this connector runs locally.</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canConnect || connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Authorizing…
              </>
            ) : (
              <>
                <Lock className="size-3.5" /> {ctaLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function McpCard({
  mcp,
  agentCount,
  custom,
  scopeCount,
  onConnect,
  onDisconnect,
  onRemove,
}: {
  mcp: Mcp;
  agentCount: number;
  custom: boolean;
  scopeCount: number;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const statusInfo = STATUS_BADGE[mcp.status] ?? { variant: "default" as const, label: mcp.status };
  const connected = mcp.status === "connected";

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={mcp.status} />
          <span className="truncate font-semibold">{mcp.name}</span>
          {custom && <Badge variant="outline" className="shrink-0 text-[10px]">custom</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="capitalize">
            {mcp.transport}
          </Badge>
          <Menu
            align="end"
            panelClassName="w-44"
            trigger={
              <span className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MoreVertical className="size-4" />
              </span>
            }
          >
            {(close) => (
              <>
                {connected ? (
                  <MenuItem onClick={() => { onDisconnect(); close(); }}>
                    <Unplug className="size-4 text-muted-foreground" /> Disconnect
                  </MenuItem>
                ) : (
                  <MenuItem onClick={() => { onConnect(); close(); }}>
                    <RefreshCw className="size-4 text-muted-foreground" /> Connect
                  </MenuItem>
                )}
                {custom && (
                  <MenuItem onClick={() => { onRemove(); close(); }} className="text-danger hover:bg-danger/10">
                    <Trash2 className="size-4" /> Remove
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      </div>

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

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{agentCount} {agentCount === 1 ? "agent" : "agents"}</span>
          {connected && scopeCount > 0 && (
            <span className="flex items-center gap-1" title="Permissions granted to agents">
              <Lock className="size-3" /> {scopeCount} {scopeCount === 1 ? "scope" : "scopes"}
            </span>
          )}
        </div>
        {mcp.status === "needs_reauth" ? (
          <Button size="sm" variant="secondary" onClick={onConnect}>
            <RefreshCw className="size-3.5" /> Reconnect
          </Button>
        ) : !connected ? (
          <Button size="sm" variant="secondary" onClick={onConnect}>
            Connect
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// --- Add MCP drawer ----------------------------------------------------------

const TRANSPORTS: McpTransport[] = ["http", "stdio"];
const AUTH_TYPES: { value: McpAuthType; label: string }[] = [
  { value: "oauth", label: "OAuth" },
  { value: "api_key", label: "API key" },
  { value: "none", label: "No auth" },
];
const SCOPE_OPTS: Scope[] = ["global", "project"];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function AddMcpDrawer({
  open,
  onClose,
  tenantId,
  activeProjectId,
  existingNames,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  activeProjectId: string;
  existingNames: Set<string>;
  onChanged: () => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div>
          <h2 className="text-base font-semibold">Add a connector</h2>
          <p className="text-xs text-muted-foreground">Browse the catalog or register a custom MCP server.</p>
        </div>
      }
    >
      <Tabs defaultValue="browse">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="browse">Browse catalog</TabsTrigger>
          <TabsTrigger value="custom">Custom MCP</TabsTrigger>
        </TabsList>
        <TabsContent value="browse">
          <CatalogBrowser
            tenantId={tenantId}
            activeProjectId={activeProjectId}
            existingNames={existingNames}
            onChanged={onChanged}
          />
        </TabsContent>
        <TabsContent value="custom">
          <CustomMcpForm
            tenantId={tenantId}
            activeProjectId={activeProjectId}
            onAdded={() => {
              onChanged();
              onClose();
            }}
            onCancel={onClose}
          />
        </TabsContent>
      </Tabs>
    </Drawer>
  );
}

function authIcon(auth: McpAuthType) {
  if (auth === "oauth") return <ShieldCheck className="size-3.5" />;
  if (auth === "api_key") return <KeyRound className="size-3.5" />;
  return <Globe className="size-3.5" />;
}

function CatalogBrowser({
  tenantId,
  activeProjectId,
  existingNames,
  onChanged,
}: {
  tenantId: string;
  activeProjectId: string;
  existingNames: Set<string>;
  onChanged: () => void;
}) {
  const [cat, setCat] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const entries = CONNECTOR_CATALOG.filter((e) => cat === "All" || e.category === cat).filter((e) =>
    query.trim() === "" ? true : (e.name + e.purpose).toLowerCase().includes(query.trim().toLowerCase()),
  );

  function add(entry: CatalogEntry) {
    const projectId = activeProjectId !== ALL_PROJECTS ? activeProjectId : null;
    addUserMcp(tenantId, catalogEntryToMcp(tenantId, entry, projectId));
    setJustAdded((s) => new Set(s).add(entry.name));
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search connectors…" />
      <div className="flex flex-wrap gap-1.5">
        {["All", ...CATALOG_CATEGORIES].map((c) => (
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
      <div className="flex flex-col gap-2">
        {entries.map((e) => {
          const added = existingNames.has(e.name.toLowerCase()) || justAdded.has(e.name);
          return (
            <div key={e.name} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{e.name}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{e.category}</Badge>
                  <span className="flex items-center gap-0.5 text-muted-foreground">{authIcon(e.auth)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.purpose}</p>
              </div>
              <Button
                size="sm"
                variant={added ? "ghost" : "secondary"}
                disabled={added}
                onClick={() => add(e)}
                className="shrink-0"
              >
                {added ? (
                  <>
                    <Check className="size-3.5" /> Added
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5" /> Add
                  </>
                )}
              </Button>
            </div>
          );
        })}
        {entries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No connectors match.</p>}
      </div>
    </div>
  );
}

function CustomMcpForm({
  tenantId,
  activeProjectId,
  onAdded,
  onCancel,
}: {
  tenantId: string;
  activeProjectId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [authType, setAuthType] = useState<McpAuthType>("oauth");
  const [endpoint, setEndpoint] = useState("");
  const [scope, setScope] = useState<Scope>("global");
  const [tags, setTags] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const mcp: Mcp = {
        id: newMcpId(),
        tenantId,
        projectId: scope === "project" && activeProjectId !== ALL_PROJECTS ? activeProjectId : null,
        name: name.trim(),
        transport,
        endpoint: endpoint.trim() || null,
        authType,
        scope,
        status: authType === "none" ? "connected" : "disconnected",
        lastHealthCheck: null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      addUserMcp(tenantId, mcp);
    },
    onSuccess: () => {
      setName("");
      setEndpoint("");
      setTags("");
      setTransport("http");
      setAuthType("oauth");
      setScope("global");
      onAdded();
    },
  });

  const valid = name.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
        <Field label="Name" hint="Display name, e.g. “Salesforce” or a custom MCP server.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Salesforce" autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Transport">
            <Select value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
              {TRANSPORTS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Auth">
            <Select value={authType} onChange={(e) => setAuthType(e.target.value as McpAuthType)}>
              {AUTH_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Endpoint" hint="Optional. URL for http transport, or command for stdio.">
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://mcp.example.com" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              {SCOPE_OPTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" hint="Comma-separated">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="sales, crm" />
          </Field>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? "Adding…" : "Add MCP"}
          </Button>
        </div>
      </form>
  );
}
