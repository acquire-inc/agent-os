// Workforce lifecycle — the deterministic, shared tool behind the `agent-architect`
// (org-design) loop. This is the ONE place new code is justified per CLAUDE.md: a genuinely
// new deterministic tool, used by an agent but not itself agent-specific. The agent decides
// *what* to do (deep reasoning, on Hermes 405B); these functions are *how* it happens — pure,
// auditable registry mutations.
//
// Safety is layered OUTSIDE this module: the spawn/pause/archive tools are classified
// requires_approval + irreversible in the tool catalog, so the PreToolUse autonomy gate
// forces human approval before any of these run. A spawned agent always lands `proposed` +
// disabled — it can never execute until a human flips it to `active`. So even a fully
// autonomous architect can *propose* a workforce of any size, but a human still gates the hire.

import { schema, type Db } from "@agent-os/db";
import { and, eq } from "drizzle-orm";

const { agents } = schema;

export const AGENT_STATUSES = ["proposed", "active", "paused", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// Org-design verbs the architect proposes. `spawn` creates; the rest transition existing agents.
export type LifecycleAction = "spawn" | "activate" | "pause" | "archive" | "reactivate";

/** Target (status, enabled) for an action — and which current states it's legal from.
 *  `enabled` is only ever true for `active` (mirrors the DB check in migration 0009). */
const TRANSITIONS: Record<LifecycleAction, { to: AgentStatus; enabled: boolean; from: AgentStatus[] }> = {
  // Hire: create a candidate the human must approve before it runs.
  spawn: { to: "proposed", enabled: false, from: [] },
  // Approve a proposal (or un-bench) → live.
  activate: { to: "active", enabled: true, from: ["proposed", "paused"] },
  // Bench a live agent — reversible, keeps its config.
  pause: { to: "paused", enabled: false, from: ["active"] },
  // Fire/retire — terminal unless explicitly reactivated.
  archive: { to: "archived", enabled: false, from: ["proposed", "active", "paused"] },
  // Bring a benched/retired agent back to live.
  reactivate: { to: "active", enabled: true, from: ["paused", "archived"] },
};

export class LifecycleError extends Error {}

/**
 * Pure transition resolver — no DB. Given the current status and an action, return the target
 * `{ status, enabled }`, or throw `LifecycleError` on an illegal transition. Kept pure so the
 * org-design rules are unit-tested without a database.
 */
export function resolveLifecycle(current: AgentStatus | null, action: LifecycleAction): { status: AgentStatus; enabled: boolean } {
  const t = TRANSITIONS[action];
  if (!t) throw new LifecycleError(`unknown lifecycle action '${action}'`);
  if (action === "spawn") {
    if (current !== null) throw new LifecycleError("spawn is for new agents only (target already exists)");
    return { status: t.to, enabled: t.enabled };
  }
  if (current === null) throw new LifecycleError(`cannot '${action}' a non-existent agent`);
  if (current === t.to && action !== "activate") {
    // Idempotent no-op for pause/archive already in that state.
    return { status: t.to, enabled: t.enabled };
  }
  if (!t.from.includes(current)) throw new LifecycleError(`illegal transition: '${action}' from '${current}'`);
  return { status: t.to, enabled: t.enabled };
}

export interface ProposeAgentArgs {
  tenantId: string;
  key: string;
  name: string;
  /** The drafted system prompt. Mirrored into agents.persona (the runner reads this). */
  persona: string;
  /** Operator override: every Acqu agent runs Hermes 4 405B. Caller passes ACQU_AGENT_MODEL. */
  model: string;
  thinkingLevel?: "low" | "medium" | "high";
  budgetCapUsd?: number | null;
  knowledgeScope?: { folders: string[]; tags: string[] };
}

/**
 * Spawn (hire) a new agent as DATA — the registry write behind `tool.spawn-agent`. The agent
 * lands `proposed` + disabled + autonomy `propose` (CLAUDE.md non-negotiable #1: new agents
 * start at the conservative default and earn promotion). Idempotent on (tenant, key): a second
 * call returns the existing row rather than creating a duplicate.
 */
export async function proposeAgent(db: Db, args: ProposeAgentArgs) {
  const [existing] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, args.tenantId), eq(agents.key, args.key)))
    .limit(1);
  if (existing) return { agent: existing, created: false as const };

  const { status, enabled } = resolveLifecycle(null, "spawn");
  const [row] = await db
    .insert(agents)
    .values({
      tenantId: args.tenantId,
      key: args.key,
      name: args.name,
      persona: args.persona,
      backend: "claude-agent-sdk",
      model: args.model,
      thinkingLevel: args.thinkingLevel ?? "medium",
      autonomy: "propose",
      knowledgeScopeJson: args.knowledgeScope ?? { folders: [], tags: [] },
      budgetCapUsd: args.budgetCapUsd != null ? String(args.budgetCapUsd) : null,
      runnerKind: "local",
      enabled,
      status,
    } as typeof schema.agents.$inferInsert)
    .returning();
  return { agent: row!, created: true as const };
}

/**
 * Transition an existing agent (pause / archive / reactivate / activate) — the registry write
 * behind those tools. Tenant-scoped (never touches another tenant's rows). Returns the updated
 * row, or null if the agent isn't found in this tenant.
 */
export async function setAgentLifecycle(
  db: Db,
  args: { tenantId: string; agentId: string; action: Exclude<LifecycleAction, "spawn"> },
) {
  const [current] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, args.tenantId), eq(agents.id, args.agentId)))
    .limit(1);
  if (!current) return null;

  const { status, enabled } = resolveLifecycle(current.status as AgentStatus, args.action);
  if (current.status === status && current.enabled === enabled) return current; // already there

  const [row] = await db
    .update(agents)
    .set({ status, enabled })
    .where(and(eq(agents.tenantId, args.tenantId), eq(agents.id, args.agentId)))
    .returning();
  return row ?? null;
}
