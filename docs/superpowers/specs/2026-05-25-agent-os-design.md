# Agent OS — Design Spec

> Source of truth: the Master Build Document (Part I–XIII). This spec records the
> **decisions layered on top of it** for our actual build: the Supabase mapping,
> the monorepo shape, the design system, and the phased roadmap. Where this spec
> and the master doc disagree, this spec wins (it reflects user decisions made
> 2026-05-25).

## 1. What we're building

A multi-tenant "operating system for a company run on agents" — internal name
**Agent OS**, productized name **Cliently**. Tenant #1 is **Acqu** (our agency;
we dogfood it). Eventually sold as an **AI ROI offer**: clients buy an AI
workforce and use this platform as the fulfillment surface.

The headline UX is an **organization switcher**: one logged-in user can belong to
many organizations (tenants) and switch between them via top-bar company tabs.
Within an org, a **project switcher** scopes the view.

## 2. Decisions layered on the master doc

| Topic | Master doc | Our decision |
|---|---|---|
| Database / auth | Self-hosted Postgres + pgvector, custom `users` table | **Supabase** (managed Postgres 16 + pgvector + Auth + RLS + Storage). `users` → `auth.users` + `profiles`. |
| Multi-org | Tenant = hard boundary | Keep. A user joins many tenants via `tenant_members`. Org switcher = pick active tenant. |
| Auth | API-key for agents | Keep API keys for the Agent/Admin API. **Add Supabase Auth (email + OAuth) for humans** now. |
| Tenant isolation | Postgres RLS on `tenant_id` | Keep — implemented as Supabase RLS policies keyed off `tenant_members`. |
| Frontend | TanStack Start/Router/Query/Table + shadcn | Keep. Tailwind **v4**, shadcn/ui, lucide icons. |
| Design | Dark, dense | **Both light and dark** themes. Apple.com / Sequoia aesthetic. |
| Infra | control-plane + scheduler + N runners | Keep as the target. Phase 1 ships the control plane only. |

## 3. Architecture (target)

Three deployables, exactly as the master doc §2.1:
- **control-plane** — TanStack Start app: UI + Dashboard API + Agent API + Admin
  API + OAuth callbacks. Stateless; talks to Supabase.
- **scheduler** — single advisory-locked worker; evaluates job/routine crons and
  materializes `scheduled` runs.
- **runner** — Node + Claude Agent SDK; polls `/next`, executes, posts status.

The **`runs` table is the queue** (transactional claim with `FOR UPDATE SKIP
LOCKED`). No Redis. Supabase Postgres is the only datastore.

## 4. Supabase data model

The master doc Part V tables map 1:1 onto Supabase Postgres. Key adaptations:

- `auth.users` (Supabase-managed) replaces a custom users table.
- `profiles(user_id PK → auth.users, email, name, avatar_url)` — public mirror.
- `tenant_members(tenant_id, user_id, role[owner|admin|member|viewer])` — the
  membership join that powers the org switcher **and** every RLS policy.
- All tenant-scoped tables carry `tenant_id uuid` and an RLS policy:
  `tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())`.
- `doc_chunks.embedding vector(1536)` uses the `vector` extension.
- Everything else (projects, agents, jobs, runs, routines, skills, mcps,
  oauth_credentials, env_vars, knowledge_folders, documents, databases,
  approvals, audit_log, api_keys, tags, entity_tags) per Part V.

Drizzle ORM mirrors the schema for typed server-side queries; Supabase SQL
migrations are the deploy source of truth.

## 5. Design system — Apple / Sequoia, light + dark

- **Tokens**: CSS variables for color, defined for `:root` (light) and
  `.dark`. Neutral-forward palette, a single restrained accent. Translucent
  surfaces (`backdrop-blur`) for the top bar and overlays.
- **Type**: SF-style system stack (`-apple-system, ui-sans-serif…`), tight
  tracking on headings, generous line-height in body. Modular scale.
- **Density**: dashboard-dense (compact rows, 8px grid) but with Apple's
  breathing room around section headers.
- **Components**: shadcn/ui as the base, restyled to the token set. Subtle
  depth (hairline borders + soft shadows), no heavy gradients.
- **Theme toggle**: system / light / dark, persisted; respects
  `prefers-color-scheme`.

## 6. Phased roadmap (full build)

Maps the master doc milestones onto our phases. **Phase 1 is this session's
deliverable**; later phases are planned but built subsequently.

- **Phase 1 — Foundation + UI Shell** (M0 + M5): monorepo, Supabase schema +
  RLS + seed (Acqu + projects + demo agents/jobs/runs), TanStack Start app,
  design system, Supabase Auth, org switcher, project switcher, left-rail nav,
  every registry page (Runs/Jobs/Agents/Routines/Skills/MCPs/Knowledge/
  Approvals/Cost/Connections/Settings) with the universal filter bar, wired to
  Supabase (graceful demo data when unconfigured).
- **Phase 2 — Control-plane API + Scheduler** (M1–M2): CRUD, `/next` bundle +
  transactional claim, status/activity, run lifecycle, advisory-locked scheduler.
- **Phase 3 — Runner** (M3): Claude Agent SDK runner; `vitals` end-to-end.
- **Phase 4 — Connectors** (M4): MCP registry + OAuth vault + Connections flows.
- **Phase 5 — Skills** (M6): registry + GitHub sync + `ad-ops`.
- **Phase 6 — Approvals** (M7): inbox + waiting→pending resume + Slack/Telegram.
- **Phase 7 — Knowledge** (M8): folders, pgvector indexing, retrieval, memory.
- **Phase 8 — Routines + Cost** (M9): cadences, cost metering, caps, audit log.
- **Phase 9 — Cliently tenant + dev agent + GSD** (M10).
- **Phase 10 — Multi-tenancy hardening + remote runner + template cloning**
  (M11) — productized Cliently / client onboarding for the AI ROI offer.

## 7. Phase 1 success criteria

1. `pnpm install` succeeds at the monorepo root.
2. `pnpm --filter control-plane dev` serves the app; it builds with no type errors.
3. Supabase migrations apply cleanly to a Postgres 16 + pgvector database and
   create every Part V table with RLS enabled.
4. Seed produces Acqu (+ a second org), its projects, and demo
   agents/jobs/runs/skills/mcps so the UI is populated.
5. Login via Supabase Auth; the org switcher lists the user's orgs and switching
   re-scopes the dashboard.
6. Every left-rail page renders with the universal filter bar
   (Project · Tags · Source · Sort) and real-or-demo data.
7. Light and dark themes both look polished and are toggleable.

## 8. Non-goals for Phase 1

No scheduler, no runner, no live agent execution, no real OAuth connector flows,
no vector retrieval. Those are Phases 2–7. Buttons that trigger future
capabilities are present but clearly inert / "coming soon".
