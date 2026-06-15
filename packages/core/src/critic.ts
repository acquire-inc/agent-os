// Critic-agent peer-approval (V2 P6).
//
// Today every `propose` lands in a human approvals inbox. That's right for
// high-stakes calls, but it makes the human the throughput bottleneck for the
// long tail of low-stakes, repetitive proposals ("post the daily summary",
// "tag 12 leads"). This module adds a peer layer: agents that have EARNED
// trust (sustained scorecard success) can vote on eligible proposals, and a
// clean quorum auto-decides — the human inbox keeps only what deserves human
// judgment.
//
// Safety rules, always (these are the doctrine, not defaults):
//   - Proposals FROM can't-fail agents are NEVER critic-decidable. Human only.
//     (CRA-prohibited categories never reach proposals at all — the architect
//     and runtime guard refuse upstream — but eligibility re-checks anyway.)
//   - A critic may not vote on its own proposal, nor on a proposal from the
//     same agent (self-dealing guard).
//   - Quorum = N distinct approving critics (default 2) with ZERO rejections.
//     ANY rejection immediately escalates to the human inbox — peers can
//     fast-track approval, but only a human can overrule a peer's doubt.
//   - Stake cap: proposals whose estimated cost exceeds the threshold are
//     human-only regardless of votes.
//   - Critic trust is EARNED: minimum scorecard success rate over a minimum
//     run count, mirroring the autonomy ladder's promotion philosophy.
//
// Pure decision functions + a sink-based runner (mirrors objective.ts,
// improve.ts, eval/circuit-breaker.ts) so it's unit-testable without a DB.

export const DEFAULT_QUORUM = 2;
export const DEFAULT_MAX_STAKE_USD = 5;
export const DEFAULT_MIN_CRITIC_SUCCESS_RATE = 0.9;
export const DEFAULT_MIN_CRITIC_RUNS = 20;

export interface CriticPolicy {
  /** Distinct approving critics required to auto-approve. */
  quorum: number;
  /** Proposals with estimated cost above this are human-only. */
  maxStakeUsd: number;
  /** Scorecard floor for an agent to act as critic. */
  minCriticSuccessRate: number;
  minCriticRuns: number;
}

export const DEFAULT_CRITIC_POLICY: CriticPolicy = {
  quorum: DEFAULT_QUORUM,
  maxStakeUsd: DEFAULT_MAX_STAKE_USD,
  minCriticSuccessRate: DEFAULT_MIN_CRITIC_SUCCESS_RATE,
  minCriticRuns: DEFAULT_MIN_CRITIC_RUNS,
};

export interface ProposalForReview {
  approvalId: string;
  tenantId: string;
  /** Agent that made the proposal. */
  proposerAgentId: string;
  /** Whether the proposer is on CANT_FAIL_KEYS (caller-passed, same
   *  convention as router/resolve.ts). */
  proposerIsCantFail: boolean;
  /** Best-effort cost estimate of the proposed action; null = unknown. */
  estimatedCostUsd: number | null;
}

export interface EligibilityDecision {
  eligible: boolean;
  reason: string;
}

/** Gate: can this proposal enter critic review at all? */
export function isCriticEligible(
  proposal: ProposalForReview,
  policy: CriticPolicy = DEFAULT_CRITIC_POLICY,
): EligibilityDecision {
  if (proposal.proposerIsCantFail) {
    return { eligible: false, reason: "proposer is a can't-fail agent — human approval only" };
  }
  if (proposal.estimatedCostUsd == null) {
    return { eligible: false, reason: "no cost estimate — unknown stake is human-only" };
  }
  if (proposal.estimatedCostUsd > policy.maxStakeUsd) {
    return {
      eligible: false,
      reason: `estimated cost $${proposal.estimatedCostUsd} exceeds critic stake cap $${policy.maxStakeUsd}`,
    };
  }
  return { eligible: true, reason: "low-stakes, non-cant-fail — critic quorum may decide" };
}

export interface CriticCandidate {
  agentId: string;
  /** Scorecard-derived trailing success rate (0..1). */
  successRate: number;
  /** Runs in the scorecard window. */
  runCount: number;
  isCantFail: boolean;
}

/** Trust gate: which agents qualify as critics for this proposal?
 *  The proposer (and any same-agent identity) is always excluded. */
export function qualifyCritics(
  candidates: CriticCandidate[],
  proposerAgentId: string,
  policy: CriticPolicy = DEFAULT_CRITIC_POLICY,
): CriticCandidate[] {
  return candidates.filter(
    (c) =>
      c.agentId !== proposerAgentId &&
      c.runCount >= policy.minCriticRuns &&
      c.successRate >= policy.minCriticSuccessRate,
  );
}

export type CriticVerdict = "approve" | "reject";

export interface CriticVote {
  criticAgentId: string;
  verdict: CriticVerdict;
  rationale: string;
}

