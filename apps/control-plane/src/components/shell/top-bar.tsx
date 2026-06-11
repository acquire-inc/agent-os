import { CommandPalette, CommandPaletteTrigger } from "#/components/command-palette";
import { ProjectSwitcher } from "./project-switcher";

// Slim content-scoped bar above the page. Brand, company, user, and theme live
// in the sidebar; this keeps what's tied to the content area: the ⌘K command
// palette and the project scope filter.
export function TopBar() {
  return (
    <header className="glass sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border px-4">
      <CommandPaletteTrigger />
      <div className="ml-auto flex items-center gap-2">
        <ProjectSwitcher />
      </div>
      <CommandPalette />
    </header>
  );
}
