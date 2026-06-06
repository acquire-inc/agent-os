# Phase 21 — tool_key→runtime gating + MCP approval-storm fix

> Closes the registry→runtime tool gating gap (P1 #7) and fixes a latent go-live bug found while
> auditing the MCP wiring.

## Found + fixed
- **MCP approval-storm (latent go-live bug):** `parseToolVerb("mcp__close__list_leads")` extracted
  `"mcp"` (not a read verb) → EVERY MCP call, even reads, gated to "propose". Wave-1 connector agents
  (vitals/ad-ops/briefing reading via connectors) would have hit the Approvals inbox on every read —
  unusable. Fixed: `parseToolVerb` now takes the final `__`/`.`-delimited segment as the action, so
  `mcp__close__list_leads → list` (reversible, auto-allow) and `mcp__close__create_lead → create`
  (gated). 12 pure tests.
- **Registry-authoritative gating for custom tools:** `runtimeToolName(key)` (SDK-safe sanitized
  name) + `buildToolApproval` keys requires_approval by BOTH the tool_key and the runtime name, so
  the gate enforces the registry for custom tools (not just the verb heuristic). Custom tools, once
  built, register under `runtimeToolName(key)` and are gated automatically.
- **Least-privilege:** `buildAllowedTools` restricts the agent to its bound custom tools + bound MCP
  servers (`mcp__{server}`) — it can't reach a tool/connector it isn't bound to. Wired into both run
  paths' `options.allowedTools`.

## Verify
core/autonomy 12, runner 31 (incl. the new helpers); full agent-scope sweep green; typecheck clean.

## Note (deploy)
`allowedTools` MCP-server allowance (`mcp__{server}`) follows the documented SDK convention; confirm
against the deployed SDK version — if it needs exact tool names, loosen to the server prefix only.
