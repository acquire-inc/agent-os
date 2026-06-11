import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BrainCircuit, CheckCircle2, FileText, FolderTree, Search, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import type { Document, KnowledgeFolder } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Drawer } from "#/components/ui/drawer";
import { Input, Separator } from "#/components/ui/misc";
import { ALL_PROJECTS, useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { addUserDocument, newDocId } from "#/lib/doc-store";
import { hasAllTags, inProjectScope, matchesSearch } from "#/lib/helpers";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/knowledge")({ component: KnowledgePage });

const SOURCES = [
  { value: "all", label: "All sources" },
  { value: "upload", label: "Upload" },
  { value: "agent-generated", label: "Agent-generated" },
  { value: "drive-sync", label: "Drive sync" },
  { value: "call-transcript", label: "Call transcript" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Recently updated" },
  { value: "name", label: "Name" },
];

function KnowledgePage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("recent");

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [semanticQuery, setSemanticQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const qc = useQueryClient();

  const { data: folders = [] } = useQuery({
    queryKey: ["folders", tenantId],
    queryFn: () => data.folders(tenantId!),
    enabled: Boolean(tenantId),
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents", tenantId],
    queryFn: () => data.documents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const scopedFolders = folders.filter((folder) =>
    inProjectScope(folder.projectId, activeProjectId),
  );

  const docCountByFolder = new Map<string, number>();
  for (const doc of documents) {
    if (!inProjectScope(doc.projectId, activeProjectId)) continue;
    if (doc.folderId) {
      docCountByFolder.set(doc.folderId, (docCountByFolder.get(doc.folderId) ?? 0) + 1);
    }
  }

  const filtered = documents.filter((doc) => {
    if (!inProjectScope(doc.projectId, activeProjectId)) return false;
    if (selectedFolderId !== null && doc.folderId !== selectedFolderId) return false;
    if (f.filters.source !== "all" && doc.source !== f.filters.source) return false;
    if (!hasAllTags(doc.tags, f.filters.tags)) return false;
    return matchesSearch([doc.name], f.filters.search);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "name") return a.name.localeCompare(b.name);
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const availableTags = [
    ...new Set(documents.flatMap((d) => d.tags ?? [])),
  ].sort();

  return (
    <Page>
      <PageHeader
        title="Knowledge"
        description="Shared context, vector-searchable and scoped per project — your eye of Sauron."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" /> Upload
          </Button>
        }
      />

      {/* Semantic search box */}
      <Card className="mb-5 p-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={semanticQuery}
            onChange={(e) => setSemanticQuery(e.target.value)}
            placeholder="Ask your knowledge base… (semantic search)"
            className="flex-1"
          />
          <Button size="sm" variant="primary">
            <Search className="size-4" /> Search
          </Button>
        </div>
        <p className="mt-2 pl-7 text-xs text-muted-foreground">
          Vector retrieval runs at query time during agent runs.
        </p>
      </Card>

      <div className="flex gap-5">
        {/* Left: folder tree */}
        <div className="w-60 shrink-0">
          <Card className="overflow-hidden">
            <div className="p-2">
              <FolderRow
                label="All documents"
                count={documents.filter((d) => inProjectScope(d.projectId, activeProjectId)).length}
                selected={selectedFolderId === null}
                onClick={() => setSelectedFolderId(null)}
              />
              {scopedFolders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  label={folder.name}
                  count={docCountByFolder.get(folder.id) ?? 0}
                  selected={selectedFolderId === folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                />
              ))}
              {scopedFolders.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">No folders yet.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Right: documents */}
        <div className="flex flex-1 flex-col gap-4">
          <FilterBar
            filters={f.filters}
            onSearch={f.setSearch}
            onToggleTag={f.toggleTag}
            onSource={f.setSource}
            onSort={f.setSort}
            availableTags={availableTags}
            sources={SOURCES}
            sortOptions={SORT_OPTIONS}
            searchPlaceholder="Search documents…"
          />

          <SectionLabel>Documents · {sorted.length}</SectionLabel>

          {isLoading ? (
            <CardGridSkeleton count={5} columns="" />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-8" />}
              title="No documents match your filters"
              description="Try clearing filters, selecting a different folder, or switching project scope."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </div>
          )}
        </div>
      </div>

      {tenantId && (
        <UploadDocDrawer
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          tenantId={tenantId}
          activeProjectId={activeProjectId}
          folderId={selectedFolderId}
          folders={scopedFolders}
          onUploaded={() => {
            qc.invalidateQueries({ queryKey: ["documents", tenantId] });
            setUploadOpen(false);
          }}
        />
      )}
    </Page>
  );
}

function UploadDocDrawer({
  open,
  onClose,
  tenantId,
  activeProjectId,
  folderId,
  folders,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  activeProjectId: string;
  folderId: string | null;
  folders: KnowledgeFolder[];
  onUploaded: () => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<string>(folderId ?? "");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "md";
      const doc: Document = {
        id: newDocId(),
        tenantId,
        projectId: activeProjectId !== ALL_PROJECTS ? activeProjectId : null,
        folderId: folder || null,
        name: name.trim(),
        type: ext,
        source: "upload",
        vectorNamespace: null,
        vectorIndexed: true,
        version: 1,
        updatedAt: new Date().toISOString(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      addUserDocument(tenantId, doc);
    },
    onSuccess: () => {
      setName("");
      setTags("");
      setBody("");
      onUploaded();
    },
  });

  const valid = name.trim().length > 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div>
          <h2 className="text-base font-semibold">Upload to knowledge</h2>
          <p className="text-xs text-muted-foreground">Paste or name a document — it's vector-indexed for agent retrieval.</p>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q2 strategy.md" autoFocus />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Folder</span>
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Tags</span>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="strategy, q2" />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Content</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Paste document text…"
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="mt-1 block text-xs text-muted-foreground">Demo mode stores metadata only; in production the body is chunked and embedded.</span>
        </label>

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? "Indexing…" : "Upload"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function FolderRow({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted ${
        selected ? "bg-accent text-accent-foreground" : "text-foreground"
      }`}
    >
      <FolderTree className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "Upload",
  "agent-generated": "Agent-generated",
  "drive-sync": "Drive sync",
  "call-transcript": "Call transcript",
};

function DocumentRow({ doc }: { doc: Document }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium">{doc.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {SOURCE_LABEL[doc.source] ?? doc.source} · v{doc.version} · {relativeTime(doc.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {(doc.tags ?? []).slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
          {doc.vectorIndexed ? (
            <Badge variant="success">
              <CheckCircle2 className="size-3" /> Indexed
            </Badge>
          ) : (
            <Badge variant="default">Not indexed</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
