// Agent prompt/skill self-improvement proposal engine (V2 P4).
//
// P1+P2 give an agent episodic memory; P3 carries failure context across
// attempts of one objective. But the agent's SYSTEM PROMPT — its standing
// instructions — still only changes when a human edits it. This module closes
// that loop: it watches an agent's recent run outcomes + distilled lessons and,
// when a durable pattern emerges, PROPOSES a prompt amendment or a skill
// composition change. Proposals land in an operator-reviewed queue (mirroring
// model_feedback_proposals from Phase 45) — nothing self-applies silently.
//
// Safety rules, always:
//   - Can't-fail agents NEVER get auto-applied prompt changes. Proposals are
//     allowed (the operator may want the insight) but apply is human-gated
//     regardless of any tenant auto-apply opt-in. The caller passes
//     `isCantFail` (same convention as router/resolve.ts) so this module stays
//     free of cross-module deps.
//   - Amendments are APPEND-ONLY: a bounded "Learned guidance" section is
//     appended to the prompt. The engine never rewrites or deletes existing
//     prompt text — the doctrine sections a human authored stay intact.
//   - Bounded size: the learned-guidance block is capped (MAX_GUIDANCE_ITEMS
//     bullets, MAX_GUIDANCE_CHARS chars). Re-proposals REPLACE the block, so
//     repeated cycles can't grow the prompt without bound.
//   - Sample-size floor: a lesson must recur across MIN_RECURRENCE distinct
//     runs before it's eligible. One bad afternoon isn't doctrine.
//
// Pure decision functions + a sink-based runner (mirrors objective.ts and
// eval/circuit-breaker.ts) so everything is unit-testable without a live DB.

export const MIN_RECURRENCE = 3;
export const MAX_GUIDANCE_ITEMS = 5;
export const MAX_GUIDANCE_CHARS = 1200;

/** Marker delimiting the engine-owned section of a system prompt. Everything
 *  outside this block is human-authored and never touched. */
export const GUIDANCE_HEADER = "## Learned guidance (auto-proposed, operator-approved)";

export interface ImprovementObservation {
  runId: string;
  status: "done" | "failed" | "escalated" | "skipped" | "quarantined";
  verificationPassed: boolean | null;
  /** Distilled lessons from the memory loop (P2) for this run. */
  lessons: string[];
}

export type ImprovementKind = "prompt_amend" | "skill_add" | "skill_remove";

export interface ImprovementProposal {
  kind: ImprovementKind;
  /** For prompt_amend: the full new prompt text (existing prompt + replaced
   *  guidance block). For skill_*: empty string. */
  proposedPrompt: string;
  /** For skill_*: the skill key in question. For prompt_amend: null. */
  skillKey: string | null;
  /** The recurring lessons that justify the proposal. */
  evidence: string[];
  /** Number of distinct runs backing the strongest lesson. */
  sampleSize: number;
  rationale: string;
  /** Can't-fail agents: apply is ALWAYS human-gated, no auto-apply path. */
  requiresHumanApproval: boolean;
}

