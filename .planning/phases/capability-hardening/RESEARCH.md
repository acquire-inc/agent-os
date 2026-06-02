# Capability-Hardening — Research / Audit findings

> Status: research complete (2026-06-02). Source-of-truth for the capability gaps that must close
> before go-live. Goal of the phase: every agent has the **skills, connectors, and tools** it needs,
> with **truthful, safe registry metadata** — all DATA/config (agents are data), no new per-agent code.

## Method

Three parallel audits (skills / MCPs / tools) + ground-truth verification of every claim against the
seeders, fixtures, and doctrine. Two seed paths exist and were kept separate:
- `db:seed` (`packages/db/src/seed.ts`) — 23-MCP **demo fixtures** for tests. NOT the fleet.
- `pnpm --filter @agent-os/seed all` (`scripts/seed/`) — the real **93-agent doctrine fleet**.
All findings below are about the **fleet** unless noted.

## Verdict

The capability **machinery is sound end-to-end** (skill→allowed-tools→bundle; MCP_MAP→agent_mcps;
tool extraction→catalog→agent_tools→PreToolUse gate). The **data population is incomplete**, and one
gap is safety-relevant. Nothing here needs new application code except optional real tool impls (T3,
deferred).

## Findings (ground-truthed)

### TOOLS — `scripts/seed/_tools.ts`, `seed-tools.ts`
~63 tools seeded; **24 have real metadata** (`KNOWN_TOOLS`), **~39 are stubs** via `toolMeta()`
(humanized name + generic description + heuristic flags). Named refs ARE extracted+bound
(`SINGLE_RE` matches `tool.<word>`), so agents bind to stubs.

- **T1 (SAFETY, highest):** stub `requiresApproval`/`reversible` come from `ACTION_TOOLS`
  (`_tools.ts:52`), which lists only `payment-bridge, bill-pay-bridge, contract-engine,
  billing-engine` (+4 workforce). Every other side-effecting/irreversible tool defaults to
  **safe + reversible** — e.g. `dunning-engine`, `deploy-bridge`, `arcads-launcher`,
  `commission-ledger`, `revenue-ledger`, `ar-ledger`, `referral-attribution`, `loyalty-milestones`,
  `code-review-bot`, `partner-asset-gen`. Registry `requires_approval` is authoritative over the
  verb heuristic (`apps/runner/src/hooks.ts`), so a mis-flagged stub can **downgrade** the gate for
  any agent above `propose`. (Can't-fail agents are still capped at `propose`, so blast radius =
  non-can't-fail agents on execute_safe/execute_full.)
- **T2 (CLARITY):** stub descriptions are generic ("Deterministic tool: X") → the system prompt's
  "Deterministic tools" section gives agents no real capability guidance.
- **T3 (RUNTIME, code, LARGE — deferred):** no `tool_key → runtime SDK tool-name` map and no real
  implementations. Approval gating falls back to the verb heuristic for unimplemented/MCP tools.
  This is the per-agent build done AT each agent's go-live against real services — not a blanket
  pre-go-live task. Tracked, not done here.

### SKILLS — `external/acqu-skills/*/SKILL.md` (103 files)
Binding rules (verified, `_generic.ts:178–196`): universal `verification-before-completion` (all),
conditional `clarify-before-acting` (autonomy ∈ {propose, execute_safe}), one doctrine-authored
primary, plus explicit `extraSkills`. `allowed-tools` flows SKILL.md → `allowedToolsJson` →
`bundle.skills[].allowedTools` (`bundle.ts:149`).

- **S1 (LEAST-PRIVILEGE):** only **2 / 103** skills declare `allowed-tools` (`morning-vitals`,
  `workforce-planning`). The other 101 → empty list → least-privilege coded but unenforced.
- **S2 (ORPHANS):** 5 skills never bound — `proposal-drafting`, `workforce-planning` (higher
  impact: the latter even declared allowed-tools), `content-engine`, `meeting-prep`,
  `playbook-capture`. Either bind to an owning agent or remove.

### MCPs — `scripts/seed/_generic.ts` (`MCP_MAP`), fixtures catalog
`MCP_MAP` is comprehensive (24 keys → seeded names); all mapped connectors are seeded.

- **M1 (UNDER-CONNECTION):** doctrine prompts declare only `slack` (80×), `close` (37×),
  `gdrive` (31×) (+ a stray `pipeboard-meta`). So agents are under-connected vs. their function —
  `dunning-manager`→no Stripe, `expense-tracker`→no QuickBooks, dev/infra agents→no
  GitHub/Sentry/Linear/Vercel, EA→partial Calendar. Connectors are seeded+mapped; **bindings are
  the gap.** Even hand-tuned `acqu-*.ts` scripts are sparse (verified).
- **M2 (STATUS, not a bug):** many connectors `disconnected`/`needs_reauth` — expected pre-OAuth;
  a go-live credential step (vault/Nango), not a seeding defect.

## Scope decision (the one real fork)

- **In-scope now (DATA, testable without a live DB):** T1, T2, S1, S2, M1. Make the registry
  truthful + safe, operationalize least-privilege, connect agents to the right connectors.
- **Deferred (CODE, per-agent at go-live):** T3 real tool implementations + runtime tool-name map.
  Building ~39 integrations now, untested against real services, would be low-quality churn and
  violates "start at the cheapest safe tier / prove one thing at a time."
