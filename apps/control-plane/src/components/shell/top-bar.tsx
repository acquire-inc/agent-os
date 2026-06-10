import { Search } from "lucide-react";
import { ProjectSwitcher } from "./project-switcher";

// Slim content-scoped bar above the page. Brand, company, user, and theme now
// live in the sidebar; this keeps only what's tied to the content area:
// global search and the project scope filter.
export function TopBar() {
  return (
    <header className="glass sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border px-4">
      <label className="flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors focus-within:border-primary/40">
        <Search className="size-4 shrink-0" />
        <input
          type="search"
          placeholder="Search…"
          className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </label>

      <div className="ml-auto flex items-center gap-2">
        <ProjectSwitcher />
      </div>
    </header>
  );
}
