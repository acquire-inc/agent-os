import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Project, Tenant } from "@agent-os/shared";
import { useAuth } from "./auth";
import { data } from "./data";

const ORG_KEY = "aos-active-org";
const PROJECT_KEY = "aos-active-project";

export const ALL_PROJECTS = "all";

interface AppCtx {
  tenants: Tenant[];
  activeTenant: Tenant | null;
  setActiveTenant: (id: string) => void;
  projects: Project[];
  activeProjectId: string; // "all" or a project id
  setActiveProjectId: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // WR-06: data.tenants() now requires the caller's userId so the Supabase
  // branch joins through tenant_members. In demo mode (user null) we still
  // want the merged demo fixture, so pass an empty string — the demo branch
  // ignores the argument.
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data: tenants = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ["tenants", userId],
    queryFn: () => data.tenants(userId),
    // In Supabase mode wait for auth; demo mode runs immediately because
    // isSupabaseConfigured is false and the userId is unused.
    enabled: Boolean(userId) || !user,
  });

  const [activeTenantId, setActiveTenantId] = useState<string | null>(
    () => (typeof localStorage !== "undefined" ? localStorage.getItem(ORG_KEY) : null),
  );

  // Default to the first tenant once loaded.
  useEffect(() => {
    if (!activeTenantId && tenants.length > 0) {
      setActiveTenantId(tenants[0]!.id);
    } else if (activeTenantId && tenants.length > 0 && !tenants.some((t) => t.id === activeTenantId)) {
      setActiveTenantId(tenants[0]!.id);
    }
  }, [tenants, activeTenantId]);

  const activeTenant = useMemo(
    () => tenants.find((t) => t.id === activeTenantId) ?? null,
    [tenants, activeTenantId],
  );

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", activeTenant?.id],
    queryFn: () => data.projects(activeTenant!.id),
    enabled: Boolean(activeTenant),
  });

  const [activeProjectId, setActiveProjectIdState] = useState<string>(
    () => (typeof localStorage !== "undefined" ? localStorage.getItem(PROJECT_KEY) : null) ?? ALL_PROJECTS,
  );

  // Reset project scope when switching org.
  useEffect(() => {
    if (activeProjectId !== ALL_PROJECTS && !projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectIdState(ALL_PROJECTS);
    }
  }, [projects, activeProjectId]);

  function setActiveTenant(id: string) {
    localStorage.setItem(ORG_KEY, id);
    setActiveTenantId(id);
    localStorage.setItem(PROJECT_KEY, ALL_PROJECTS);
    setActiveProjectIdState(ALL_PROJECTS);
  }

  function setActiveProjectId(id: string) {
    localStorage.setItem(PROJECT_KEY, id);
    setActiveProjectIdState(id);
  }

  return (
    <Ctx.Provider
      value={{
        tenants,
        activeTenant,
        setActiveTenant,
        projects,
        activeProjectId,
        setActiveProjectId,
        loading: tenantsLoading,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
