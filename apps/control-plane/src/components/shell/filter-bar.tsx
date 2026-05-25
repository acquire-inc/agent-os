import { ArrowUpDown, Check, Filter, Search, Tag as TagIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "#/components/ui/misc";
import { Menu, MenuItem, MenuLabel } from "#/components/ui/menu";
import { ALL_PROJECTS, useApp } from "#/lib/app-context";
import { cn } from "#/lib/utils";

export interface Option {
  value: string;
  label: string;
}

export interface FilterState {
  search: string;
  tags: string[];
  source: string; // "all" | a source value
  sort: string;
}

export function useListFilters(defaultSort: string): {
  filters: FilterState;
  setSearch: (v: string) => void;
  toggleTag: (t: string) => void;
  setSource: (v: string) => void;
  setSort: (v: string) => void;
} {
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    tags: [],
    source: "all",
    sort: defaultSort,
  });
  return {
    filters,
    setSearch: (search) => setFilters((f) => ({ ...f, search })),
    toggleTag: (t) =>
      setFilters((f) => ({
        ...f,
        tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t],
      })),
    setSource: (source) => setFilters((f) => ({ ...f, source })),
    setSort: (sort) => setFilters((f) => ({ ...f, sort })),
  };
}

interface FilterBarProps {
  filters: FilterState;
  onSearch: (v: string) => void;
  onToggleTag: (t: string) => void;
  onSource: (v: string) => void;
  onSort: (v: string) => void;
  availableTags?: string[];
  sources?: Option[];
  sortOptions: Option[];
  searchPlaceholder?: string;
}

const PILL =
  "flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted";

export function FilterBar({
  filters,
  onSearch,
  onToggleTag,
  onSource,
  onSort,
  availableTags = [],
  sources = [],
  sortOptions,
  searchPlaceholder = "Search…",
}: FilterBarProps) {
  const { projects, activeProjectId, setActiveProjectId } = useApp();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const sortLabel = sortOptions.find((s) => s.value === filters.sort)?.label ?? "Sort";
  const sourceLabel = sources.find((s) => s.value === filters.source)?.label ?? "All sources";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-56 pl-8"
        />
      </div>

      {/* Project (kept in sync with the global project scope) */}
      <Menu
        trigger={
          <span className={PILL}>
            <Filter className="size-3.5 text-muted-foreground" />
            {activeProjectId === ALL_PROJECTS ? "All Projects" : (activeProject?.name ?? "Project")}
          </span>
        }
      >
        {(close) => (
          <>
            <MenuLabel>Project</MenuLabel>
            <MenuItem
              active={activeProjectId === ALL_PROJECTS}
              onClick={() => {
                setActiveProjectId(ALL_PROJECTS);
                close();
              }}
            >
              All Projects
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
                {p.name}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      {/* Tags */}
      {availableTags.length > 0 && (
        <Menu
          trigger={
            <span className={cn(PILL, filters.tags.length > 0 && "border-primary/40 text-accent-foreground")}>
              <TagIcon className="size-3.5 text-muted-foreground" />
              {filters.tags.length > 0 ? `${filters.tags.length} tag${filters.tags.length > 1 ? "s" : ""}` : "Tags"}
            </span>
          }
        >
          <MenuLabel>Filter by tag</MenuLabel>
          <div className="max-h-64 overflow-y-auto">
            {availableTags.map((t) => (
              <MenuItem key={t} active={filters.tags.includes(t)} onClick={() => onToggleTag(t)}>
                <span className="flex-1">{t}</span>
                {filters.tags.includes(t) && <Check className="size-4" />}
              </MenuItem>
            ))}
          </div>
        </Menu>
      )}

      {/* Source */}
      {sources.length > 0 && (
        <Menu
          trigger={
            <span className={cn(PILL, filters.source !== "all" && "border-primary/40 text-accent-foreground")}>
              {sourceLabel}
            </span>
          }
        >
          {(close) => (
            <>
              <MenuLabel>Source</MenuLabel>
              {sources.map((s) => (
                <MenuItem
                  key={s.value}
                  active={s.value === filters.source}
                  onClick={() => {
                    onSource(s.value);
                    close();
                  }}
                >
                  {s.label}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      )}

      {/* Sort */}
      <Menu
        align="end"
        className="ml-auto"
        trigger={
          <span className={PILL}>
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            {sortLabel}
          </span>
        }
      >
        {(close) => (
          <>
            <MenuLabel>Sort by</MenuLabel>
            {sortOptions.map((s) => (
              <MenuItem
                key={s.value}
                active={s.value === filters.sort}
                onClick={() => {
                  onSort(s.value);
                  close();
                }}
              >
                {s.label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </div>
  );
}
