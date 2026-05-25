import { Plus } from "lucide-react";
import { useApp } from "#/lib/app-context";
import { cn } from "#/lib/utils";

/** Top-bar company tabs — the organization switcher (one user, many orgs). */
export function OrgSwitcher() {
  const { tenants, activeTenant, setActiveTenant } = useApp();

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        {tenants.map((t) => {
          const active = t.id === activeTenant?.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTenant(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-[5px] text-[11px] font-bold",
                  active ? "bg-primary text-primary-foreground" : "bg-border text-muted-foreground",
                )}
              >
                {t.name[0]}
              </span>
              {t.name}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        title="Add organization"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
