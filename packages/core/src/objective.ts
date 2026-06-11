// Objective-driven reflexion retry loop (V2 P3).
//
// The agent memory loop (P1+P2) makes a single run smarter the *next* time the
// same agent runs — but each run still starts fresh against its own objective.
// When a run fails partway, the operator has to re-trigger it manually and the
// failure context (what the agent tried, why it failed, what the verifier
// rejected) doesn't carry over.
//
// This module wires the carryover. An `objective` is a durable, multi-run
// target ("close out the Q3 ad-spend audit") that lives across attempts. When
// a run finishes:
//   - if it satisfied the objective, mark complete;
//   - if it failed and the bounded retry budget still allows, queue a NEW run
//     whose system prompt carries the prior attempts' failure context so
//     attempt N+1 starts smarter than attempt N;
//   - if the retry budget is exhausted, abandon and surface for human
//     intervention (no infinite loop, no budget bleed).
//
// Two safety rules, always:
//   - NEVER retry past `max_attempts` (bounded). A runaway reflexion loop is a
//     budget burner and a human-trust killer; the breaker (P5) tracks failure
//     streaks on the same wire and will pull autonomy down independently.
//   - The decision NEVER ratchets autonomy UP. Reflexion only re-issues the run
//     under the agent's CURRENT autonomy — it cannot escalate to skip approvals.
//
// Pure decision function + a thin sink-based runner (mirrors eval/job.ts and
// eval/circuit-breaker.ts) so the whole thing is unit-testable without a live
// DB. The DB I/O — load objective, load prior attempts, write the follow-up
// `runs` row — lives in the sink and is provided by lifecycle.ts when the
// operator unblocks the database.

export type ObjectiveStatus = "active" | "completed" | "abandoned";

export interface Objective {
  id: string;
  tenantId: string;
  agentId: string;
  /** Human-readable target — surfaced in the next attempt's bundle. */
  title: string;
  description: string;
  status: ObjectiveStatus;
  /** Hard cap on attempts (default 3). The breaker will already have demoted
   *  the agent by the time we approach this — this is the safety floor that
   *  guarantees we never spin past N tries. */
  maxAttempts: number;
}

export interface AttemptOutcome {
  /** runs.attempt_number — 1-indexed. */
  attemptNumber: number;
  /** Mirrors run lifecycle status. */
  status: "done" | "failed" | "escalated" | "skipped" | "quarantined";
  /** Verification gate result, if a verifier ran. */
  verificationPassed: boolean | null;
  /** Brief human-readable summary of what attempt N tried + what failed. */
  summary: string;
}

export type ReflexionAction = "retry" | "complete" | "abandon";

export interface ReflexionDecision {
  action: ReflexionAction;
  /** 1-indexed attempt to queue next when action === "retry"; null otherwise. */
  nextAttemptNumber: number | null;
  rationale: string;
}

export interface ReflexionConfig {
  /** Default cap when an objective doesn't pin its own. */
  defaultMaxAttempts: number;
}

export const DEFAULT_REFLEXION_CONFIG: ReflexionConfig = {
  defaultMaxAttempts: 3,
};

/**
 * Decide reflexion action for an objective given the just-finished attempt.
 * @param objective The objective whose attempt just resolved.
 * @param attempts All attempts so far, chronological (oldest → newest). The
 *                 newest attempt is the one that just finished.
 */
export function decideReflexion(
  objective: Objective,
  attempts: AttemptOutcome[],
  config: ReflexionConfig = DEFAULT_REFLEXION_CONFIG,
): ReflexionDecision {
  if (attempts.length === 0) {
    return {
      action: "abandon",
      nextAttemptNumber: null,
      rationale: "no attempts on record — nothing to reflex against",
    };
  }

  const cap = objective.maxAttempts > 0 ? objective.maxAttempts : config.defaultMaxAttempts;
  const last = attempts[attempts.length - 1]!;

  // Already terminal — nothing to do.
  if (objective.status !== "active") {
    return {
      action: "abandon",
      nextAttemptNumber: null,
      rationale: `objective already ${objective.status}`,
    };
  }

  // Success path: verifier passed (when present) AND lifecycle status is done.
  const verifierOk = last.verificationPassed !== false;
  if (last.status === "done" && verifierOk) {
    return {
      action: "complete",
      nextAttemptNumber: null,
      rationale: `attempt ${last.attemptNumber} completed and verified`,
    };
  }

  // Failure path: are we under the cap?
  const attemptsCount = attempts.length;
  if (attemptsCount >= cap) {
    return {
      action: "abandon",
      nextAttemptNumber: null,
      rationale: `attempt ${last.attemptNumber} failed; max_attempts (${cap}) reached`,
    };
  }

  return {
    action: "retry",
    nextAttemptNumber: attemptsCount + 1,
    rationale: `attempt ${last.attemptNumber} failed; carrying context into attempt ${attemptsCount + 1}/${cap}`,
  };
}

