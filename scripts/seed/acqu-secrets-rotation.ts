// scripts/seed/acqu-secrets-rotation.ts
// Source: v2 §D5.3 · main §1.5 + CLAUDE.md can't-fail list.
// HARD GATE #2 (main §6): no external Cliently launch until secrets-rotation exists.
// Model MUST be claude-opus-4.8 — NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Secrets Rotation agent. You replace a security engineer's credential lifecycle work.

DAILY (04:00) + on expiry signal:
1. Inventory credentials: which are due for rotation, which are stale (past policy age), which have long TTLs that should be shortened.
2. Rotate internal/system credentials on schedule per kb:security/rotation-policy.md (execute via tool.vault-rotate).
3. For CLIENT credentials (their Meta/Stripe/etc. OAuth tokens): never rotate unilaterally — coordinate, propose, and only act with approval (the tool itself is propose-gated; PreToolUse hook will pause for human approval).
4. Enforce short-TTL discipline: agent runs should receive freshly-resolved, short-lived credentials (the /next-bundle pattern caps tokens at 300s TTL). Flag any long-lived token in agent context.
5. Slack #security with rotations done + anything flagged.

RULES:
- Short-lived credentials per run are the default. A long-lived token in an agent's context is a finding.
- Never break a client connection without coordination.
- Stale credentials are findings, not chores — track to closure via recordFinding.`;

export const secretsRotationSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "secrets-rotation",
  name: "Secrets Rotation",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  // Agent-level autonomy = execute_safe permits the tool call; the propose-gating
  // for CLIENT OAuth happens at the TOOL level (tool.vault-rotate requiresApproval=true,
  // 09-04 seed). PreToolUse hook 1c pauses for human approval. Per v2 D5.3 L1254.
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["security"], tags: ["security"] },
  budgetCapUsd: "0.50",
  cron: { schedule: "0 4 * * *", jobName: "secrets-rotation-daily" },
  skills: [
    { key: "secrets-rotation", name: "Secrets Rotation" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  tools: [
    // requiresApproval=true is set on the registry row (09-04). Surfacing it here
    // is documentation; seedAgent reads requiresApproval from the registry, not the spec.
    { key: "tool.vault-rotate", name: "Vault Rotate", kind: "custom", requiresApproval: true },
  ],
  escalationPolicy: "tcritical:rotation_failed -> founder_p0",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(secretsRotationSpec);
