# Acqu Agents — Go-Live Infrastructure Audit

> Are the Acqu (internal) agents connected correctly to go live: right **models** (routable via
> OpenRouter), right **skills**, right **APIs/MCPs**? Audit of what shipped + the concrete actions
> before flipping live. Agents-session scope. Companion gate: `readiness.test` + `verify-golive`.

## TL;DR — connection status by dimension

| Dimension | Data correct? | Callable at runtime? | Action before go-live |
|---|---|---|---|
| **Models (OpenRouter)** | ✅ derived registry, validated | ⚠ slugs unverified vs live catalog | Allowlist `openrouter.ai` → run refresh → confirm **0 unmatched** |
| **Skills** | ✅ all bound, allowed-tools + guardrails 103/103 | ✅ injected into prompt | none |
| **MCPs / connectors** | ✅ all mapped + seeded | ✅ **now wired into the SDK** (was prompt-only) | real endpoints + **OAuth tokens** per connector |
| **Tools (deterministic)** | ✅ truthful metadata (98) | ⚠ custom tools have **no runtime impl** (T3) | build per-agent, or go live connector-only first |
| **Safety** | ✅ propose ceiling, can't-fail→Opus, budget floors | ✅ hook-enforced | none |

## 1. Models — routing via OpenRouter

- Each agent routes to a model **decided by the intelligence layer** (`modelForAgent` →
  `selectBestModel`): T-cheap→`nousresearch/hermes-4-70b`, T-reason→`hermes-4-405b`,
  T-work→`anthropic/claude-sonnet-4.6`, can't-fail→`anthropic/claude-opus-4.8`.
- The `_schema` allowlist is now **derived from `MODEL_REGISTRY`** — the validator can't drift from
  what the fleet routes to. `validateAgent` rejects unknown slugs AND can't-fail-on-Hermes.
- **⚠ The one model go-live gate:** the exact slugs must exist in the live OpenRouter catalogue.
  Unverifiable here (`openrouter.ai` is blocked by the env network policy — HTTP 403).
  **ACTION:** add `openrouter.ai` to the environment allowlist → `pnpm --filter @agent-os/seed exec
  tsx refresh-model-pricing.ts` → **`unmatched` must be empty.** Any unmatched slug = a model
  OpenRouter won't route = that agent can't run. (Refresh doubles as slug verification.)
- **Gateway env at deploy:** `ANTHROPIC_BASE_URL=https://openrouter.ai/api` + the OpenRouter API key.

## 2. Skills — ✅ ready

Every agent loads `verification-before-completion` (+ `clarify-before-acting` if it acts) + its
primary skill + extras. **103/103** skills carry `allowed-tools` (least-privilege) and a
`## Guardrails` section. `readiness.test` proves every referenced skill resolves to a file. No action.

## 3. MCPs / connectors / APIs — data ✅, runtime FIXED, OAuth pending

- **Mapping is complete:** the doctrine references only `close / gdrive / pipeboard-meta / slack`
  (all mapped); role enrichment adds Stripe, QuickBooks, GitHub, Sentry, Calendar, Gmail, n8n, etc.
  — every one is in `MCP_MAP` and seeded. **No connector is silently skipped.**
- **Runtime wiring (fixed this session):** the runner now passes bound connectors into the Claude
  Agent SDK as `mcpServers` (HTTP/SSE + resolved bearer token) — previously they were only *named in
  the prompt*, so agents could **not** call them. `buildMcpServers` (unit-tested) does the mapping;
  endpoint-less + stdio connectors are reported as skipped.
- **⚠ Two deploy actions for real connector access:**
  1. **Endpoints:** each connector row needs a real MCP server `endpoint` (most fixtures are `null`).
  2. **OAuth tokens:** the bundle must resolve a short-TTL token per connector (`resolveToken` via the
     vault). Connection status seeds `disconnected`/`needs_reauth` until each account is connected.
  Until both are set for a connector, `buildMcpServers` wires it without auth (or skips it) and the
  agent can't use it.
- stdio connectors (pgvector Knowledge, Playwright) need local command config, not carried in the
  bundle — wired separately at the runner host.

## 4. Tools (deterministic) — metadata ✅, implementations are the real per-agent gate

- The catalog (98 entries) has **truthful metadata + correct safety flags**. But custom `tool.*`
  entries are **registry metadata, not runtime implementations** (T3, tracked). At go-live an agent's
  **executable capability = its MCP connectors + SDK built-ins** (files/browser); a custom tool it
  references is described in the prompt but **not callable** until built.
- **The `tool_key → runtime SDK tool-name` map is now in place** (`runtimeToolName` /
  `buildToolApproval` / `buildAllowedTools`): the gate consults the registry's `requires_approval`
  for custom tools by both name forms, the agent is restricted to its bound tools + MCP servers
  (`allowedTools`), and the verb heuristic is now **MCP-aware** — `mcp__close__list_leads` parses to
  `list` (reversible, auto-allow) instead of the old `mcp` (which would have proposed on EVERY read,
  an approval storm for Wave-1 connector agents). Custom tools, once implemented, register under
  `runtimeToolName(key)` and are gated automatically.

### Go-live waves (Acqu internal fleet)

- **Wave 1 — works end-to-end on connectors + SDK now** (need only §3 done): `vitals` (metrics→Slack),
  `briefing` (compile→Slack), `connector-health-monitor`, `ea` (Gmail/Calendar/Slack), `expense-tracker`
  / `margin-monitor` (read→Slack), `ad-ops` (Pipeboard read → *propose* changes). These read via
  connectors and post/propose — no custom tool required to be useful.
- **Wave 2 — needs a custom tool built first:** `dunning-manager` / `billing-runner`
  (billing/dunning engines), `contract-drafter` / `contract-lifecycle-manager` (contract-engine),
  `launcher` (ad launch), `cliently.dev` (deploy-bridge), the financial-ledger agents.

## 5. The ordered go-live checklist

1. `openrouter.ai` allowlisted → `refresh-model-pricing.ts` → **0 unmatched** (models routable). 
2. Gateway env set (`ANTHROPIC_BASE_URL`, OpenRouter key).
3. Real MCP endpoints + OAuth-connect the Wave-1 connectors (Slack, Pipeboard×Meta, Gmail, Calendar,
   Close, Google Drive); `resolveToken` wired so the bundle carries live tokens.
4. `DATABASE_URL` → `migrate` → `seed all` → `verify-golive.ts` (all checks green).
5. Launch **Wave 1** at `autonomy=propose` (everything hits the Approvals inbox); watch the Relay/
   run-summaries; promote on eval evidence.
6. Build Wave-2 custom tools (one per agent at its cutover); add the `tool_key→runtime` map.

## Verified this audit
Model slug ↔ validator consistency (allowlist derived from registry); connector→SDK wiring
(`buildMcpServers`, runner 25/25); no unmapped connectors; skills/evals/guardrails gates green.