export type QuorumOutcome = "approved" | "escalate_to_human" | "pending";

export interface QuorumDecision {
  outcome: QuorumOutcome;
  approvals: number;
  rejections: number;
  rationale: string;
}

/**
 * Tally votes for a proposal. Rules:
 *  - ANY rejection → escalate_to_human (a peer's doubt is never outvoted).
 *  - >= quorum distinct approving critics, zero rejections → approved.
 *  - Otherwise → pending (waiting for more votes).
 * Votes from the proposer itself are ignored (defense-in-depth; qualifyCritics
 * should have excluded them already). Duplicate votes from the same critic
 * count once (latest verdict wins).
 */
export function tallyCriticVotes(
  votes: CriticVote[],
  proposerAgentId: string,
  policy: CriticPolicy = DEFAULT_CRITIC_POLICY,
): QuorumDecision {
  const byCritic = new Map<string, CriticVerdict>();
  for (const v of votes) {
    if (v.criticAgentId === proposerAgentId) continue; // self-vote guard
    byCritic.set(v.criticAgentId, v.verdict); // latest wins
  }
  let approvals = 0;
  let rejections = 0;
  for (const verdict of byCritic.values()) {
    if (verdict === "approve") approvals++;
    else rejections++;
  }
  if (rejections > 0) {
    return {
      outcome: "escalate_to_human",
      approvals,
      rejections,
      rationale: `${rejections} critic rejection(s) — peer doubt escalates to human`,
    };
  }
  if (approvals >= policy.quorum) {
    return {
      outcome: "approved",
      approvals,
      rejections,
      rationale: `quorum met: ${approvals}/${policy.quorum} distinct critics approved, zero rejections`,
    };
  }
  return {
    outcome: "pending",
    approvals,
    rejections,
    rationale: `${approvals}/${policy.quorum} approvals — waiting for quorum`,
  };
}

// --- Sink-based runner ------------------------------------------------------

export interface CriticReviewSink {
  loadProposal(approvalId: string): Promise<ProposalForReview | null>;
  /** Votes recorded so far for this approval. */
  loadVotes(approvalId: string): Promise<CriticVote[]>;
  /** Resolve the approval as critic-approved (decided_via='critic_quorum'). */
  approveByQuorum(approvalId: string, decision: QuorumDecision): Promise<void>;
  /** Flag the approval for human attention (stays open; marked escalated). */
  escalateToHuman(approvalId: string, decision: QuorumDecision): Promise<void>;
  /** Emit `critic.quorum_decided` to the relay. */
  emitDecision(input: {
    /** Tenant scope for the relay row — threaded from the loaded proposal so
     *  the sink never writes an empty-string tenantId. */
    tenantId: string;
    approvalId: string;
    eligibility: EligibilityDecision;
    decision: QuorumDecision | null;
  }): Promise<void>;
}

export interface CriticReviewResult {
  eligibility: EligibilityDecision;
  decision: QuorumDecision | null;
}

/**
 * Run a critic-review cycle for one approval (called when a new critic vote
 * lands, or on a sweep). Ineligible proposals are left untouched in the human
 * inbox — no emit, no state change (they were never in critic review).
 */
export async function runCriticReview(
  approvalId: string,
  sink: CriticReviewSink,
  policy: CriticPolicy = DEFAULT_CRITIC_POLICY,
): Promise<CriticReviewResult | null> {
  // Kill switch: AOS_FEATURE_CRITIC_QUORUM_DISABLED=1. The proposal stays
  // in the human inbox (default routing); we return a special
  // "disabled" eligibility so callers can log it once and move on.
  const { isFeatureDisabled } = await import("./feature-flags.js");
  if (isFeatureDisabled("CRITIC_QUORUM")) {
    return {
      eligibility: { eligible: false, reason: "critic quorum feature disabled (AOS_FEATURE_CRITIC_QUORUM_DISABLED=1)" },
      decision: null,
    };
  }

  const proposal = await sink.loadProposal(approvalId);
  if (!proposal) return null;

  const eligibility = isCriticEligible(proposal, policy);
  if (!eligibility.eligible) {
    return { eligibility, decision: null };
  }

  const votes = await sink.loadVotes(approvalId);
  const decision = tallyCriticVotes(votes, proposal.proposerAgentId, policy);

  if (decision.outcome === "approved") {
    await sink.approveByQuorum(approvalId, decision);
    await sink.emitDecision({ tenantId: proposal.tenantId, approvalId, eligibility, decision });
  } else if (decision.outcome === "escalate_to_human") {
    await sink.escalateToHuman(approvalId, decision);
    await sink.emitDecision({ tenantId: proposal.tenantId, approvalId, eligibility, decision });
  }
  // pending: no state change, no emit — wait for more votes.

  return { eligibility, decision };
}
