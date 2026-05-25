import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SideNav } from "#/components/shell/side-nav";
import { TopBar } from "#/components/shell/top-bar";
import { AppProvider } from "#/lib/app-context";
import { useAuth } from "#/lib/auth";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <AppProvider>
      <div className="flex min-h-screen flex-col">
        <TopBar />
        <div className="flex flex-1">
          <SideNav />
          <main className="flex-1 overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </AppProvider>
  );
}