/** Normalize a lesson for recurrence-counting: case/whitespace-insensitive. */
function lessonFingerprint(lesson: string): string {
  return lesson.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Count recurring lessons across observations. A lesson "recurs" when its
 * normalized form appears in >= MIN_RECURRENCE distinct runs.
 * Returns recurring lessons ordered by recurrence (highest first), each with
 * its display text (first occurrence's original casing) and count.
 */
export function recurringLessons(
  observations: ImprovementObservation[],
  minRecurrence: number = MIN_RECURRENCE,
): Array<{ lesson: string; count: number }> {
  const counts = new Map<string, { display: string; runs: Set<string> }>();
  for (const obs of observations) {
    for (const lesson of obs.lessons) {
      const fp = lessonFingerprint(lesson);
      if (!fp) continue;
      const entry = counts.get(fp) ?? { display: lesson.trim(), runs: new Set<string>() };
      entry.runs.add(obs.runId);
      counts.set(fp, entry);
    }
  }
  return Array.from(counts.values())
    .filter((e) => e.runs.size >= minRecurrence)
    .sort((a, b) => b.runs.size - a.runs.size)
    .map((e) => ({ lesson: e.display, count: e.runs.size }));
}

/** Split a prompt into (human-authored base, existing guidance block or null).
 *  The guidance block is everything from GUIDANCE_HEADER to end-of-prompt —
 *  the engine always appends it last, so this split is stable. */
export function splitGuidanceBlock(prompt: string): { base: string; guidance: string | null } {
  const idx = prompt.indexOf(GUIDANCE_HEADER);
  if (idx === -1) return { base: prompt, guidance: null };
  return {
    base: prompt.slice(0, idx).replace(/\s+$/, ""),
    guidance: prompt.slice(idx),
  };
}

/** Compose the bounded learned-guidance block from recurring lessons. */
export function composeGuidanceBlock(lessons: Array<{ lesson: string; count: number }>): string {
  const items: string[] = [];
  let used = GUIDANCE_HEADER.length + 1;
  for (const { lesson, count } of lessons.slice(0, MAX_GUIDANCE_ITEMS)) {
    const line = `- ${lesson} (seen in ${count} runs)`;
    if (used + line.length + 1 > MAX_GUIDANCE_CHARS) break;
    items.push(line);
    used += line.length + 1;
  }
  if (items.length === 0) return "";
  return [GUIDANCE_HEADER, ...items].join("\n");
}

/**
 * Decide whether the agent's recent history warrants a prompt amendment.
 * Returns null when there's nothing durable to propose (the common case).
 *
 * @param currentPrompt The agent's CURRENT system prompt (latest agent_prompts
 *                      version). The proposal appends/replaces only the
 *                      engine-owned guidance block.
 */
export function proposePromptAmendment(input: {
  currentPrompt: string;
  observations: ImprovementObservation[];
  isCantFail: boolean;
  minRecurrence?: number;
}): ImprovementProposal | null {
  const recurring = recurringLessons(input.observations, input.minRecurrence ?? MIN_RECURRENCE);
  if (recurring.length === 0) return null;

  const block = composeGuidanceBlock(recurring);
  if (!block) return null;

  const { base, guidance } = splitGuidanceBlock(input.currentPrompt);

  // No-op guard: if the composed block matches what's already in the prompt,
  // don't propose — re-proposing identical guidance churns the queue.
  if (guidance !== null && guidance.trim() === block.trim()) return null;

  const proposedPrompt = `${base}\n\n${block}`;
  const top = recurring[0]!;
  return {
    kind: "prompt_amend",
    proposedPrompt,
    skillKey: null,
    evidence: recurring.map((r) => r.lesson),
    sampleSize: top.count,
    rationale:
      guidance === null
        ? `${recurring.length} lesson(s) recurred across >=${input.minRecurrence ?? MIN_RECURRENCE} runs; adding learned-guidance block (top: "${top.lesson}" x${top.count})`
        : `learned-guidance block updated with ${recurring.length} recurring lesson(s) (top: "${top.lesson}" x${top.count})`,
    requiresHumanApproval: input.isCantFail,
  };
}

// --- Sink-based runner ------------------------------------------------------

export interface ImprovementSink {
  /** Recent observations for the agent (lessons from the memory loop joined
   *  to run outcomes), newest last. The caller bounds the window. */
  loadObservations(agentId: string): Promise<ImprovementObservation[]>;
  /** The agent's current prompt text (agent_prompts where is_current). */
  loadCurrentPrompt(agentId: string): Promise<string | null>;
  /** Whether this agent's key is on the CANT_FAIL_KEYS list. */
  isCantFail(agentId: string): Promise<boolean>;
  /** Persist the proposal as a pending row (agent_improvement_proposals).
   *  Returns the proposal id. */
  writeProposal(agentId: string, proposal: ImprovementProposal): Promise<string>;
  /** Emit `improvement.proposed` to the relay for the dashboard. */
  emitProposed(input: { agentId: string; proposalId: string; proposal: ImprovementProposal }): Promise<void>;
}

export interface ImprovementRunResult {
  proposalId: string | null;
  proposal: ImprovementProposal | null;
}

/**
 * Run one self-improvement cycle for an agent. Called on the scorecard cadence
 * (~6h) — durable patterns, not per-run noise. No-op (null proposal) when
 * nothing recurs.
 */
export async function runSelfImprovement(
  agentId: string,
  sink: ImprovementSink,
  opts: { minRecurrence?: number } = {},
): Promise<ImprovementRunResult> {
  const currentPrompt = await sink.loadCurrentPrompt(agentId);
  if (currentPrompt == null) return { proposalId: null, proposal: null };

  const observations = await sink.loadObservations(agentId);
  const cantFail = await sink.isCantFail(agentId);

  const proposal = proposePromptAmendment({
    currentPrompt,
    observations,
    isCantFail: cantFail,
    minRecurrence: opts.minRecurrence,
  });
  if (!proposal) return { proposalId: null, proposal: null };

  const proposalId = await sink.writeProposal(agentId, proposal);
  await sink.emitProposed({ agentId, proposalId, proposal });
  return { proposalId, proposal };
}
