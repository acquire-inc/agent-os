// scripts/seed/acqu-offer-architect.ts
// Source: acqu-agent-doctrine.md §2.1 (offer-architect) · CLAUDE.md can't-fail list.
// Per CLAUDE.md non-negotiable #1: agents are DATA — this is a registry row, not new code.
//
// STATUS: enabled=false. The doctrine spec references 4 skill keys that don't
// exist on disk yet (hormozi-offer-construction, guarantee-design,
// cole-gordon-mechanism, adversarial-offer-critique). Without bodies, the
// agent would run with degraded reasoning. The runner skips enabled=false
// agents (Phase 8.5 lifecycle). When the 4 skill SKILL.md files are authored,
// flip enabled=true to bring the agent live.
//
// CANT_FAIL_KEYS protection stays intact: the Architect (packages/core/src/
// architect/hydrate.ts) refuses to assemble any agent on this list, so
// nobody can accidentally synthesize a weaker version via blueprint
// proposal. T-critical → Opus pinned via the Model Router.

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Offer Architect for Acqu. You replace what used to be a senior offer strategist.
Your one job: turn a gap-brief into a complete, testable offer spec.

INPUT: a gap-brief filename from kb:offers/proposals/.

OUTPUT: a draft offer record (filled into a kb:offers/registry document as status=draft) and an outputs/{offer-name}-launch-package.md that contains:
  1. Offer name + one-line positioning
  2. Hook headline (Cole Gordon mechanism format — "most people make mistake X → consequence → our way → benefit")
  3. Body (problem → mechanism → deliverable → proof → guarantee → CTA)
  4. Deliverables (specific, dated, measurable)
  5. Guarantee (designed using skill:guarantee-design — strong enough to remove risk, narrow enough to fulfill)
  6. Price (with the Hormozi value-stack reasoning shown — value of deliverables ÷ price = >10x rule)
  7. Terms (cancellation, refund, expansion)
  8. The three biggest objections and the rebuttal for each
  9. The first three ad concepts to test (hook + format + image direction)

Use skill:hormozi-offer-construction to structure value. Use skill:cole-gordon-mechanism for the hook. Use skill:guarantee-design for the guarantee.

Verification: the draft is reviewed adversarially by offer-validator before being shown to the founder. Do not skip this step.`;

export const offerArchitectSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "offer-architect",
  name: "Offer Architect",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "propose",
  knowledgeScope: { folders: ["offers", "copywriting", "verticals"], tags: ["offers"] },
  budgetCapUsd: "5.00",
  cron: null, // on-demand only (founder approves a gap-brief)
  // ENABLED 2026-06-02: all 4 named skill bodies now exist on disk:
  //   external/acqu-skills/hormozi-offer-construction/SKILL.md
  //   external/acqu-skills/guarantee-design/SKILL.md
  //   external/acqu-skills/cole-gordon-mechanism/SKILL.md
  //   external/acqu-skills/verification-before-completion/SKILL.md
  // CANT_FAIL_KEYS protection still in place: Architect refuses to assemble
  // synthesis attempts via blueprint. Model Router pins T-critical → Opus.
  // Runner SessionStart cantfail.model_violation fails closed on drift.
  enabled: true,
  skills: [
    { key: "hormozi-offer-construction", name: "Hormozi Offer Construction" },
    { key: "guarantee-design", name: "Guarantee Design" },
    { key: "cole-gordon-mechanism", name: "Cole-Gordon Mechanism" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Google Drive", "Slack"],
  escalationPolicy: "tcritical:any_uncertainty -> founder_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(offerArchitectSpec);
