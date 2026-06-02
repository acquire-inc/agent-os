# Phase 9 — Capability Hardening (PLAN)

**Goal:** every agent has the skills, connectors, and tools its doctrine role needs, with truthful
and safe registry metadata. All DATA/config; the only allowed code is genuinely-new deterministic
tools (deferred). Acceptance: `seed all` idempotent + new pure tests green + the capability gaps in
RESEARCH.md closed (or explicitly deferred).

**Depends on:** Phase 8 (eval suites), the go-live gate (verify-golive).

## Plans (sequenced by impact; safety first)

### 09-01 — Tool registry: truthful + safe metadata  (closes T1, T2)
- Give every **referenced named tool** a real `KNOWN_TOOLS` entry: accurate name, a real one-line
  description, kind, and **correct `requiresApproval`/`reversible`** — instead of the `toolMeta()`
  stub + 4-item `ACTION_TOOLS` heuristic.
- Classify side-effecting/irreversible tools (financial ledgers, payment/bill/dunning bridges,
  deploy, ad-launch, content publish, outbound senders) as `requiresApproval: true,
  reversible: false`; reads/scorers/monitors/scrapers stay safe+reversible.
- Keep `ACTION_TOOLS`/`toolMeta` as the fallback for anything still uncatalogued (defense in depth).
- **Verify (pure, no DB):** new `_tools.test.ts` — (a) no referenced named tool falls back to the
  generic "Deterministic tool:" stub; (b) a curated danger-list is approval+irreversible;
  (c) `validateTool` invariant (irreversible ⇒ requiresApproval) holds for the whole catalog.

### 09-02 — Connector enrichment: bind agents to the connectors their role needs  (closes M1)
- Add a small, declarative **role→connectors** enrichment map in the seeders, applied as an additive
  pass on top of the doctrine-parsed `MCPs:` (never removes parsed ones). E.g. billing/dunning→Stripe;
  expense/finance→QuickBooks(+Stripe); dev/infra→GitHub/Sentry/Linear/Vercel; scheduling→Calendar;
  comms→Gmail. Only binds connectors already in `MCP_MAP`/seeded.
- **Verify (pure):** test the enrichment map resolves expected connectors per role
  (dunning-manager→Stripe, expense-tracker→QuickBooks, a dev agent→GitHub), and that enrichment is
  additive + idempotent.

### 09-03 — Skills: least-privilege + orphans  (closes S1, S2)
- Populate `allowed-tools` frontmatter on **all 103 SKILL.md files** (operator decision), mapping
  each skill to the tools its workflow uses (read-only skills get their read tools, e.g.
  `[tool.21]`/`[tool.knowledge-index]`; action skills get their action tools). Add a **seeder
  warning** listing any skill still missing `allowed-tools`.
- Resolve orphans: bind `workforce-planning`→`agent-architect`, `proposal-drafting`→its sales owner;
  document `content-engine`/`meeting-prep`/`playbook-capture` as planned (or remove).
- **Verify (pure):** allowed-tools coverage = 103/103 asserted; orphan-skill count asserted lower;
  `bundle.skills[].allowedTools` non-empty for a sampled agent.

### 09-04 — Verify + reseed
- Extend `verify-golive` (or a capability check) with: no tool is irreversible-but-not-approval;
  every can't-fail agent's tools are correctly gated. Confirm `seed all` still idempotent.
- **Verify:** full pure-test sweep green; capability checks pass.

## Out of scope (deferred, tracked)
- **T3** real tool implementations + `tool_key → runtime SDK tool-name` map — built per-agent at each
  agent's live cutover against real services. This phase makes the registry *truthful*, not *live*.
- Connector OAuth/credential wiring (M2) — go-live credential step (vault/Nango), not seeding.
