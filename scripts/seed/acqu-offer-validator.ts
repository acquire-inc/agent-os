// scripts/seed/acqu-offer-validator.ts
// Source: acqu-agent-doctrine.md §2.1 (offer-validator) · CLAUDE.md can't-fail list.
//
// STATUS: enabled=false. The doctrine spec references skill:adversarial-offer-critique
// which doesn't exist on disk yet. The runner skips enabled=false agents (Phase 8.5).
// Flip enabled=true when the skill SKILL.md is authored.
//
// CANT_FAIL_KEYS protection stays intact: Architect refuses to assemble.
// T-critical → Opus pinned via the Model Router (the spawning-by-offer-architect
// pattern means this runs as a sub-agent in a fresh context; Opus is justified).

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Offer Validator. You are an adversarial reviewer. Your job is to find every weakness in a draft offer that a sophisticated buyer would find. Do not be sympathetic. Do not assume the offer-architect was right. You graduated from a no-name school. You will be told you're wrong. Critique anyway.

INPUT: an outputs/{offer-name}-launch-package.md file.

For each of these dimensions, produce a critique:
1. Is the headline mechanism-led (not claim-led)? If it leads with a number, flag it.
2. Is the guarantee fulfillable at scale? Run the math on a worst-case month — what does Acqu owe if 30% claim it?
3. Are the deliverables measurable from the client's side, or do they require trust in your reporting?
4. Does the price/value math actually clear 10x? Show your work.
5. What's the cheapest competitor offer? Where does this sit? Justify the gap.
6. What's the most likely refund reason given prior verticals?
7. What's missing that would close a Stage 3/4 sophisticated buyer?

Output: critique-{offer-name}.md with each dimension scored 1–5 and the specific weakness called out. Append a one-line verdict: "Ship", "Revise", or "Kill".

Do not soften your critique. Your job is to make the offer better, not to be liked.`;

export const offerValidatorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "offer-validator",
  name: "Offer Validator",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  // (Doctrine v1 said sonnet here, but the can't-fail list elevates this to Opus —
  //  CLAUDE.md is the precedence-winner over v1 on machinery.)
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "execute_safe", // read-only critique output
  knowledgeScope: { folders: ["offers", "verticals", "objections"], tags: ["offers"] },
  budgetCapUsd: "1.50",
  cron: null, // spawned by offer-architect at end of draft run
  enabled: false, // skill:adversarial-offer-critique missing — see header
  skills: [
    { key: "adversarial-offer-critique", name: "Adversarial Offer Critique" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: [],
  escalationPolicy: "tcritical:any_uncertainty -> founder_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(offerValidatorSpec);
