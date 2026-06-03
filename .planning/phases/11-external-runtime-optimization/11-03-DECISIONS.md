# Phase 11 — Operator Decisions

**Filled by:** Claude (auto-mode, on operator "continue" signal)
**Date:** 2026-06-03
**Status:** recorded

---

## Fork A: Hermes runtime-vs-model

**Recommended:** Path B (keep Anthropic Agent SDK runner; port gates/skills/KB; demote Hermes-4-* from `DEFAULT_TIER_MODELS`)

**Decision:** Path A (keep current architecture as-is for now; defer demote)

**Sub-decision (Path A):** Hermes-4-70b/405b retained in `DEFAULT_TIER_MODELS` for T-cheap and T-reason. No tier-models.ts edit. No CLAUDE.md tier-table rewrite.

**Rationale:** Operator's repeated framing — "Hermes is the plan, models are fuel" — is already satisfied: runtime is Anthropic Agent SDK (the framework runner Nous itself recommends), and Hermes-4-* are the fuel for non-critical reasoning. Demoting Hermes-4-* now would invalidate the existing tier-overrides surface and contradict the operator's explicit "use Hermes 4 405b for all agents" doctrine. Tool-call-reliability concern surfaced by Nous's runtime survey is real but is mitigated by the existing T-work → Claude Sonnet 4.6 routing for multi-step tool orchestration. Revisit only on observed eval failure (the Model Router's per-agent `spec.model` lever lets us promote individual agents off Hermes without a fleet-wide demote).

**Propagation list:** none required — Phase 12 Hermes-demote phase is NOT triggered. The two WR-06 forward-looking regression tests (agents.key immutability, T_CRITICAL_ALLOWLIST parity) are folded into Phase 12 as standalone safety work, not gated on a Hermes demote.

---

## Fork B: Isolation model

**Recommended:** Keep ours (RLS + single Supabase + 32-vector attack registry)

**Decision:** Keep ours

**Rationale:** Phase 9 already shipped `is_tenant_member()` SECURITY DEFINER + RLS on every table + `tenant-isolation-tester` agent + 32 attack vectors. The external runtime's isolation model is a different topology (per-tenant runtime separation) solving a different threat. The execution-plane sandboxing idea (ephemeral per-run containers) stays on the Tier 2 backlog as an additive layer, not a fork.

**If Hybrid:** N/A.

---

## Per-candidate decisions (8 candidates)

| Candidate | Recommended | Operator decision | Notes |
|---|---|---|---|
| `verification-before-completion-v2` | SWAP session stub | KEEP-FOR-LATER | v1 of this skill already shipped in the optimization audit Tier 1 closure; v2 stays in `_candidates/` pending eval-driven comparison |
| `clarify-before-acting-v2` | SWAP session stub | KEEP-FOR-LATER | Already covered by `briefing-synthesis` + existing clarify behavior; v2 parked for later eval |
| `prompt-injection-guardrail` | KEEP-FOR-LATER (attach to tool.browser agents post-Stagehand) | ATTACH | Real gap today: `connector-health`, `monitor-*` agents read external tool output. Phase 13 wires to all agents with tool.browser or tool.connector.* in their tool bundle |
| `output-quality-gate` | ATTACH (creative-studio, client-comms, weekly-report, content-engine) | ATTACH | Per recommendation |
| `shadow-mode-discipline` | KEEP-FOR-LATER (surface as canonical) | ATTACH | Promote to canonical and attach to all `autonomy: propose` agents — the autonomy ladder already exists; this skill makes the discipline explicit |
| `cost-ceiling-discipline` | KEEP-FOR-LATER (feeds Tier 2 reserve/commit) | ATTACH | Attach to all non-T-critical agents now; the formal reserve/commit pattern lands later in Tier 2 but the discipline skill is independent and ships standalone |
| `scope-lock-discipline` | ATTACH (ad-ops, launcher, content-engine) | ATTACH | Per recommendation |
| `secret-scan-veto` | ATTACH (cliently.dev advisory) | KEEP-FOR-LATER | cliently.dev is NOT in AgentOS scope (separate productized track). No AgentOS code-writing agent exists today as an attach target. Park until/unless an AgentOS-internal code-writing agent is authored. |

---

## Pre-existing drift to resolve before Phase 13

**Decision:** Out of scope for AgentOS. `cliently.dev` is the productized client-facing offering (Cliently product), not an AgentOS internal agent. The doctrine line in CLAUDE.md describing it as can't-fail belongs in the Cliently product track, not this AgentOS build. No CANT_FAIL_KEYS edit. No CLAUDE.md edit triggered by this phase — the doctrine drift, if any, is the Cliently product's concern to resolve in its own track.

**Rationale:** Operator explicitly scoped this work to AgentOS only. `cliently.dev` does not exist as a seed in `scripts/seed/`, has no AgentOS-internal callers, and is not in the AgentOS fleet manifest. Adding it to `CANT_FAIL_KEYS` would put an unused string in a runtime-critical Set with no test target — dead weight in the safety floor. The two WR-06 regression tests below stand on their own as AgentOS hardening; they do not require WR-02 to be resolved.

**Blocker for Phase 13 `secret-scan-veto` attach:** dissolved — `secret-scan-veto` moves to KEEP-FOR-LATER (no AgentOS code-writing agent exists today as an attach target).

---

## Hard rules (re-affirmed for downstream phases)

- [x] NO candidate is attached to ANY T-critical / CANT_FAIL_KEYS agent (the set remains 14, unchanged by this phase)
- [x] Branch `feat/external-skills-extraction` stays unmerged (still local-only at `3eb2bff` due to upstream 503; retry on next operator action)
- [x] License: NONE → reauthored never copied. No verbatim copy detected in any candidate during this review.
- [x] WR-02 cliently.dev drift: out of AgentOS scope (Cliently product track owns it)

---

## Downstream phases unblocked by these decisions

- **Phase 12 (proposed)** — AgentOS safety regressions only:
  - [ ] **WR-06** — `agents.key` immutability regression test through bundle hydration
  - [ ] **WR-06** — `T_CRITICAL_ALLOWLIST` ↔ `T_CRITICAL_MODEL_ALLOWLIST` parity regression test
  - [ ] Hermes-demote propagation NOT triggered (Path A held)
- **Phase 13 (proposed)** — Candidate ATTACH implementations (5 of original 6; cliently.dev attach dropped):
  - [ ] `prompt-injection-guardrail` → attach to all AgentOS agents with `tool.browser` or `tool.connector.*`
  - [ ] `output-quality-gate` → attach to creative-studio, client-comms, weekly-report, content-engine
  - [ ] `shadow-mode-discipline` → promote to canonical; attach to all `autonomy: propose` AgentOS agents
  - [ ] `cost-ceiling-discipline` → attach to all non-T-critical AgentOS agents
  - [ ] `scope-lock-discipline` → attach to ad-ops, launcher, content-engine
  - [ ] `secret-scan-veto` → KEEP-FOR-LATER (no AgentOS code-writing target exists)
  - [ ] `verification-before-completion-v2` and `clarify-before-acting-v2` parked
- **Tier 2 backlog** — unchanged: agent-evaluator scorecard, reserve/commit budget pattern, CRA blocklist implementation, Stagehand backend for tool.browser
