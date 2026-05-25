import { LogOut, Hexagon } from "lucide-react";
import { Avatar } from "#/components/ui/misc";
import { Menu, MenuItem, MenuLabel } from "#/components/ui/menu";
import { Separator } from "#/components/ui/misc";
import { useAuth } from "#/lib/auth";
import { OrgSwitcher } from "./org-switcher";
import { ProjectSwitcher } from "./project-switcher";
import { ThemeToggle } from "./theme-toggle";

export function TopBar() {
  const { user, signOut, demoMode } = useAuth();

  return (
    <header className="glass sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border px-4">
      <div className="flex items-center gap-2 pr-1">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Hexagon className="size-4" fill="currentColor" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Agent OS</span>
      </div>

      <Separator className="hidden h-6 w-px sm:block" />

      <OrgSwitcher />

      <div className="ml-auto flex items-center gap-2">
        <ProjectSwitcher />
        <ThemeToggle />
        <Menu
          align="end"
          trigger={
            <span className="ml-1 inline-flex">
              <Avatar name={user?.name ?? user?.email} />
            </span>
          }
        >
          {(close) => (
            <>
              <MenuLabel>{user?.email}</MenuLabel>
              {demoMode && (
                <div className="mx-1 mb-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                  Demo mode — running on sample data
                </div>
              )}
              <MenuItem
                onClick={() => {
                  void signOut();
                  close();
                }}
              >
                <LogOut className="size-4 text-muted-foreground" />
                Sign out
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
