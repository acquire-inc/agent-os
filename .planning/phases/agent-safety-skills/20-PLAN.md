# Phase 20 — Acqu Go-Live Infrastructure (audit + connection fixes)

> Goal (operator): make sure every Acqu agent is connected correctly — right model (OpenRouter),
> right skills, right APIs/MCPs — so nothing breaks at go-live. Audit + fix the real gaps.

## Found + fixed
- **MCP runtime gap (real blocker):** the runner named connectors in the prompt but never passed
  them to the SDK — so agents could NOT call Close/Slack/Gmail/etc. Fixed: `buildMcpServers` maps the
  bundle's HTTP/SSE connectors (+ resolved bearer token) into SDK `options.mcpServers` in both run
  paths; endpoint-less/stdio connectors reported skipped. Unit-tested (runner 25/25).
- **Model-slug drift:** `_schema` allowlist now DERIVED from `MODEL_REGISTRY` (single source) — the
  validator can never disagree with what the fleet routes to.
- **Audit report** `docs/plans/ACQU-GOLIVE-INFRA.md`: per-dimension status + the ordered go-live
  checklist + Wave-1 (connector-only, ready) vs Wave-2 (need custom tools) agent classification.

## Confirmed correct (no change)
- Models: every agent routes to a registry slug via the intelligence layer; validated; can't-fail→Opus.
- Skills: all bound; allowed-tools + guardrails 103/103.
- Connectors: no doctrine connector is unmapped/skipped; role enrichment all seeded.
- Safety: propose ceiling, can't-fail→Opus, budget floors, both gates.

## Operator deploy actions (can't be done in-sandbox)
1. Allowlist `openrouter.ai` → `refresh-model-pricing.ts` → 0 unmatched (verifies slugs route).
2. Real MCP endpoints + OAuth tokens for Wave-1 connectors (`resolveToken` via vault).
3. Gateway env (`ANTHROPIC_BASE_URL`, OpenRouter key); then migrate→seed→verify-golive.

## Next (agent-scope, this session)
- Build Wave-2 custom tools (per-agent) + the `tool_key→runtime` SDK tool-name map so custom tools
  are callable + registry-gated at the SDK boundary.
