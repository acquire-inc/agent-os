// Pure unit tests for the self-improvement proposal engine (no DB required).
// Run: pnpm --filter @agent-os/core test:improve
import {
  composeGuidanceBlock,
  GUIDANCE_HEADER,
  MAX_GUIDANCE_ITEMS,
  MIN_RECURRENCE,
  proposePromptAmendment,
  recurringLessons,
  runSelfImprovement,
  splitGuidanceBlock,
  type ImprovementObservation,
  type ImprovementProposal,
  type ImprovementSink,
} from "./improve.js";

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

let runSeq = 0;
const obs = (lessons: string[], status: ImprovementObservation["status"] = "failed"): ImprovementObservation => ({
  runId: `run-${++runSeq}`,
  status,
  verificationPassed: status === "done",
  lessons,
});

const BASE_PROMPT = "You are the ad-spend watcher.\n\n## Doctrine\n- Never exceed daily caps.";

async function main() {
  console.log("\n[recurringLessons — recurrence floor]");
  {
    const r = recurringLessons([
      obs(["Check GL mapping first."]),
      obs(["Check GL mapping first."]),
      obs(["Check GL mapping first."]),
    ]);
    assert(r.length === 1, "lesson recurring in 3 runs clears the floor");
    assert(r[0]!.count === 3, "count reflects distinct runs");
  }
  {
    const r = recurringLessons([obs(["Only twice."]), obs(["Only twice."])]);
    assert(r.length === 0, "2 recurrences < MIN_RECURRENCE(3) → not durable");
  }
  {
    // Same lesson repeated within ONE run counts once (distinct runs, not mentions).
    const r = recurringLessons([obs(["Same twice.", "Same twice."]), obs(["Same twice."]), obs(["Same twice."])]);
    assert(r[0]!.count === 3, "recurrence counts distinct runs, not mentions");
  }
  {
    // Case/whitespace-insensitive fingerprinting.
    const r = recurringLessons([obs(["check  THE thing."]), obs(["Check the thing."]), obs(["check the thing. "])]);
    assert(r.length === 1, "normalization unifies case/whitespace variants");
  }
  {
    const r = recurringLessons(
      [obs(["A", "B"]), obs(["A", "B"]), obs(["A", "B"]), obs(["A"])],
    );
    assert(r[0]!.lesson === "A" && r[0]!.count === 4, "ordered by recurrence, highest first");
  }

  console.log("\n[composeGuidanceBlock — bounded size]");
  {
    const many = Array.from({ length: 10 }, (_, i) => ({ lesson: `Lesson ${i}`, count: 3 + i }));
    const block = composeGuidanceBlock(many);
    const bullets = block.split("\n").filter((l) => l.startsWith("- "));
    assert(bullets.length <= MAX_GUIDANCE_ITEMS, `caps at MAX_GUIDANCE_ITEMS (${MAX_GUIDANCE_ITEMS})`);
    assert(block.startsWith(GUIDANCE_HEADER), "block starts with the engine-owned header");
  }
  {
    assert(composeGuidanceBlock([]) === "", "no lessons → empty block");
  }
  {
    const huge = [{ lesson: "x".repeat(5000), count: 3 }];
    const block = composeGuidanceBlock(huge);
    assert(block === "", "single over-budget lesson is dropped (char cap)");
  }

  console.log("\n[splitGuidanceBlock — append-only invariant]");
  {
    const { base, guidance } = splitGuidanceBlock(BASE_PROMPT);
    assert(base === BASE_PROMPT, "prompt without block → base unchanged");
    assert(guidance === null, "prompt without block → guidance null");
  }
  {
    const withBlock = `${BASE_PROMPT}\n\n${GUIDANCE_HEADER}\n- Old lesson (seen in 3 runs)`;
    const { base, guidance } = splitGuidanceBlock(withBlock);
    assert(base === BASE_PROMPT, "base excludes the guidance block");
    assert(guidance!.startsWith(GUIDANCE_HEADER), "guidance block extracted");
  }

  console.log("\n[proposePromptAmendment — appends without touching doctrine]");
  {
    const observations = [obs(["Prefer cheaper model paths."]), obs(["Prefer cheaper model paths."]), obs(["Prefer cheaper model paths."])];
    const p = proposePromptAmendment({ currentPrompt: BASE_PROMPT, observations, isCantFail: false });
    assert(p !== null, "recurring lesson → proposal");
    assert(p!.kind === "prompt_amend", "kind is prompt_amend");
    assert(p!.proposedPrompt.startsWith(BASE_PROMPT), "human-authored prompt is preserved verbatim");
    assert(p!.proposedPrompt.includes(GUIDANCE_HEADER), "guidance block appended");
    assert(p!.proposedPrompt.includes("Prefer cheaper model paths. (seen in 3 runs)"), "lesson carried with evidence count");
    assert(p!.requiresHumanApproval === false, "non-cant-fail → auto-apply eligible");
    assert(p!.sampleSize === 3, "sampleSize is the top lesson's recurrence");
  }
  {
    const observations = [obs(["Be conservative."]), obs(["Be conservative."]), obs(["Be conservative."])];
    const p = proposePromptAmendment({ currentPrompt: BASE_PROMPT, observations, isCantFail: true });
    assert(p!.requiresHumanApproval === true, "cant-fail → human approval ALWAYS required");
  }
  {
    const p = proposePromptAmendment({ currentPrompt: BASE_PROMPT, observations: [obs(["once"])], isCantFail: false });
    assert(p === null, "nothing recurring → null (no proposal churn)");
  }

  console.log("\n[proposePromptAmendment — replaces stale block, no unbounded growth]");
  {
    const oldBlock = `${GUIDANCE_HEADER}\n- Old stale lesson (seen in 3 runs)`;
    const promptWithOld = `${BASE_PROMPT}\n\n${oldBlock}`;
    const observations = [obs(["New better lesson."]), obs(["New better lesson."]), obs(["New better lesson."])];
    const p = proposePromptAmendment({ currentPrompt: promptWithOld, observations, isCantFail: false });
    assert(p !== null, "stale block + new lessons → proposal");
    assert(!p!.proposedPrompt.includes("Old stale lesson"), "old block fully replaced (no growth)");
    assert(p!.proposedPrompt.includes("New better lesson."), "new block present");
    const headers = p!.proposedPrompt.split(GUIDANCE_HEADER).length - 1;
    assert(headers === 1, "exactly one guidance block after re-proposal");
  }
  {
    // Identical re-proposal is suppressed.
    const observations = [obs(["Same lesson."]), obs(["Same lesson."]), obs(["Same lesson."])];
    const first = proposePromptAmendment({ currentPrompt: BASE_PROMPT, observations, isCantFail: false });
    const second = proposePromptAmendment({ currentPrompt: first!.proposedPrompt, observations, isCantFail: false });
    assert(second === null, "identical guidance → no re-proposal (queue churn guard)");
  }

  console.log("\n[runSelfImprovement — sink wiring]");
  {
    const observations = [obs(["Cache the GL map."]), obs(["Cache the GL map."]), obs(["Cache the GL map."])];
    const sink = makeSpySink({ prompt: BASE_PROMPT, observations, cantFail: false, proposalId: "prop-9" });
    const r = await runSelfImprovement("agent-1", sink);
    assert(r.proposalId === "prop-9", "returns the written proposal id");
    assert(r.proposal !== null, "returns the proposal");
    assert(sink.calls.writes.length === 1, "writeProposal called once");
    assert(sink.calls.emits.length === 1, "improvement.proposed emitted");
    assert(sink.calls.emits[0]!.proposalId === "prop-9", "emit carries proposal id");
  }
  {
    const sink = makeSpySink({ prompt: BASE_PROMPT, observations: [obs(["once"])], cantFail: false });
    const r = await runSelfImprovement("agent-1", sink);
    assert(r.proposalId === null, "nothing durable → no write");
    assert(sink.calls.writes.length === 0, "no proposal row written");
    assert(sink.calls.emits.length === 0, "no emit on no-op");
  }
  {
    const sink = makeSpySink({ prompt: null, observations: [], cantFail: false });
    const r = await runSelfImprovement("agent-missing", sink);
    assert(r.proposalId === null, "missing prompt → no-op");
  }
  {
    const observations = [obs(["Tighten checks."]), obs(["Tighten checks."]), obs(["Tighten checks."])];
    const sink = makeSpySink({ prompt: BASE_PROMPT, observations, cantFail: true });
    const r = await runSelfImprovement("contract-drafter-id", sink);
    assert(r.proposal!.requiresHumanApproval === true, "cant-fail flag flows through the sink path");
  }

  console.log("\n[constants sanity]");
  assert(MIN_RECURRENCE === 3, "recurrence floor is 3");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

interface SpyState {
  prompt: string | null;
  observations: ImprovementObservation[];
  cantFail: boolean;
  proposalId?: string;
}

function makeSpySink(state: SpyState): ImprovementSink & {
  calls: { writes: ImprovementProposal[]; emits: Array<{ proposalId: string }> };
} {
  const calls = { writes: [] as ImprovementProposal[], emits: [] as Array<{ proposalId: string }> };
  return {
    calls,
    async loadObservations() {
      return state.observations;
    },
    async loadCurrentPrompt() {
      return state.prompt;
    },
    async isCantFail() {
      return state.cantFail;
    },
    async writeProposal(_agentId, proposal) {
      calls.writes.push(proposal);
      return state.proposalId ?? "prop-stub";
    },
    async emitProposed(input) {
      calls.emits.push({ proposalId: input.proposalId });
    },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
