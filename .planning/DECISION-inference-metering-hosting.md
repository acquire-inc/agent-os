# Decision Record — Inference Gateway, Metering, VPS Hosting

*2026-05-30. Research-only (no build yet, per operator). Pricing pulled live; re-verify before
committing spend — these move. Sources linked inline.*

## TL;DR recommendations

| Question | Recommendation | Why |
|---|---|---|
| **Model** | **Keep Hermes 4 405B as fleet default**; Claude only for the can't-fail list | $1/$3 vs Sonnet $3/$15 — ~5× cheaper output at the volume tier |
| **Gateway** | **Keep OpenRouter** — for *model* failover + unified billing, NOT provider failover | VERIFIED: Hermes 405B & 70B are single-sourced (Nebius FP8 only). No provider redundancy exists; gateway value is cross-model fallback + one bill across the Hermes/Claude split |
| **Metering/credits** | **OpenMeter (self-hosted)** | OSS, first-class LLM-token metering + per-model cost; ingests our existing per-run `cost_usd` |
| **VPS** | **Hetzner + Coolify** for cost; **Railway** if speed-to-ship matters more | Hetzner ~$4–10/mo self-host PG; Railway ~$10–15/mo, already in stack doctrine |
| **Self-host Hermes?** | **No** | Break-even is tens–hundreds of M tokens/mo + 2.5–3× hidden cost |

---

## 1. Model + Gateway

These are two separate decisions: what model we *run* vs what gateway we *route through*.

