import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Menu, MenuItem, MenuLabel } from "#/components/ui/menu";
import { useApp } from "#/lib/app-context";
import { cn } from "#/lib/utils";

function initial(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

// The company (tenant) switcher — one operator, many orgs. Lives at the top of
// the sidebar. Collapses to just the company monogram when the rail is narrow.
export function CompanySwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { tenants, activeTenant, setActiveTenant } = useApp();

  if (!activeTenant) {
    return <div className={cn("h-10 animate-pulse rounded-lg bg-muted/60", collapsed ? "w-10" : "w-full")} />;
  }

  return (
    <Menu
      className={collapsed ? undefined : "w-full"}
      triggerClassName={collapsed ? undefined : "w-full"}
      panelClassName="w-60"
      trigger={
        collapsed ? (
          <span
            title={activeTenant.name}
            className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm"
          >
            {initial(activeTenant.name)}
          </span>
        ) : (
          <span className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              {initial(activeTenant.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">{activeTenant.name}</span>
              <span className="block text-[11px] capitalize text-muted-foreground">{activeTenant.type}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </span>
        )
      }
    >
      {(close) => (
        <>
          <MenuLabel>Companies</MenuLabel>
          {tenants.map((t) => (
            <MenuItem
              key={t.id}
              active={t.id === activeTenant.id}
              onClick={() => {
                setActiveTenant(t.id);
                close();
              }}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                  t.id === activeTenant.id ? "bg-primary text-primary-foreground" : "bg-border text-muted-foreground",
                )}
              >
                {initial(t.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name}</span>
                <span className="block text-[11px] capitalize text-muted-foreground">{t.type}</span>
              </span>
              {t.id === activeTenant.id && <Check className="size-4" />}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-border" />
          <MenuItem onClick={close}>
            <Plus className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Add company</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
