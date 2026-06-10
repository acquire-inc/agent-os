import { Outlet, createFileRoute, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "#/components/ui/button";
import { SideNav } from "#/components/shell/side-nav";
import { TopBar } from "#/components/shell/top-bar";
import { AppProvider } from "#/lib/app-context";
import { useAuth } from "#/lib/auth";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
  errorComponent: AppError,
});

// Catches any error thrown while rendering a page under /_app (a failed query,
// a render-time exception) and shows a recoverable surface instead of a blank
// screen. `reset` re-renders the boundary so a transient failure can retry.
function AppError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <TriangleAlert className="size-6" />
      </div>
      <div>
        <p className="text-lg font-semibold">Something went wrong</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred while loading this view."}
        </p>
      </div>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}

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
      <div className="flex h-screen overflow-hidden">
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </AppProvider>
  );
}