**Token pricing (per 1M, in/out), current:**
- Hermes 4 405B — **$1 / $3** ([OpenRouter](https://openrouter.ai/nousresearch/hermes-4-405b))
- Claude Haiku 4.5 — $1 / $5; Sonnet 4.6 — $3 / $15; Opus 4.7 — $5 / $25, and Opus 4.7's new
  tokenizer emits up to **+35% tokens** for the same text ([Claude pricing](https://www.cloudzero.com/blog/claude-api-pricing/)).

**Cost verdict:** Hermes wins decisively at the volume tier (~5× cheaper output than Sonnet).
The operator's "best Hermes" choice is sound. Keep the doctrine split: Hermes for volume,
Claude (T-critical) for the can't-fail agents.

**The real risk is Hermes availability, not price — and it's worse than assumed (VERIFIED).**
As of 2026-05, **both Hermes 4 405B and 70B are single-sourced: Nebius (FP8) is the only API
provider** for each on OpenRouter's tracked benchmarks
([405B](https://artificialanalysis.ai/models/hermes-4-llama-3-1-405b/providers),
[70B](https://artificialanalysis.ai/models/hermes-4-llama-3-1-70b/providers)). So there is **no
provider redundancy today** — a Nebius outage takes the whole Hermes fleet down regardless of
gateway. This is a real single-point-of-failure to note in ops.

**What this does to the gateway rationale:** OpenRouter's classic selling point (multi-provider
failover) **does not apply to Hermes right now**. The honest reasons to keep it are:
1. **Cross-*model* fallback** — one API, swap the slug Hermes→Claude/Llama if Nebius drops. This
   is the failover that actually exists for us, and it matters precisely *because* Hermes is
   single-sourced.
2. **Unified billing across the Hermes/Claude split** — one bill instead of Nebius + Anthropic.
3. **Zero token markup** ([pricing](https://openrouter.ai/pricing)) — revenue is a **5.5%
   credit-purchase fee** on top-ups (BYOK free to 1M req/mo, then 5%). Net Hermes ≈ $1/$3 + ~5.5%
   on deposits.

**Recommendation:** keep OpenRouter for (1)+(2)+(3); going direct to Nebius would save ~5.5% but
buys no redundancy (same single provider) and loses the cross-model fallback + unified bill.
**Add an ops note: Hermes is single-sourced on Nebius — wire a cross-model fallback slug
(e.g. → `anthropic/claude-haiku-4.5` or a Llama-3.1-405B provider) in the `Runner` so a Nebius
outage degrades gracefully instead of halting the fleet.** The `Runner` stays gateway-agnostic
(`ANTHROPIC_BASE_URL`), so all of this is config, not code.

## 2. Crediting & Tokenizing / Metering

**Gap we have:** `runs` already records `cost_usd` / `tokens_in` / `tokens_out` per run (the raw
meter). Missing: aggregation → per-tenant credits → invoicing. Needed for Cliently (billing
tenants for agent usage) and maps onto the already-seeded `billing-runner` / `dunning-manager`.

**Options** ([Lago vs Orb vs Metronome](https://www.pkgpulse.com/blog/lago-vs-orb-vs-metronome-usage-based-billing-apis-2026)):
- **OpenMeter** (OSS) — first-class LLM-token metering + model-specific cost ([repo](https://github.com/openmeterio/openmeter)). **← pick**
- **Lago** (OSS) — broader subscription/invoicing, self-hostable ([repo](https://github.com/getlago/lago)).
- Metronome — enterprise; **acquired by Stripe Jan 2026**. Orb — best DX, overkill now.

**Pick: OpenMeter, self-hosted.** Reasons: token→credit conversion is the exact need; OSS fits
the multi-tenant own-the-infra posture; ingests our per-run events directly. Lago is the
fallback if we later want its full invoicing/subscription layer. (If we'd rather not run another
service, Lago-cloud or Orb are the managed escapes — but that's cost we don't need yet.)

**Build sketch (future):** emit a usage event per run (`tenant_id`, `agent_id`, model, tokens,
cost) → OpenMeter meter → credit balance per tenant → invoice. A `usage` table or a thin
exporter off `runs` + the existing `agent_metrics` rollup feeds it.

## 3. VPS Hosting

Hosts the **control plane only** (TS SPA + Hono API + Postgres/pgvector + runner + scheduler).
Inference stays on the gateway regardless.

| Option | ~Cost | Trade-off | Source |
|---|---|---|---|
| **Hetzner + Coolify** | ~$4–10/mo, PG self-hosted free | cheapest; you run infra (Coolify = Git deploys, SSL, backups) | [comparison](https://thesoftwarescout.com/fly-io-vs-railway-2026-which-developer-platform-should-you-deploy-on/) |
| **Railway** | ~$10–15/mo | easiest; usage-based; **already named in stack doctrine** | same |
| **Fly.io** | $20–40+/mo | multi-region edge; cheaper PG than Railway | same |

**Pick:** **Hetzner + Coolify** if minimizing cost and ops is acceptable; **Railway** if
speed-to-ship dominates (and it's already in `CLAUDE.md`'s stack). Default lean: **Railway now**
(matches doctrine, lowest friction to first deploy), **migrate to Hetzner+Coolify** if/when
cost at scale justifies the ops.

**Do NOT self-host Hermes.** Break-even for a 405B model is tens–hundreds of M tokens/mo at high
GPU utilization, and raw GPU is only 30–40% of true cost (2.5–3× multiplier for labor/reliability)
([analysis](https://www.braincuber.com/blog/self-hosted-llms-vs-api-based-llms-cost-performance-analysis)).
The VPS hosts the control plane; inference is API/gateway.

---

## Open items to resolve before building any of this
1. ~~Confirm OpenRouter Hermes-4-405B provider count.~~ **RESOLVED 2026-05-30: single-sourced
   (Nebius FP8 only), for both 405B and 70B.** → keep OpenRouter for model-fallback + unified
   billing, and wire a cross-model fallback slug for the Nebius SPOF (new item 2).
2. **NEW (raised by item 1):** choose + configure the cross-model fallback slug in the `Runner`
   for a Nebius outage (candidate: `anthropic/claude-haiku-4.5`, or a Llama-3.1-405B provider to
   stay cheap). Config-only.
3. Decide self-host vs managed for OpenMeter (recommend self-host on the same VPS).
4. Pick the first deploy target (Railway recommended for v1).
5. All of the above are **config/infra**, not agent code — consistent with "agents are data."
