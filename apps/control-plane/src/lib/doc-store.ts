// Client-side knowledge document store. Same demo-overlay pattern as connectors
// and agents: uploads persist to localStorage and overlay the fixtures via
// data.documents(); in Supabase mode the same action would insert + enqueue
// vector indexing.
import type { Document } from "@agent-os/shared";

const KEY = "aos-user-docs";

type ByTenant = Record<string, Document[]>;

function read(): ByTenant {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as ByTenant;
  } catch {
    return {};
  }
}

function write(value: ByTenant): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

export function userDocuments(tenantId: string): Document[] {
  return read()[tenantId] ?? [];
}

export function addUserDocument(tenantId: string, doc: Document): void {
  const all = read();
  all[tenantId] = [doc, ...(all[tenantId] ?? [])];
  write(all);
}

export function mergeDocuments(tenantId: string, base: Document[]): Document[] {
  return [...userDocuments(tenantId), ...base];
}

export function newDocId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `user-doc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
