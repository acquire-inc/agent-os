import type { Agent } from "@agent-os/shared";
import { ALL_PROJECTS } from "./app-context";

export function agentMap(agents: Agent[]): Map<string, Agent> {
  return new Map(agents.map((a) => [a.id, a]));
}

/** Does an agent belong to the active project scope? */
export function agentInProject(agent: Agent | undefined, activeProjectId: string): boolean {
  if (activeProjectId === ALL_PROJECTS) return true;
  return Boolean(agent?.projectIds?.includes(activeProjectId));
}

/** A row with a project id (null = global, visible everywhere). */
export function inProjectScope(projectId: string | null | undefined, activeProjectId: string): boolean {
  if (activeProjectId === ALL_PROJECTS) return true;
  return projectId == null || projectId === activeProjectId;
}

export function matchesSearch(haystack: string[], query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return haystack.some((h) => h?.toLowerCase().includes(q));
}

export function hasAllTags(itemTags: string[] | undefined, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const set = new Set(itemTags ?? []);
  return wanted.every((t) => set.has(t));
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "Running",
  scheduled: "Scheduled",
  waiting: "Waiting",
  pending: "Pending",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export function statusBadgeVariant(status: string): "success" | "danger" | "warning" | "info" | "default" {
  switch (status) {
    case "done":
      return "success";
    case "failed":
      return "danger";
    case "waiting":
    case "pending":
      return "warning";
    case "running":
      return "info";
    default:
      return "default";
  }
}
