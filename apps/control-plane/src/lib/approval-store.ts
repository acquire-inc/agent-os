// Client-side approval decisions. The human-in-the-loop trust action: when an
// operator picks an option on an open approval, the decision persists and the
// item actually moves to Resolved. Demo-overlay pattern (localStorage → merged
// into data.approvals()); in Supabase mode this is an approvals UPDATE that the
// runner's Stop-hook reads to unblock the proposing agent.
import type { Approval } from "@agent-os/shared";

const KEY = "aos-approval-decisions";

export interface ApprovalDecision {
  choiceKey: string;
  decidedBy: string;
  decidedAt: string;
}

type ByTenant = Record<string, Record<string, ApprovalDecision>>;

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

export function approvalDecision(tenantId: string, id: string): ApprovalDecision | undefined {
  return read()[tenantId]?.[id];
}

export function decideApproval(tenantId: string, id: string, choiceKey: string, decidedBy: string): void {
  const all = read();
  // Idempotency: first decision wins. A double-submit or two-tab race cannot
  // flip an already-resolved approval to a different choice.
  if (all[tenantId]?.[id]) return;
  all[tenantId] = { ...(all[tenantId] ?? {}), [id]: { choiceKey, decidedBy, decidedAt: new Date().toISOString() } };
  write(all);
}

// Apply recorded decisions onto the fixture approvals: an answered item becomes
// status "decided" with its decider/timestamp.
export function mergeApprovals(tenantId: string, base: Approval[]): Approval[] {
  const decisions = read()[tenantId];
  if (!decisions) return base;
  return base.map((a) =>
    decisions[a.id]
      ? { ...a, status: "decided" as const, decidedBy: decisions[a.id]!.decidedBy, decidedAt: decisions[a.id]!.decidedAt }
      : a,
  );
}
