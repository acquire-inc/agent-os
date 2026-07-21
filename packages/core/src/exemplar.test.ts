// Pure unit tests for the exemplar learning loop (no DB).
// Run: pnpm --filter @agent-os/core test:exemplar
import {
  composeExemplarBlock,
  exemplarFromDecision,
  exemplarNamespace,
  MAX_BLOCK_CHARS,
  PRINCIPLE_PROMOTION_THRESHOLD,
  runExemplarHarvest,
  selectPromotable,
  tallyCorrections,
  type DecisionRecord,
  type ExemplarSink,
} from "./exemplar.js";
import type { ImprovementProposal } from "./improve.js";

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

let seq = 0;
const dec = (decision: DecisionRecord["decision"], draft = "Send the weekly summary to #ops.", operatorText?: string): DecisionRecord => ({
  approvalId: `ap-${++seq}`,
  agentId: "a1",
  taskLabel: "weekly-summary",
  draft,
  decision,
  operatorText: operatorText ?? null,
});

async function main() {
  console.log("\n[exemplarFromDecision — the three labels]");
  {
    const e = exemplarFromDecision(dec("approved"));
    assert(e?.kind === "positive", "approved → positive exemplar");
    assert(e?.text.includes("weekly summary"), "positive carries the draft");
  }
  {
    const e = exemplarFromDecision(dec("edited", "Draft v1", "Operator's better version"));
    assert(e?.kind === "positive", "edited → positive exemplar");
    assert(e?.text === "Operator's better version", "the EDIT is the exemplar, not the draft");
  }
  {
    const e = exemplarFromDecision(dec("rejected"));
    assert(e?.kind === "negative", "rejected → negative exemplar");
  }
  {
    assert(exemplarFromDecision(dec("approved", "   ")) === null, "empty draft → null (nothing to learn)");
    assert(exemplarFromDecision(dec("edited", "draft", "")) === null, "edited without operator text → null (skip malformed)");
  }
  {
    const long = "x".repeat(600);
    const e = exemplarFromDecision(dec("approved", long));
    assert(e!.text.length <= 400, "exemplar text clipped to cap");
  }

  console.log("\n[tallyCorrections — recurring edits become candidates]");
  {
    const t = tallyCorrections([
      dec("edited", "d", "Always CC the founder."),
      dec("edited", "d", "always cc  the Founder."),
      dec("edited", "d", "Always CC the founder."),
      dec("edited", "d", "Different correction."),
      dec("approved"),
      dec("rejected"),
    ]);
    assert(t.length === 2, "two distinct corrections tallied");
    assert(t[0]!.count === 3, "normalization unifies case/whitespace variants (3 distinct approvals)");
    assert(t[1]!.count === 1, "singleton correction counted once");
  }
  {
    // Same approval id can't inflate the count.
    const d1 = dec("edited", "d", "Same rule.");
    const t = tallyCorrections([d1, { ...d1 }]);
    assert(t[0]!.count === 1, "recurrence counts DISTINCT approvals, not rows");
  }

  console.log("\n[selectPromotable — threshold]");
  {
    const t = [
      { fingerprint: "a", display: "A", count: 3 },
      { fingerprint: "b", display: "B", count: 2 },
    ];
    const p = selectPromotable(t);
    assert(p.length === 1 && p[0]!.display === "A", `only >=${PRINCIPLE_PROMOTION_THRESHOLD} promotes`);
  }

  console.log("\n[composeExemplarBlock — bounded, ordered, honest]");
  {
    const exemplars = [
      exemplarFromDecision(dec("approved", "Good draft one."))!,
      exemplarFromDecision(dec("rejected", "Bad draft."))!,
    ];
    const block = composeExemplarBlock(exemplars, [{ fingerprint: "f", display: "Always CC the founder.", count: 4 }]);
    assert(block.startsWith("## What the operator approved"), "block leads with the header");
    assert(/match this quality/.test(block), "positive section present");
    assert(/do NOT produce/.test(block), "negative section present");
    assert(/corrected 4×/.test(block), "principle carries its recurrence count");
    assert(block.length <= MAX_BLOCK_CHARS, "block bounded");
  }
  {
    assert(composeExemplarBlock([], []) === "", "nothing to say → empty string (no prompt bloat)");
  }
  {
    // Char cap actually stops emission.
    const many = Array.from({ length: 10 }, (_, i) =>
      exemplarFromDecision(dec("approved", `Draft ${i}: ${"y".repeat(390)}`))!,
    );
    const block = composeExemplarBlock(many, []);
    assert(block.length <= MAX_BLOCK_CHARS, "over-supply clipped at char cap");
  }

  console.log("\n[exemplarNamespace — sibling of episodes]");
  assert(exemplarNamespace("a1") === "agent/a1/exemplars", "namespace agent-scoped");
  assert(exemplarNamespace("a1") !== exemplarNamespace("a2"), "different agents isolated");

  console.log("\n[runExemplarHarvest — sink wiring]");
  {
    const sink = spySink([
      dec("approved"),
      dec("edited", "d", "Always CC the founder."),
      dec("edited", "d", "Always CC the founder."),
      dec("edited", "d", "Always CC the founder."),
    ]);
    const r = await runExemplarHarvest("a1", sink);
    assert(r.exemplars.length === 4, "all learnable decisions became exemplars");
    assert(r.principles.length === 1, "recurring correction promoted");
    assert(sink.calls.writes.length === 1, "block written once");
    assert(sink.calls.writes[0]!.includes("Standing corrections"), "written block carries principles");
    assert(sink.calls.emits.length === 1, "exemplar.harvested emitted");
    assert(sink.calls.emits[0]!.principleCount === 1, "emit carries counts");
  }
  {
    const sink = spySink([]);
    const r = await runExemplarHarvest("a1", sink);
    assert(r.exemplars.length === 0 && r.blockChars === 0, "no decisions → no-op");
    assert(sink.calls.writes.length === 0 && sink.calls.emits.length === 0, "no write, no emit on no-op");
  }

  console.log("\n[anti-reward-hacking — the learning surfaces cannot touch the rubric]");
  {
    // Doctrine test: the exemplar types expose NO field that could carry
    // scorecard thresholds, judge config, or gate settings. If someone adds
    // one, this enumeration breaks and forces a doctrine conversation.
    const e = exemplarFromDecision(dec("approved"))!;
    const keys = Object.keys(e).sort().join(",");
    assert(keys === "kind,sourceApprovalId,taskLabel,text", `Exemplar surface is exactly {kind,sourceApprovalId,taskLabel,text} (got ${keys})`);
  }
  {
    // Same for the improvement engine (V2 P4): proposals may only carry the
    // prompt/skill surfaces — never rubric/threshold/judge fields.
    const proposalSurface: ImprovementProposal = {
      kind: "prompt_amend",
      proposedPrompt: "p",
      skillKey: null,
      evidence: [],
      sampleSize: 3,
      rationale: "r",
      requiresHumanApproval: false,
    };
    const keys = Object.keys(proposalSurface).sort().join(",");
    assert(
      keys === "evidence,kind,proposedPrompt,rationale,requiresHumanApproval,sampleSize,skillKey",
      "ImprovementProposal surface has no rubric/threshold/judge fields",
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function spySink(decisions: DecisionRecord[]): ExemplarSink & {
  calls: { writes: string[]; emits: Array<{ exemplarCount: number; principleCount: number }> };
} {
  const calls = { writes: [] as string[], emits: [] as Array<{ exemplarCount: number; principleCount: number }> };
  return {
    calls,
    async loadDecisions() {
      return decisions;
    },
    async writeExemplarBlock(_agentId, block) {
      calls.writes.push(block);
    },
    async emitHarvested(input) {
      calls.emits.push({ exemplarCount: input.exemplarCount, principleCount: input.principleCount });
    },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
