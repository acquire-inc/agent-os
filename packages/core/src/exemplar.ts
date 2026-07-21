// Exemplar learning loop (V3 E1) — operator decisions become agent memory.
//
// Concept re-authored from the "shadow-mode → labeled eval dataset" pattern
// (external survey 2026-07-21; license=NONE upstream, mechanism re-authored):
// every approval decision an operator makes is a FREE, PERFECT label —
//   approved  → the draft was good        → positive exemplar
//   edited    → the operator's version is the better answer → positive
//               exemplar FROM THE EDIT (not the draft)
//   rejected  → the draft was bad         → negative exemplar
// Today AgentOS throws those labels away after the run resumes. This module
// harvests them into per-agent exemplars + promotes RECURRING corrections
// into durable principles, both injected into the agent's next bundle so the
// fleet literally gets better every time a human decides something.
//
// Anti-reward-hacking constraint (doctrine, same class as the improve.ts
// guidance block): exemplars and principles are INPUT to the agent. They can
// NEVER touch the eval rubric, scorecard thresholds, judge prompts, or any
// gate. The types in this module have no surface for those — enforced by a
// dedicated test so the constraint survives refactors.
//
// Pure decision functions + sink-based runner (mirrors memory.ts /
// objective.ts / improve.ts) — offline-testable, DB I/O injected.

// ─── Types ─────────────────────────────────────────────────────────────

export type OperatorDecision = "approved" | "rejected" | "edited";

export interface DecisionRecord {
  /** approvals.id — audit link. */
  approvalId: string;
  agentId: string;
  /** Short label of what the agent was trying to do (job name / task). */
  taskLabel: string;
  /** The agent's proposed action text (approvals.proposed_action). */
  draft: string;
  decision: OperatorDecision;
  /** When decision === "edited": the operator's corrected text. */
  operatorText?: string | null;
}

export type ExemplarKind = "positive" | "negative";

export interface Exemplar {
  kind: ExemplarKind;
  taskLabel: string;
  /** The text to learn from — the draft (approved), the operator's edit
   *  (edited), or the draft-to-avoid (rejected). */
  text: string;
  /** Where it came from — rendered in the audit trail, not the prompt. */
  sourceApprovalId: string;
}

export interface PrincipleCandidate {
  /** Normalized fingerprint of the recurring correction. */
  fingerprint: string;
  /** Display text (first occurrence's original casing). */
  display: string;
  /** DISTINCT approvals that produced this correction. */
  count: number;
}

// ─── Exemplar derivation ───────────────────────────────────────────────

const MAX_EXEMPLAR_CHARS = 400;

function clip(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > MAX_EXEMPLAR_CHARS ? `${t.slice(0, MAX_EXEMPLAR_CHARS - 1)}…` : t;
}

/**
 * Derive an exemplar from one operator decision. Returns null when there's
 * nothing to learn (empty draft, or an edit with no operator text — a
 * malformed row we skip rather than mislearn).
 */
export function exemplarFromDecision(d: DecisionRecord): Exemplar | null {
  const draft = d.draft?.trim() ?? "";
  if (!draft) return null;
  if (d.decision === "approved") {
    return { kind: "positive", taskLabel: d.taskLabel, text: clip(draft), sourceApprovalId: d.approvalId };
  }
  if (d.decision === "edited") {
    const edit = d.operatorText?.trim() ?? "";
    if (!edit) return null; // malformed: edited without the edit text
    return { kind: "positive", taskLabel: d.taskLabel, text: clip(edit), sourceApprovalId: d.approvalId };
  }
  // rejected
  return { kind: "negative", taskLabel: d.taskLabel, text: clip(draft), sourceApprovalId: d.approvalId };
}

// ─── Principle promotion ───────────────────────────────────────────────
//
// A single edit is an exemplar. The SAME KIND of edit recurring across
// several distinct decisions is a PRINCIPLE — a durable rule worth stating
// explicitly. Recurrence is counted on a normalized fingerprint of the
// operator's correction, per distinct approval (mirrors improve.ts's
// recurringLessons discipline: distinct sources, not mentions).

export const PRINCIPLE_PROMOTION_THRESHOLD = 3;

