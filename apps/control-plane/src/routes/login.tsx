import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Hexagon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input, Separator } from "#/components/ui/misc";
import { useAuth } from "#/lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, demoMode, signInDemo, signInWithPassword, signInWithOAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/" });
  }, [user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) setError(error);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--color-primary)_14%,transparent),transparent)]" />
      <div className="w-full max-w-sm animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
            <Hexagon className="size-6" fill="currentColor" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Agent OS</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The operating system for a company run on agents.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
          {demoMode ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                Supabase isn't configured, so the app runs on a built-in demo dataset
                (Acqu &amp; Cliently). Sign in to explore.
              </div>
              <Button size="lg" onClick={signInDemo}>
                Enter demo workspace
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
              <label className="mt-1 text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" disabled={busy} className="mt-1">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <div className="my-2 flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
              <Button type="button" variant="secondary" onClick={() => void signInWithOAuth("google")}>
                Continue with Google
              </Button>
              <Button type="button" variant="secondary" onClick={() => void signInWithOAuth("github")}>
                Continue with GitHub
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          One account, many organizations.
        </p>
      </div>
    </div>
  );
}
