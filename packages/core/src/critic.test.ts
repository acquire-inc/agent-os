// Pure unit tests for critic-agent peer-approval (no DB required).
// Run: pnpm --filter @agent-os/core test:critic
import {
  DEFAULT_CRITIC_POLICY,
  isCriticEligible,
  qualifyCritics,
  runCriticReview,
  tallyCriticVotes,
  type CriticCandidate,
  type CriticReviewSink,
  type CriticVote,
  type ProposalForReview,
  type QuorumDecision,
} from "./critic.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const proposal = (overrides: Partial<ProposalForReview> = {}): ProposalForReview => ({
  approvalId: "ap-1",
  tenantId: "t-1",
  proposerAgentId: "agent-proposer",
  proposerIsCantFail: false,
  estimatedCostUsd: 1,
  ...overrides,
});

const vote = (criticAgentId: string, verdict: CriticVote["verdict"]): CriticVote => ({
  criticAgentId,
  verdict,
  rationale: `${verdict} because reasons`,
});

const candidate = (agentId: string, successRate = 0.95, runCount = 50): CriticCandidate => ({
  agentId,
  successRate,
  runCount,
  isCantFail: false,
});

async function main() {
  console.log("\n[isCriticEligible — hard gates]");
  {
    const d = isCriticEligible(proposal());
    assert(d.eligible, "low-stakes non-cant-fail proposal is eligible");
  }
  {
    const d = isCriticEligible(proposal({ proposerIsCantFail: true }));
    assert(!d.eligible, "can't-fail proposer → NEVER critic-decidable");
    assert(/human approval only/.test(d.reason), "reason names the human-only rule");
  }
  {
    const d = isCriticEligible(proposal({ estimatedCostUsd: null }));
    assert(!d.eligible, "unknown stake → human-only");
  }
  {
    const d = isCriticEligible(proposal({ estimatedCostUsd: 50 }));
    assert(!d.eligible, "stake above cap → human-only");
    assert(/stake cap/.test(d.reason), "reason names the stake cap");
  }
  {
    const d = isCriticEligible(proposal({ estimatedCostUsd: 5 }));
    assert(d.eligible, "stake exactly at cap is eligible (<= boundary)");
  }

  console.log("\n[qualifyCritics — earned trust]");
  {
    const out = qualifyCritics(
      [candidate("c1"), candidate("c2", 0.5), candidate("c3", 0.95, 3), candidate("agent-proposer")],
      "agent-proposer",
    );
    assert(out.length === 1 && out[0]!.agentId === "c1", "low success rate, low run count, and proposer all excluded");
  }
  {
    const out = qualifyCritics([candidate("c1", 0.9, 20)], "agent-proposer");
    assert(out.length === 1, "floors are inclusive (0.9 rate, 20 runs qualify)");
  }

  console.log("\n[tallyCriticVotes — quorum + rejection escalation]");
  {
    const d = tallyCriticVotes([vote("c1", "approve"), vote("c2", "approve")], "agent-proposer");
    assert(d.outcome === "approved", "2 distinct approvals, zero rejections → approved");
    assert(d.approvals === 2, "approval count correct");
  }
  {
    const d = tallyCriticVotes([vote("c1", "approve")], "agent-proposer");
    assert(d.outcome === "pending", "1/2 approvals → pending");
  }
  {
    const d = tallyCriticVotes(
      [vote("c1", "approve"), vote("c2", "approve"), vote("c3", "reject")],
      "agent-proposer",
    );
    assert(d.outcome === "escalate_to_human", "ANY rejection escalates even with quorum approvals");
    assert(/peer doubt/.test(d.rationale), "rationale explains the doubt rule");
  }
  {
    const d = tallyCriticVotes([vote("agent-proposer", "approve"), vote("c1", "approve")], "agent-proposer");
    assert(d.outcome === "pending", "self-vote ignored — proposer can't help its own quorum");
    assert(d.approvals === 1, "only the non-self vote counted");
  }
  {
    // Duplicate critic votes count once; latest verdict wins.
    const d = tallyCriticVotes([vote("c1", "approve"), vote("c1", "approve"), vote("c2", "approve")], "p");
    assert(d.approvals === 2, "duplicate votes from one critic count once");
    const d2 = tallyCriticVotes([vote("c1", "approve"), vote("c1", "reject")], "p");
    assert(d2.outcome === "escalate_to_human", "critic changing to reject → latest verdict wins");
  }
  {
    const d = tallyCriticVotes([], "p");
    assert(d.outcome === "pending", "no votes → pending");
  }

  console.log("\n[runCriticReview — quorum approves through the sink]");
  {
    const sink = makeSpySink({
      proposal: proposal(),
      votes: [vote("c1", "approve"), vote("c2", "approve")],
    });
    const r = await runCriticReview("ap-1", sink);
    assert(r!.decision!.outcome === "approved", "quorum met → approved");
    assert(sink.calls.approved.length === 1, "approveByQuorum called");
    assert(sink.calls.escalated.length === 0, "no escalation");
    assert(sink.calls.emits.length === 1, "decision emitted");
  }

  console.log("\n[runCriticReview — rejection escalates through the sink]");
  {
    const sink = makeSpySink({
      proposal: proposal(),
      votes: [vote("c1", "approve"), vote("c2", "reject")],
    });
    const r = await runCriticReview("ap-1", sink);
    assert(r!.decision!.outcome === "escalate_to_human", "rejection → escalate");
    assert(sink.calls.escalated.length === 1, "escalateToHuman called");
    assert(sink.calls.approved.length === 0, "not approved");
    assert(sink.calls.emits.length === 1, "escalation emitted");
  }

  console.log("\n[runCriticReview — pending waits silently]");
  {
    const sink = makeSpySink({ proposal: proposal(), votes: [vote("c1", "approve")] });
    const r = await runCriticReview("ap-1", sink);
    assert(r!.decision!.outcome === "pending", "1/2 votes → pending");
    assert(sink.calls.approved.length === 0 && sink.calls.escalated.length === 0, "no state change on pending");
    assert(sink.calls.emits.length === 0, "no emit on pending");
  }

  console.log("\n[runCriticReview — ineligible proposals untouched]");
  {
    const sink = makeSpySink({
      proposal: proposal({ proposerIsCantFail: true }),
      votes: [vote("c1", "approve"), vote("c2", "approve")],
    });
    const r = await runCriticReview("ap-1", sink);
    assert(r!.eligibility.eligible === false, "cant-fail proposal ineligible");
    assert(r!.decision === null, "no quorum decision for ineligible proposal");
    assert(sink.calls.approved.length === 0, "votes CANNOT approve a cant-fail proposal");
    assert(sink.calls.emits.length === 0, "no emit — proposal never entered critic review");
  }
  {
    const sink = makeSpySink({ proposal: null, votes: [] });
    const r = await runCriticReview("ap-missing", sink);
    assert(r === null, "missing approval → null");
  }

  console.log("\n[policy sanity]");
  assert(DEFAULT_CRITIC_POLICY.quorum === 2, "default quorum is 2");
  assert(DEFAULT_CRITIC_POLICY.maxStakeUsd === 5, "default stake cap is $5");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

interface SpyState {
  proposal: ProposalForReview | null;
  votes: CriticVote[];
}

function makeSpySink(state: SpyState): CriticReviewSink & {
  calls: { approved: QuorumDecision[]; escalated: QuorumDecision[]; emits: unknown[] };
} {
  const calls = { approved: [] as QuorumDecision[], escalated: [] as QuorumDecision[], emits: [] as unknown[] };
  return {
    calls,
    async loadProposal(id) {
      return state.proposal && state.proposal.approvalId === id ? state.proposal : null;
    },
    async loadVotes() {
      return state.votes;
    },
    async approveByQuorum(_id, decision) {
      calls.approved.push(decision);
    },
    async escalateToHuman(_id, decision) {
      calls.escalated.push(decision);
    },
    async emitDecision(input) {
      calls.emits.push(input);
    },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
