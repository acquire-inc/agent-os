// Pure unit tests for architect parsing + hydration (no DB required).
// Run: pnpm --filter @agent-os/core test:architect
import { blueprintGaps, hydrate, isCantFail, type ResolverContext } from "./hydrate.js";
import { ParseError, extractJsonBody, parseTeamProposal as parse } from "./parse.js";

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
function assertThrows<E extends Error>(fn: () => unknown, ctor: new (...args: never[]) => E, msg: string) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${msg} — expected throw, got success`);
  } catch (e) {
    if (e instanceof ctor) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg} — wrong error: ${(e as Error).message}`);
    }
  }
}

const TENANT = "11111111-1111-1111-1111-111111111111";

const validProposalJson = JSON.stringify({
  teamName: "Meta Ads Marketing Team",
  rationale: "A three-agent loop: scout (research) → composer (draft) → monitor (watch).",
  agents: [
    {
      key: "meta-creative-scout",
      name: "Meta Creative Scout",
      role: "Mine the Meta Ad Library for winning angles in the vertical.",
      systemPrompt: "You are the Meta Creative Scout. You replace a research intern.\nEVERY MORNING (06:00):\n1. ...\nRULES:\n- ...",
      model: "nousresearch/hermes-4-70b",
      thinkingLevel: "low",
      autonomy: "propose",
      knowledgeScope: { folders: ["ad-playbooks"], tags: ["meta"] },
      budgetCapUsd: "0.30",
      cron: { schedule: "0 6 * * *", jobName: "Daily creative scout" },
      skillKeys: ["competitor-ad-teardown", "verification-before-completion"],
      mcpNames: ["Pipeboard × Meta"],
    },
    {
      key: "meta-creative-composer",
      name: "Meta Creative Composer",
      role: "Compose 3 angles/day from scout output.",
      systemPrompt: "You are the Meta Creative Composer.\nEVERY MORNING (06:15):\n1. ...\nRULES:\n- ...",
      model: "anthropic/claude-sonnet-4.6",
      thinkingLevel: "medium",
      autonomy: "propose",
      knowledgeScope: { folders: ["ad-playbooks"], tags: [] },
      budgetCapUsd: "1.00",
      cron: { schedule: "15 6 * * *", jobName: "Daily creative compose" },
      skillKeys: ["creative-generation"],
      mcpNames: ["Slack"],
    },
    {
      key: "meta-campaign-monitor",
      name: "Meta Campaign Monitor",
      role: "Hourly anomaly detection on live campaigns.",
      systemPrompt: "You are the Meta Campaign Monitor.\nEVERY HOUR:\n1. ...\nRULES:\n- ...",
      model: "nousresearch/hermes-4-70b",
      thinkingLevel: "low",
      autonomy: "execute_safe",
      knowledgeScope: { folders: ["ad-playbooks"], tags: [] },
      budgetCapUsd: "0.05",
      cron: { schedule: "30 * * * *", jobName: "Hourly campaign monitor" },
      skillKeys: ["meta-anomaly-watch"],
      mcpNames: ["Pipeboard × Meta", "Slack", "MissingMCP"],
    },
  ],
  proposedSkills: [
    { key: "meta-anomaly-watch", name: "Meta Anomaly Watch", why: "no existing skill for hourly campaign delta" },
  ],
  proposedMcps: [],
});

