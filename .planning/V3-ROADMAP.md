# AgentOS V3 — Learning-Fleet Roadmap

> Produced 2026-07-21 from a 3-agent concept-extraction workflow over an
> external agentic-templates survey (upstream license=NONE — every mechanism
> RE-AUTHORED, zero code copied; raw extraction in
> `.planning/phases/71-v3-concepts/CONCEPTS-RAW.json`).
>
> North star: V2 made the fleet self-improving from its own runs. V3 makes it
> learn from the OPERATOR — every human decision becomes training signal —
> while hardening the outbound direction (sends, secrets, grounding).

## Shipped (V3 E-track)

| # | What | Where | Status |
|---|---|---|---|
| E1 | **Exemplar learning loop** — approve/edit/reject → exemplars; recurring corrections → standing principles; bounded block injected via bundle priorLearnings | `core/exemplar.ts` (32 tests) + mig 0033 (operator edit capture) + decide endpoint `editedText` + Approvals UI "Edit before approving" | ✅ 2026-07-21 |
| E2 | **Judge calibration** — critic-quorum verdicts diffed vs human decisions; asymmetric drift (false-approvals trip at 5%, agreement floor 80%); measures, never adjusts | `core/judge-calibration.ts` (16 tests) + `critic.calibration_drift` event | ✅ 2026-07-21 |
| E3 | **Secret-egress guard** — outbound mirror of the injection guard; env-value + prefix scan at tool dispatch, fail-closed, finding names the var never the value | `core/security/egress-guard.ts` (16 tests) + dispatchCustomTool wire | ✅ 2026-07-21 |

## Next up (priority order; buildable-now unless marked DB/live-gated)

| # | Concept | Size | Why it's next |
|---|---|---|---|
| E4 | **One-pass self-critique before proposal** — draft compared to exemplars+principles by a cheap model pass; at most one revision; fails SAFE to original | M | Directly raises first-pass approval rate — the metric the autonomy ladder promotes on. `core/self-critique.ts` + runner propose-path wire. |
| E5 | **Send-guard + sents ledger** — per-run + per-recipient rolling caps, idempotency keys, shadow-mode ramp, fail-closed ledger reads (mig 0034 `sent_log`) | M | THE top operational risk before outreach agents go live. The upstream's documented bug class: a cap that reads a log nothing writes is a dead defense. |
| E6 | **Fact-grounding corrector for outbound drafts** — find/replace corrections against a declared CONTEXT block; ambiguous → fail CLOSED to needs_review | M | Inbound scrub exists; outbound hallucination defense doesn't. Drafter T-cheap, reviewer T-work. |
| E7 | **Streaming budget kill-switch** — per-message cost accumulation from SDK usage blocks (incl. cache read/write pricing); break mid-loop on cap | S | Today cost lands only at run end; a runaway loop spends the full budget before the cap fires. |
| E8 | **Fleet shadow-mode master switch + trust-ramp order** — new deploys draft-only until operator lifts, in a fixed ramp order | S | Complements per-agent `propose`; gives the operator one global lever at launch. |
| E9 | **Intent lock** — sealed scope contract at run start; typed drift detection before completion claims | M | Maps onto objectives; catches "did something else entirely" failures the verifier can't. |
| E10 | **Fingerprint-keyed idempotency for mutating tools** — check-before-create on payload hash | M | Duplicate-effect protection for every connector write, beyond the lease layer. |
| E11 | **Per-agent runaway-spend breaker** (share-of-budget, not just total) | S | One agent eating 80% of tenant budget should trip before the monthly cap. |
| E12 | **Post-provision fleet verifier** — evidence-typed checks, ship/hold/rebuild verdict | M | Closes the Architect→seed loop with verification. |
| E13 | **Eval-gated self-improvement apply** — frozen baseline case set; prompt candidates must beat baseline before apply | L (live-gated) | The full anti-regression ratchet on E1/P4 output. Needs case-set store + judge runs. |
| E14 | **Different-family judge + write-protected rubric** | M (live-gated) | Judge/executor family separation for the eval loop. |
| E15 | **Completion-evidence gate with adversarial audit** | L (live-gated) | Fresh-context audit of completion claims before terminal status. |
| E16 | Tenant doctrine layer (SOUL-style identity per tenant injected into every run) | S | Complement to knowledge scope; tenant voice in one place. |
| E17 | Transient/hard-stop error taxonomy + narrow retry in runner | S | Fewer failed runs from provider blips. |
| E18 | Structured lesson write-back on objective close | S | Extends P3 → knowledge base. |
| E19 | Full per-message run transcript table | S (DB-gated) | Deep debugging + the E13 case-set source. |
| E20 | Fail-closed triage front door for inbound-triggered runs | S | Needed when webhook triggers land. |
| E21 | Scenario-scoped exemplar retrieval as a pull tool | S | Upgrade to E1 once exemplar volume is real. |
| E22 | Deterministic rescue triage (patch/rebuild/abandon rules) | M | Ops maturity, post-launch. |
| E23 | Interrogation-before-provisioning (confidence-gated clarify rounds) | M | Upgrade to P10 onboarding. |
| E24 | Judge-calibration cadence cron + heartbeat surface | S (DB-gated) | Wires E2 to the health page on a schedule. |

## Doctrine additions ratified with the E-track

1. **The operator's edit is the exemplar.** An edit is the human teaching;
   the corrected text — not the draft — is what the agent learns from.
2. **Learning surfaces are input-only.** Exemplars, principles, and prompt
   amendments can NEVER touch the rubric, thresholds, judge, or gates.
   Enforced by enumerated-surface tests (exemplar.test.ts), not just review.
3. **Calibration measures, never adjusts.** Judge drift surfaces to the
   operator; no auto-tuning of the critic policy.
4. **Egress mirrors ingress.** Every trust boundary scrubbed inbound
   (injection guard) gets an outbound mirror (egress guard, grounding,
   send caps).
