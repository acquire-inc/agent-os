import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, FolderGit2, KeyRound, Plus, Tag as TagIcon, Trash2, Users } from "lucide-react";
import { useState } from "react";
import type { ApiKey, Project, Tag } from "@agent-os/shared";
import { demoApiKeys } from "@agent-os/shared";
import { Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Avatar, Input, Separator } from "#/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { clearAdminKey, getAdminKey, getApiUrl, setAdminKey, setApiUrl } from "#/lib/api";
import { useApp } from "#/lib/app-context";
import { useAuth } from "#/lib/auth";
import { data } from "#/lib/data";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { activeTenant } = useApp();
  const { user } = useAuth();
  const tenantId = activeTenant?.id;

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects", tenantId],
    queryFn: () => data.projects(tenantId!),
    enabled: Boolean(tenantId),
  });

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ["tags", tenantId],
    queryFn: () => data.tags(tenantId!),
    enabled: Boolean(tenantId),
  });

  const apiKeys: ApiKey[] = tenantId ? demoApiKeys.filter((k) => k.tenantId === tenantId) : [];

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Manage your organization, team, projects, API keys, and tags."
      />

      <Tabs defaultValue="general">
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="apikeys">API Keys</TabsTrigger>
          <TabsTrigger value="api">API Connection</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>

        {/* ── General ─────────────────────────────────────────────────── */}
        <TabsContent value="general">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              <CardDescription>Basic details about this organization.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Organization name</label>
                <Input defaultValue={activeTenant?.name ?? ""} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Slug</label>
                <Input defaultValue={activeTenant?.slug ?? ""} disabled />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Type</label>
                <div className="flex items-center h-9">
                  <Badge variant="primary">{activeTenant?.type ?? "—"}</Badge>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Timezone</label>
                <Input defaultValue="America/Los_Angeles" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Monthly budget</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    className="pl-6"
                    defaultValue={String(activeTenant?.monthlyBudgetUsd ?? "")}
                  />
                </div>
              </div>
              <div className="pt-1">
                <Button size="sm">Save changes</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Team ────────────────────────────────────────────────────── */}
        <TabsContent value="team">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <CardTitle>Members</CardTitle>
                  <CardDescription>People with access to this organization.</CardDescription>
                </div>
                <Button size="sm">
                  <Plus className="size-4" />
                  Invite member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Avatar name={user?.name ?? user?.email} className="size-9" />
                  <div>
                    <p className="text-sm font-medium leading-tight">{user?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
                <Badge variant="primary">Owner</Badge>
              </div>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">
                Multi-user invites are coming as the platform opens up. You'll be able to invite
                teammates and assign roles here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Projects ────────────────────────────────────────────────── */}
        <TabsContent value="projects">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <CardTitle>Projects</CardTitle>
                  <CardDescription>Organize agents and runs into logical groups.</CardDescription>
                </div>
                <Button size="sm">
                  <Plus className="size-4" />
                  New project
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects yet.</p>
              ) : (
                <div className="space-y-0">
                  {projects.map((project, i) => (
                    <div key={project.id}>
                      {i > 0 && <Separator className="my-0" />}
                      <div className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{project.name}</p>
                            {project.description && (
                              <p className="text-xs text-muted-foreground">{project.description}</p>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-danger">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── API Keys ────────────────────────────────────────────────── */}
        <TabsContent value="apikeys">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <CardTitle>API Keys</CardTitle>
                  <CardDescription>
                    Scoped to this organization. Used by runners, external agents, and the admin
                    management agent.
                  </CardDescription>
                </div>
                <Button size="sm">
                  <Plus className="size-4" />
                  Create key
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No API keys yet.</p>
              ) : (
                <div className="space-y-0">
                  {apiKeys.map((key, i) => (
                    <div key={key.id}>
                      {i > 0 && <Separator className="my-0" />}
                      <div className="flex items-center justify-between gap-3 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{key.name}</p>
                              <ApiKindBadge kind={key.kind} />
                            </div>
                            <p className="font-mono text-xs text-muted-foreground">
                              {key.hashPreview}
                              <span className="ml-2 not-italic">
                                · created {relativeTime(key.createdAt)}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="icon" className="text-muted-foreground">
                            <Copy className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-danger">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── API Connection ─────────────────────────────────────────── */}
        <TabsContent value="api">
          <ApiConnectionPanel />
        </TabsContent>

        {/* ── Tags ────────────────────────────────────────────────────── */}
        <TabsContent value="tags">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <CardTitle>Tags</CardTitle>
                  <CardDescription>
                    Extensible labels shared across all registries — agents, skills, MCPs, and
                    documents.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <TagsPanel tags={tags} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function ApiConnectionPanel() {
  const [url, setUrl] = useState(getApiUrl());
  const [key, setKey] = useState(getAdminKey() ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>API Connection</CardTitle>
        <CardDescription>
          The Architect and other admin tools call the Hono API directly. Paste an admin-kind key
          minted via <span className="font-mono">POST /api/admin/keys</span> (or seeded for demo).
          Stored only in this browser's localStorage.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">API URL</label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8787" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Admin API key</label>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="aos_admin_…"
            type="password"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setApiUrl(url);
              if (key.trim()) setAdminKey(key.trim());
              else clearAdminKey();
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
          >
            Save
          </Button>
          {saved && <span className="text-xs text-muted-foreground">Saved.</span>}
          {!key && <span className="text-xs text-muted-foreground">No key set — /architect is read-only.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKindBadge({ kind }: { kind: ApiKey["kind"] }) {
  if (kind === "runner") return <Badge variant="info">runner</Badge>;
  if (kind === "admin") return <Badge variant="warning">admin</Badge>;
  return <Badge>external</Badge>;
}

function TagsPanel({ tags }: { tags: Tag[] }) {
  const [newTag, setNewTag] = useState("");

  return (
    <div className="space-y-4">
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
            >
              <TagIcon className="size-3" />
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <Separator />
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Add tag…"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
        />
        <Button variant="secondary" size="sm">
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tags are extensible and shared across all registries in this organization.
      </p>
    </div>
  );
}
