// The run-summary contract (build-spec §3/§5, AGENTS-PLAN.md §2.2) — structured persistent memory
// for every agent, captured once per terminal run. The pure parser turns an agent's free-form
// summary text into the five canonical fields; the DB functions persist it idempotently and read
// recent summaries back for run continuity (the missing bundle input, AGENTS-PLAN §1.3).
//
// Why a parser: agents emit a narrative summary today (runs.summary). Rather than force every one
// of 93 prompts to emit rigid JSON, we parse labeled sections when present and degrade gracefully
// to "everything is what_i_did" when not. Prompts can tighten over time; the contract holds now.

import { schema, type Db } from "@agent-os/db";
import { desc, eq, and, ne } from "drizzle-orm";

const { runSummaries } = schema;

export interface RunSummaryContract {
  whatIDid: string;
  whatIProduced: string;
  whatILearned: string;
  whatNext: string;
  verificationResult: string;
}

const EMPTY: RunSummaryContract = {
  whatIDid: "",
  whatIProduced: "",
  whatILearned: "",
  whatNext: "",
  verificationResult: "",
};

// Section header → field. Tolerant of the phrasings agents actually use (the doctrine prompts say
// "what I did / what I produced / what I learned / what's next / verification").
const SECTION_PATTERNS: { field: keyof RunSummaryContract; re: RegExp }[] = [
  { field: "whatIProduced", re: /^\s*(?:what(?:\s|_)?i(?:\s|_)?produced|produced|output|deliverable|artifacts?)\s*[:\-]/i },
  { field: "whatILearned", re: /^\s*(?:what(?:\s|_)?i(?:\s|_)?learned|learned|learnings?|insight)\s*[:\-]/i },
  { field: "whatNext", re: /^\s*(?:what(?:'?s)?(?:\s|_)?next|next(?:\s|_)?steps?|next|follow(?:\s|-)?up)\s*[:\-]/i },
  { field: "verificationResult", re: /^\s*(?:verification(?:\s|_)?result|verification|verified|self(?:\s|-)?check)\s*[:\-]/i },
  { field: "whatIDid", re: /^\s*(?:what(?:\s|_)?i(?:\s|_)?did|did|summary|actions?)\s*[:\-]/i },
];

/**
 * Parse an agent's free-form summary into the five-field contract. Pure.
 * - When labeled sections are present (one per line, "Label: value" or "Label\n value"), routes
 *   each to its field.
 * - When no labels are found, the whole text becomes `what_i_did` (never lose the content).
 * - Multiple lines under a section accumulate until the next recognized header.
 */
export function parseRunSummary(raw: string | null | undefined): RunSummaryContract {
  const text = (raw ?? "").trim();
  if (!text) return { ...EMPTY };

  const lines = text.split(/\r?\n/);
  const acc: Record<keyof RunSummaryContract, string[]> = {
    whatIDid: [], whatIProduced: [], whatILearned: [], whatNext: [], verificationResult: [],
  };
  let current: keyof RunSummaryContract | null = null;
  let matchedAny = false;

  for (const line of lines) {
    const header = SECTION_PATTERNS.find((p) => p.re.test(line));
    if (header) {
      matchedAny = true;
      current = header.field;
      const inline = line.replace(header.re, "").trim();
      if (inline) acc[current].push(inline);
      continue;
    }
    if (current) acc[current].push(line.trim());
    else acc.whatIDid.push(line.trim()); // preamble before any header → what_i_did
  }

  if (!matchedAny) return { ...EMPTY, whatIDid: text };

  return {
    whatIDid: acc.whatIDid.join("\n").trim(),
    whatIProduced: acc.whatIProduced.join("\n").trim(),
    whatILearned: acc.whatILearned.join("\n").trim(),
    whatNext: acc.whatNext.join("\n").trim(),
    verificationResult: acc.verificationResult.join("\n").trim(),
  };
}

export interface WriteRunSummaryArgs {
  tenantId: string;
  runId: string;
  agentId: string;
  status: string;
  rawSummary: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Persist the run-summary contract for a terminal run — idempotent per run (UNIQUE on run_id).
 * Parses the raw summary into the five fields. Returns the existing row unchanged on a repeat
 * call (safe from an at-least-once SessionEnd path). Best-effort by the caller: a summary write
 * must never block the run's terminal transition (the run is the system-of-record).
 */
export async function writeRunSummary(db: Db, args: WriteRunSummaryArgs) {
  const [existing] = await db.select().from(runSummaries).where(eq(runSummaries.runId, args.runId)).limit(1);
  if (existing) return { summary: existing, created: false as const };

  const c = parseRunSummary(args.rawSummary);
  const [row] = await db
    .insert(runSummaries)
    .values({
      tenantId: args.tenantId,
      runId: args.runId,
      agentId: args.agentId,
      status: args.status,
      whatIDid: c.whatIDid,
      whatIProduced: c.whatIProduced,
      whatILearned: c.whatILearned,
      whatNext: c.whatNext,
      verificationResult: c.verificationResult,
      rawSummary: args.rawSummary ?? null,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      costUsd: String(args.costUsd),
    })
    .returning();
  return { summary: row!, created: true as const };
}

/**
 * Recent run summaries for an agent (newest first), excluding the current run — the continuity
 * input the bundle should carry so a reasoning agent picks up where it left off (AGENTS-PLAN §1.3).
 * Tenant-scoped.
 */
export async function recentRunSummaries(
  db: Db,
  args: { tenantId: string; agentId: string; excludeRunId?: string; limit?: number },
) {
  const where = args.excludeRunId
    ? and(eq(runSummaries.agentId, args.agentId), eq(runSummaries.tenantId, args.tenantId), ne(runSummaries.runId, args.excludeRunId))
    : and(eq(runSummaries.agentId, args.agentId), eq(runSummaries.tenantId, args.tenantId));
  return db.select().from(runSummaries).where(where).orderBy(desc(runSummaries.createdAt)).limit(args.limit ?? 3);
}