function fingerprint(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

/** Tally recurring operator corrections (edited decisions only — an edit is
 *  the operator TEACHING; approvals/rejections don't carry a correction). */
export function tallyCorrections(decisions: ReadonlyArray<DecisionRecord>): PrincipleCandidate[] {
  const tally = new Map<string, { display: string; approvals: Set<string> }>();
  for (const d of decisions) {
    if (d.decision !== "edited") continue;
    const edit = d.operatorText?.trim();
    if (!edit) continue;
    const fp = fingerprint(edit);
    const entry = tally.get(fp) ?? { display: clip(edit), approvals: new Set<string>() };
    entry.approvals.add(d.approvalId);
    tally.set(fp, entry);
  }
  return Array.from(tally.values())
    .map((e) => ({ fingerprint: fingerprint(e.display), display: e.display, count: e.approvals.size }))
    .sort((a, b) => b.count - a.count);
}

/** Candidates that cleared the promotion threshold become principles. */
export function selectPromotable(
  candidates: ReadonlyArray<PrincipleCandidate>,
  threshold: number = PRINCIPLE_PROMOTION_THRESHOLD,
): PrincipleCandidate[] {
  return candidates.filter((c) => c.count >= threshold);
}

// ─── Bundle injection block ────────────────────────────────────────────

export const MAX_BLOCK_EXEMPLARS = 4;
export const MAX_BLOCK_PRINCIPLES = 3;
export const MAX_BLOCK_CHARS = 1600;

/**
 * Compose the bounded markdown block injected into the agent's bundle.
 * Positive exemplars first (what good looks like), then negatives (what to
 * avoid), then promoted principles. Bounded so repeated harvests can't grow
 * the prompt without limit — same discipline as improve.ts's guidance block.
 */
export function composeExemplarBlock(
  exemplars: ReadonlyArray<Exemplar>,
  principles: ReadonlyArray<PrincipleCandidate>,
): string {
  const lines: string[] = [];
  let used = 0;
  const push = (s: string): boolean => {
    if (used + s.length + 1 > MAX_BLOCK_CHARS) return false;
    lines.push(s);
    used += s.length + 1;
    return true;
  };

  const positives = exemplars.filter((e) => e.kind === "positive").slice(0, MAX_BLOCK_EXEMPLARS);
  const negatives = exemplars.filter((e) => e.kind === "negative").slice(0, MAX_BLOCK_EXEMPLARS);
  if (positives.length === 0 && negatives.length === 0 && principles.length === 0) return "";

  push("## What the operator approved and corrected before");
  if (positives.length > 0) {
    push("Approved / corrected-to (match this quality and shape):");
    for (const e of positives) if (!push(`- [${e.taskLabel}] ${e.text}`)) break;
  }
  if (negatives.length > 0) {
    push("Rejected (do NOT produce drafts like these):");
    for (const e of negatives) if (!push(`- [${e.taskLabel}] ${e.text}`)) break;
  }
  const promoted = principles.slice(0, MAX_BLOCK_PRINCIPLES);
  if (promoted.length > 0) {
    push("Standing corrections (the operator has made these repeatedly — treat as rules):");
    for (const p of promoted) if (!push(`- ${p.display} (corrected ${p.count}×)`)) break;
  }
  return lines.join("\n");
}

/** Namespace for the agent's exemplar store — sibling of episodeNamespace. */
export function exemplarNamespace(agentId: string): string {
  return `agent/${agentId}/exemplars`;
}

// ─── Sink-based runner ─────────────────────────────────────────────────

export interface ExemplarSink {
  /** Decided approvals for the agent since the last harvest (chronological). */
  loadDecisions(agentId: string): Promise<DecisionRecord[]>;
  /** Persist the composed block to the agent's exemplar namespace (replaces
   *  the prior harvest — the block is a rolling window, not an append log;
   *  the raw audit trail stays in `approvals`). */
  writeExemplarBlock(agentId: string, block: string): Promise<void>;
  /** Emit `exemplar.harvested` to the relay. */
  emitHarvested(input: {
    agentId: string;
    exemplarCount: number;
    principleCount: number;
  }): Promise<void>;
}

export interface ExemplarHarvestResult {
  exemplars: Exemplar[];
  principles: PrincipleCandidate[];
  blockChars: number;
}

/**
 * Run one harvest cycle for an agent — called on the scorecard cadence
 * (durable patterns, not per-decision noise). No-op when there are no
 * decisions (no write, no emit).
 */
export async function runExemplarHarvest(
  agentId: string,
  sink: ExemplarSink,
): Promise<ExemplarHarvestResult> {
  const decisions = await sink.loadDecisions(agentId);
  const exemplars = decisions
    .map(exemplarFromDecision)
    .filter((e): e is Exemplar => e !== null);
  const principles = selectPromotable(tallyCorrections(decisions));
  if (exemplars.length === 0 && principles.length === 0) {
    return { exemplars: [], principles: [], blockChars: 0 };
  }
  const block = composeExemplarBlock(exemplars, principles);
  await sink.writeExemplarBlock(agentId, block);
  await sink.emitHarvested({
    agentId,
    exemplarCount: exemplars.length,
    principleCount: principles.length,
  });
  return { exemplars, principles, blockChars: block.length };
}
