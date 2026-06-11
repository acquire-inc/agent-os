// Per-agent episodic memory — the read/write shaping of the agent memory loop.
//
// The DB I/O lives in lifecycle.writeRunMemory (write) and bundle.buildBundle
// (read); this module holds the PURE, testable pieces so the loop is verifiable
// without a live pgvector:
//   - episodeNamespace(): per-agent vector namespace (under tenant isolation)
//   - composeEpisode(): condense a finished run's OUTCOME (not just the summary)
//     into a retrievable episode doc
//   - heuristicLessons()/Reflector: distill 3-5 durable lessons (deterministic
//     default; an injectable LLM reflector is the production path)
//   - formatPriorLearnings(): shape retrieved chunks for injection into the next
//     run's bundle
//
// Invariant: episodes are agent-scoped on top of the existing tenant RLS — an
// agent retrieves only what IT learned, and cross-tenant retrieval still returns
// zero rows.

export interface RunOutcome {
  status: string;
  costUsd?: number | null;
  budgetCapUsd?: number | null;
  verificationPassed?: boolean | null;
  approvalOutcome?: "approved" | "rejected" | "none";
}

/** Per-agent episodic vector namespace. Always queried within a tenant's own
 *  rows, so this adds per-agent scoping beneath tenant isolation. */
export function episodeNamespace(agentId: string): string {
  return `agent/${agentId}/episodes`;
}

function pct(n?: number | null, d?: number | null): string {
  if (n == null || !d || d <= 0) return "n/a";
  return `${Math.round((n / d) * 100)}%`;
}

function firstSentence(s: string, max = 160): string {
  const t = s.trim().replace(/\s+/g, " ");
  const m = t.search(/[.!?](\s|$)/);
  const out = m > 0 ? t.slice(0, m + 1) : t;
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Condense a finished run into a structured episode doc (markdown). Stores the
 *  OUTCOME — status, verification, approval, cost utilization — plus distilled
 *  lessons, so future runs can pattern-match on prior successes/failures. */
export function composeEpisode(input: {
  agentKey: string;
  day: string;
  summary: string;
  outcome: RunOutcome;
  lessons?: string[];
}): string {
  const { outcome } = input;
  const lines = [
    `# Episode — ${input.agentKey} — ${input.day}`,
    ``,
    `- outcome: ${outcome.status}`,
    `- verification: ${outcome.verificationPassed == null ? "n/a" : outcome.verificationPassed ? "passed" : "failed"}`,
    `- approval: ${outcome.approvalOutcome ?? "none"}`,
    `- cost utilization: ${pct(outcome.costUsd, outcome.budgetCapUsd)}`,
  ];
  if (input.lessons && input.lessons.length > 0) {
    lines.push(``, `## Lessons`, ...input.lessons.map((l) => `- ${l}`));
  }
  lines.push(``, `## Summary`, input.summary.trim());
  return lines.join("\n");
}

/** Reflection: distill 3-5 durable lessons from a finished run. The production
 *  path injects a cheap-model (T-cheap) reflector; this deterministic heuristic
 *  is the default and keeps the loop testable offline. */
export type Reflector = (input: { summary: string; outcome: RunOutcome }) => Promise<string[]>;

export function heuristicLessons(input: { summary: string; outcome: RunOutcome }): string[] {
  const { summary, outcome } = input;
  const lessons: string[] = [];
  if (outcome.status === "failed") {
    lessons.push(`Last run FAILED at: ${firstSentence(summary)} — try a different approach.`);
  } else {
    lessons.push(`Worked last time: ${firstSentence(summary)}`);
  }
  if (outcome.verificationPassed === false) {
    lessons.push("Verification failed last time — re-check outputs before finishing.");
  }
  if (outcome.approvalOutcome === "rejected") {
    lessons.push("An operator rejected a proposal here — be more conservative on irreversible actions.");
  }
  if (outcome.costUsd != null && outcome.budgetCapUsd && outcome.costUsd > outcome.budgetCapUsd * 0.8) {
    lessons.push("Run approached the budget cap — prefer cheaper tool/model paths.");
  }
  return lessons.slice(0, 5);
}

export const heuristicReflector: Reflector = async (input) => heuristicLessons(input);

/** Shape retrieved prior-learning chunks for injection into the next run's
 *  bundle / system prompt. */
export function formatPriorLearnings(chunks: { chunk: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chunks) {
    const t = c.chunk.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