function firstSentence(s: string, max = 200): string {
  const t = s.trim().replace(/\s+/g, " ");
  const m = t.search(/[.!?](\s|$)/);
  const out = m > 0 ? t.slice(0, m + 1) : t;
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/**
 * Shape the prior attempts as a markdown block for injection into the next
 * run's bundle. Lives on the same wire as `formatPriorLearnings` (P2) — the
 * runner concatenates this with agent-scoped episodes so the next attempt
 * sees BOTH "what this agent learned in general" and "what's specifically
 * been tried on THIS objective."
 */
export function composeReflexionContext(
  objective: Objective,
  attempts: AttemptOutcome[],
): string {
  if (attempts.length === 0) return "";
  const lines = [
    `# Objective: ${objective.title}`,
    ``,
    objective.description.trim(),
    ``,
    `## Prior attempts on this objective`,
  ];
  for (const a of attempts) {
    const verifier = a.verificationPassed === null ? "n/a" : a.verificationPassed ? "passed" : "failed";
    lines.push(
      ``,
      `### Attempt ${a.attemptNumber} — ${a.status} (verification: ${verifier})`,
      firstSentence(a.summary),
    );
  }
  lines.push(
    ``,
    `## What to do differently on attempt ${attempts.length + 1}`,
    `- Do not repeat the steps above that produced the same failure.`,
    `- If the verifier rejected the output, address its specific complaint before re-submitting.`,
    `- If a tool call failed, prefer a different tool or a smaller scope.`,
  );
  return lines.join("\n");
}

// --- Sink-based runner ------------------------------------------------------
//
// Mirrors eval/circuit-breaker.ts: the runner injects all DB I/O so unit tests
// don't need a live Postgres. lifecycle.ts builds the production sink when the
// operator unblocks the database (Drizzle + Inngest follow-up enqueue + relay
// emit); until then this is typecheck- and offline-test-verified only.

export interface ReflexionSink {
  /** Load the active objective for this run, if any. Returns null when the
   *  run isn't bound to an objective (single-shot dispatch). */
  loadObjective(objectiveId: string): Promise<Objective | null>;
  /** Load attempts ordered by attempt_number ASC. The just-finished attempt
   *  is the last element. */
  loadAttempts(objectiveId: string): Promise<AttemptOutcome[]>;
  /** Mark the objective complete or abandoned. */
  setObjectiveStatus(objectiveId: string, status: "completed" | "abandoned"): Promise<void>;
  /** Queue the next attempt: a new `runs` row bound to the same objective,
   *  with `attempt_number` set and `input` carrying the reflexion context.
   *  Returns the new run id. */
  queueFollowupRun(input: {
    objective: Objective;
    nextAttemptNumber: number;
    reflexionContext: string;
  }): Promise<string>;
  /** Emit `objective.reflexion_decided` to the relay so the dashboard can
   *  show retry/abandon decisions in real time. */
  emitDecision(input: {
    objective: Objective;
    decision: ReflexionDecision;
    followupRunId: string | null;
  }): Promise<void>;
}

export interface ReflexionRunResult {
  decision: ReflexionDecision;
  followupRunId: string | null;
}

/**
 * Run a reflexion cycle for one objective. Called from lifecycle.ts on every
 * `runs` finish when the run carries `objective_id`. No-op for objective-less
 * runs (the lifecycle hook skips before reaching us).
 */
export async function runReflexion(
  objectiveId: string,
  sink: ReflexionSink,
  config: ReflexionConfig = DEFAULT_REFLEXION_CONFIG,
): Promise<ReflexionRunResult | null> {
  const objective = await sink.loadObjective(objectiveId);
  if (!objective) return null;

  const attempts = await sink.loadAttempts(objectiveId);
  const decision = decideReflexion(objective, attempts, config);

  let followupRunId: string | null = null;
  if (decision.action === "complete") {
    await sink.setObjectiveStatus(objective.id, "completed");
  } else if (decision.action === "abandon") {
    await sink.setObjectiveStatus(objective.id, "abandoned");
  } else if (decision.action === "retry" && decision.nextAttemptNumber != null) {
    const ctx = composeReflexionContext(objective, attempts);
    followupRunId = await sink.queueFollowupRun({
      objective,
      nextAttemptNumber: decision.nextAttemptNumber,
      reflexionContext: ctx,
    });
  }

  await sink.emitDecision({ objective, decision, followupRunId });
  return { decision, followupRunId };
}