async function main() {
  console.log("• extractJsonBody tolerates fences and stray prose");
  const fenced = "Here you go!\n```json\n" + validProposalJson + "\n```\nLet me know if you want changes.";
  const body = extractJsonBody(fenced);
  assert(body.startsWith("{") && body.endsWith("}"), "extracts the JSON body");

  console.log("• parseTeamProposal");
  const proposal = parse(validProposalJson);
  assert(proposal.teamName === "Meta Ads Marketing Team", "reads teamName");
  assert(proposal.agents.length === 3, "reads 3 agents");
  assert(proposal.agents[0]!.key === "meta-creative-scout", "preserves keys");
  assert(proposal.proposedSkills.length === 1, "reads proposedSkills");
  assert(proposal.proposedMcps.length === 0, "reads proposedMcps");

  console.log("• parse rejects invalid input");
  assertThrows(() => parse("not json at all"), ParseError, "no JSON body");
  assertThrows(
    () => parse(JSON.stringify({ teamName: "x", rationale: "y", agents: [{ key: "BadKey", name: "n", role: "r", systemPrompt: "s", model: "m", autonomy: "propose", knowledgeScope: { folders: [], tags: [] }, budgetCapUsd: "0.10", skillKeys: [], mcpNames: [] }] })),
    ParseError,
    "rejects non-kebab key",
  );
  assertThrows(
    () => parse(JSON.stringify({ teamName: "x", rationale: "y", agents: [{ key: "ok-key", name: "n", role: "r", systemPrompt: "s", model: "m", autonomy: "execute_full", knowledgeScope: { folders: [], tags: [] }, budgetCapUsd: "0.10", skillKeys: [], mcpNames: [] }] })),
    ParseError,
    "rejects autonomy=execute_full",
  );
  assertThrows(
    () => parse(JSON.stringify({ teamName: "x", rationale: "y", agents: [{ key: "a", name: "n", role: "r", systemPrompt: "s", model: "m", autonomy: "propose", knowledgeScope: { folders: [], tags: [] }, budgetCapUsd: "0.10", skillKeys: [], mcpNames: [] }, { key: "a", name: "n2", role: "r", systemPrompt: "s", model: "m", autonomy: "propose", knowledgeScope: { folders: [], tags: [] }, budgetCapUsd: "0.10", skillKeys: [], mcpNames: [] }] })),
    ParseError,
    "rejects duplicate keys",
  );

  console.log("• hydrate clamps + warns");
  const resolver: ResolverContext = {
    knownSkillKeys: new Set(["verification-before-completion", "competitor-ad-teardown", "creative-generation"]),
    knownMcpNames: new Set(["Pipeboard × Meta", "Slack"]),
  };
  const { agents, warnings } = hydrate(TENANT, proposal, resolver);
  assert(agents.length === 3, "hydrates all 3 agents");
  assert(agents.every((a) => a.autonomy === "propose"), "clamps autonomy to propose for ALL agents");
  assert(agents.every((a) => a.enabled === false), "forces enabled=false");
  assert(agents[2]!.mcpNames.length === 2, "drops unknown MCP from bindings (MissingMCP)");
  assert(
    warnings.some((w) => w.includes("MissingMCP") && w.includes("not connected")),
    "warns about missing MCP",
  );
  assert(
    warnings.some((w) => w.includes("meta-anomaly-watch")),
    "warns about missing skill",
  );

  console.log("• hydrate stagger detection");
  const tight = {
    ...proposal,
    agents: [
      { ...proposal.agents[0]!, cron: { schedule: "0 6 * * *", jobName: "A" } },
      { ...proposal.agents[1]!, key: "alt", cron: { schedule: "2 6 * * *", jobName: "B" } },
    ],
  };
  const tightOut = hydrate(TENANT, tight, resolver);
  assert(
    tightOut.warnings.some((w) => w.includes("stagger")),
    "flags <5 min cron stagger",
  );

  console.log("• hydrate refuses can't-fail agents");
  const danger = {
    teamName: "Compliance Trio",
    rationale: "x",
    agents: [
      {
        key: "ad-claim-compliance",
        name: "Ad-Claim Compliance",
        role: "x",
        systemPrompt: "x",
        model: "anthropic/claude-opus-4.8",
        thinkingLevel: "high" as const,
        autonomy: "propose" as const,
        knowledgeScope: { folders: [], tags: [] },
        budgetCapUsd: "1.00",
        cron: null,
        skillKeys: [],
        mcpNames: [],
      },
    ],
    proposedSkills: [],
    proposedMcps: [],
  };
  const dangerOut = hydrate(TENANT, danger, resolver);
  assert(dangerOut.agents.length === 0, "refuses to assemble can't-fail agent");
  assert(
    dangerOut.warnings.some((w) => w.includes("can't-fail")),
    "warns about can't-fail refusal",
  );
  assert(isCantFail("ad-claim-compliance"), "isCantFail helper recognizes the list");
  assert(!isCantFail("ad-ops"), "isCantFail does not falsely flag action agents");

  console.log("• hydrate budget clamp");
  const greedy = {
    teamName: "x",
    rationale: "x",
    agents: [
      {
        key: "greedy",
        name: "Greedy",
        role: "x",
        systemPrompt: "x",
        model: "anthropic/claude-sonnet-4.6",
        thinkingLevel: "medium" as const,
        autonomy: "propose" as const,
        knowledgeScope: { folders: [], tags: [] },
        budgetCapUsd: "5.00",
        cron: null,
        skillKeys: [],
        mcpNames: [],
      },
    ],
    proposedSkills: [],
    proposedMcps: [],
  };
  const greedyOut = hydrate(TENANT, greedy, resolver);
  assert(greedyOut.agents[0]!.budgetCapUsd === "2.00", "clamps budget to $2.00 max");
  assert(
    greedyOut.warnings.some((w) => w.includes("clamped")),
    "warns when budget clamped",
  );

  console.log("• blueprintGaps");
  const gaps = blueprintGaps(proposal, resolver);
  assert(gaps.missingSkills.includes("meta-anomaly-watch"), "identifies missing skill key");
  assert(gaps.missingMcps.includes("MissingMCP"), "identifies missing MCP name");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
