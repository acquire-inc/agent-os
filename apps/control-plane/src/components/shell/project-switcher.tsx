import { Check, ChevronsUpDown, FolderGit2, Layers } from "lucide-react";
import { Menu, MenuItem, MenuLabel } from "#/components/ui/menu";
import { ALL_PROJECTS, useApp } from "#/lib/app-context";
import { cn } from "#/lib/utils";

export function ProjectSwitcher() {
  const { projects, activeProjectId, setActiveProjectId } = useApp();
  const active = projects.find((p) => p.id === activeProjectId);
  const label = activeProjectId === ALL_PROJECTS ? "All Projects" : (active?.name ?? "All Projects");

  return (
    <Menu
      trigger={
        <span className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted">
          {activeProjectId === ALL_PROJECTS ? (
            <Layers className="size-4 text-muted-foreground" />
          ) : (
            <FolderGit2 className="size-4 text-muted-foreground" />
          )}
          {label}
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </span>
      }
    >
      {(close) => (
        <>
          <MenuLabel>Project scope</MenuLabel>
          <MenuItem
            active={activeProjectId === ALL_PROJECTS}
            onClick={() => {
              setActiveProjectId(ALL_PROJECTS);
              close();
            }}
          >
            <Layers className="size-4 text-muted-foreground" />
            <span className="flex-1">All Projects</span>
            {activeProjectId === ALL_PROJECTS && <Check className="size-4" />}
          </MenuItem>
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              active={p.id === activeProjectId}
              onClick={() => {
                setActiveProjectId(p.id);
                close();
              }}
            >
              <FolderGit2 className={cn("size-4", p.id === activeProjectId ? "text-accent-foreground" : "text-muted-foreground")} />
              <span className="flex-1">{p.name}</span>
              {p.id === activeProjectId && <Check className="size-4" />}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
