import { Monitor, Moon, Sun } from "lucide-react";
import { Menu, MenuItem, MenuLabel } from "#/components/ui/menu";
import { useTheme, type Theme } from "#/lib/theme";
import { cn } from "#/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <Menu
      align="end"
      trigger={
        <span className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Icon className="size-[18px]" />
        </span>
      }
    >
      {(close) => (
        <>
          <MenuLabel>Theme</MenuLabel>
          {OPTIONS.map((o) => (
            <MenuItem
              key={o.value}
              active={theme === o.value}
              onClick={() => {
                setTheme(o.value);
                close();
              }}
            >
              <o.icon className={cn("size-4", theme === o.value ? "text-accent-foreground" : "text-muted-foreground")} />
              {o.label}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
