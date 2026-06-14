# AgentOS

Multi-tenant Agent OS — the control plane that runs Acquire Inc (Acqu) on
agents and is productized as Cliently. Agents are DATA. Model is CONFIG.

## Quick start

```bash
pnpm install
pnpm setup                  # interactive .env bootstrap (writes .env from your OpenRouter key)
pnpm launch:check           # offline launch oracle — should print READY ✓
pnpm --filter control-plane dev   # local UI on http://localhost:5173
```

To bring it up against a live DB: read **[`LAUNCH.md`](LAUNCH.md)**.

## Where to read next

| Path | What |
|---|---|
| [`LAUNCH.md`](LAUNCH.md) | 60-second orientation + repo map |
| [`CLAUDE.md`](CLAUDE.md) | Doctrine — read every session, encodes the non-negotiables |
| [`docs/connect-and-launch.md`](docs/connect-and-launch.md) | External setup — OpenRouter, Supabase, Inngest, hosting, domain, MCPs |
| [`docs/internal-launch-runbook.md`](docs/internal-launch-runbook.md) | Operator's step-by-step from READY to LIVE |
| [`docs/agent-coordination-guidelines.md`](docs/agent-coordination-guidelines.md) | How agents don't step on each other |
| [`.planning/PLATFORM.md`](.planning/PLATFORM.md) | Capability ledger — 38 capabilities, status per item |
| [`.planning/ROADMAP.md`](.planning/ROADMAP.md) | Phase history (Phase 1 → 67 + V2 P1–P6) |

## Stack

TypeScript (strict) · TanStack Router SPA + Hono API · Postgres 16 + pgvector
(Supabase) · Drizzle · Claude Agent SDK behind OpenRouter gateway · MCP
connectors · Inngest scheduler.

## Branches

- `main` — production
- `claude/exciting-davinci-yvptm` — current development branch

## Status

`pnpm launch:check` → **READY ✓ 24/24** offline checks pass. Operator gates
(live DB push, isolation suite) listed in the runbook.

## License

Internal — see `LICENSE` (if absent, treat as proprietary).
