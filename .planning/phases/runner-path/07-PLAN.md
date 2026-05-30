# Phase 7 — Runner execution path (PLAN)

## Reframe (from recon, 2026-05-30)

The Runner is **already built and wired**: `apps/runner` (pull-based executor, liveRun via
`@anthropic-ai/claude-agent-sdk` + dryRun), `apps/api` (Hono: next/status/activity/approvals/
audit/autonomy), `apps/scheduler` (advisory-lock cron → materializes runs), `packages/core`
(`buildBundle`, `autonomyGate`, approval bridge, audit). Safety hooks 1a/1b/1c exist
(PreToolUse gate, PostToolUse audit, server-side budget on status).

So Phase 7 is **not** "build the Runner." It's GSD's verification phase — *code that runs isn't
code that works* — plus closing the one real integration gap created by Phase 6.

## Gaps found (verified against source, not just recon)

1. **Tool registry is not wired into execution.** `buildBundle` (packages/core/src/bundle.ts)
   resolves `agent_skills` + `agent_mcps` but **not `agent_tools`**. The bundle has no `tools`
   field; `buildSystemPrompt` (apps/runner/src/execute.ts) never lists tools. Phase 6's catalog
   + bindings are inert at runtime.
2. **Gate is heuristic, not registry-driven.** `autonomyGate` (packages/core/src/autonomy.ts)
   decides approval from a read-only-verb heuristic on the runtime tool name + escalation
   `always_allow`. It does **not** consult `tools.requires_approval` (build-spec §5 says it
   should). Note: the gate sees *runtime SDK tool names* (`slack_send_message`) while the
   registry keys are *abstract doctrine keys* (`tool.2`) — no map exists yet, which is *why*
   the heuristic exists. Full registry-driven gating needs that map (future).

## Success criteria (what must be TRUE)

1. `buildBundle` resolves `agent_tools` → a `tools` field on the Bundle (key, name, kind,
   requiresApproval, reversible). The runner's Bundle type carries it too.
2. The agent's bound tools appear in the system prompt (the model is told its deterministic
   tools, flagged when approval-gated).
3. `autonomyGate` accepts an optional registry `requiresApproval` that overrides the heuristic
   when known (spec-aligned, forward-compatible) — with a unit test. Operator `always_allow`
   still wins. No behavior change for today's MCP tools (no key match → heuristic).
4. **Vitals runs end-to-end** through the existing pipeline in a verification test: a queued run
   → `buildBundle` (tools present) → `executeRun` (dryRun) → run reaches a terminal/awaiting
   state with activity + summary recorded; the bound tools reach the system prompt.
5. Typecheck clean across the workspace; new tests green; no regression in existing gate tests.

## Plans

- **07-01**: Wire `agent_tools` into the bundle + system prompt; make `autonomyGate`
  registry-ready (optional `requiresApproval`) + unit test. (core/bundle.ts, core/autonomy.ts,
  runner/api-client.ts, runner/execute.ts, runner/hooks.ts)
- **07-02**: End-to-end verification test (packages/core or apps/runner): vitals → buildBundle →
  executeRun(dryRun) with a stub ApiClient; assert tools in bundle + prompt, activity + terminal
  status recorded. Document residual gaps (key→runtime-name map; structured `run_summaries`).

## Out of scope (→ roadmap)

- A `tool_key → runtime SDK tool name` map (needed for true registry-driven gating + SDK
  `allowedTools` restriction). Setting `allowedTools` from doctrine keys today would *break* real
  MCP calls — deferred until custom tools are implemented (build-spec Session 4).
- Structured `run_summaries` table / SessionEnd hook (currently a `summary` text field on `runs`).
