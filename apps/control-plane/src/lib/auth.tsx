import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { demoProfile } from "@agent-os/shared";
import { isSupabaseConfigured, supabase } from "./supabase";

const DEMO_FLAG = "aos-demo-authed";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  demoMode: boolean;
  signInDemo: () => void;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function fromSession(session: Session | null): AuthUser | null {
  if (!session?.user) return null;
  const u = session.user;
  return {
    id: u.id,
    email: u.email ?? "",
    name: (u.user_metadata?.name as string | undefined) ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isSupabaseConfigured && supabase) {
      supabase.auth.getSession().then(({ data }) => {
        setUser(fromSession(data.session));
        setLoading(false);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        setUser(fromSession(session));
      });
      return () => sub.subscription.unsubscribe();
    }
    // Demo mode
    const authed = typeof localStorage !== "undefined" && localStorage.getItem(DEMO_FLAG) === "1";
    setUser(authed ? { id: demoProfile.userId, email: demoProfile.email, name: demoProfile.name } : null);
    setLoading(false);
  }, []);

  const value: AuthCtx = {
    user,
    loading,
    demoMode: !isSupabaseConfigured,
    signInDemo() {
      localStorage.setItem(DEMO_FLAG, "1");
      setUser({ id: demoProfile.userId, email: demoProfile.email, name: demoProfile.name });
    },
    async signInWithPassword(email, password) {
      if (!supabase) return { error: "Supabase not configured" };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    async signInWithOAuth(provider) {
      if (!supabase) return;
      await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
      localStorage.removeItem(DEMO_FLAG);
      setUser(null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
