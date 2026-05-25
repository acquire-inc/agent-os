# Phase 1 — Foundation + UI Shell Implementation Plan

> **For agentic workers:** execute task-by-task. Mechanical page tasks may be
> delegated to fresh subagents; schema and shell tasks are coordinator-owned.

**Goal:** Stand up the Agent OS monorepo, the Supabase schema (Part V) with RLS +
seed, and a polished TanStack Start control-plane app with org switching, project
switching, themed (light+dark) Apple/Sequoia UI, Supabase Auth, and every
left-rail registry page wired to Supabase with graceful demo-data fallback.

**Architecture:** pnpm-workspace monorepo. `apps/control-plane` is a TanStack
Start app. `packages/db` holds Drizzle schema + Supabase SQL migrations + seed.
`packages/shared` holds shared TS types. Data access goes through a thin layer
that uses Supabase JS when env is configured, else returns seeded demo data so
the UI is always demoable.

**Tech Stack:** TypeScript, pnpm workspaces, TanStack Start/Router/Query/Table,
React 19, Tailwind v4, shadcn/ui, lucide-react, Drizzle ORM, @supabase/supabase-js
+ @supabase/ssr, zod.

---

## File structure

```
agent-os/
  package.json                      # workspace root, scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example
  packages/
    shared/        # types: Tenant, Project, Agent, Job, Run, … + enums
    db/            # drizzle schema, migrations (SQL), seed, supabase/ dir
  apps/
    control-plane/
      app/
        styles/app.css            # tailwind v4 + design tokens (light/dark)
        lib/                      # supabase client, theme, demo-data, queries
        components/               # ui/ (shadcn), shell/ (TopBar, OrgSwitcher,
                                  #   ProjectSwitcher, SideNav, FilterBar, ThemeToggle)
        routes/                   # __root, index, login, _app/* registry pages
      app.config.ts / vite, tsconfig, package.json
```

## Tasks

### Task 1 — Monorepo scaffold
- Root `package.json` (private, workspaces), `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `.gitignore`, `.env.example`, `.nvmrc`.
- Verify: `pnpm install` resolves.

### Task 2 — packages/shared
- Enums + domain types matching Part V (autonomy, run status, backend, tag, etc.)
  and DTOs the UI consumes.
- Verify: `tsc --noEmit` clean.

### Task 3 — packages/db: Drizzle schema
- Drizzle pg schema for every Part V table + `profiles` + `tenant_members`.
- `drizzle.config.ts`. Verify: `tsc --noEmit` clean.

### Task 4 — packages/db: Supabase migrations + RLS
- `supabase/migrations/0001_init.sql`: extensions (`vector`), all tables,
  `tenant_members`, indexes, RLS enable + per-table tenant policies, the
  `is_tenant_member()` helper, the `claim_next_run` SQL function stub.
- Verify: apply against a throwaway Postgres+pgvector (docker) — no errors.

### Task 5 — packages/db: seed
- `seed.ts` (and an idempotent `seed.sql`) inserting: 2 tenants (Acqu, Cliently),
  projects, tags, demo agents/jobs/runs/routines/skills/mcps/approvals/cost rows,
  one demo user as member of both. Used by the app's demo-data fallback too.
- Verify: seed runs against the docker DB; row counts > 0.

### Task 6 — control-plane app scaffold + design tokens
- TanStack Start app config, Vite, Tailwind v4, `app.css` with light/dark tokens,
  base shadcn primitives (button, card, input, dropdown, dialog, badge, table,
  tabs, select, tooltip, skeleton, scroll-area, avatar, separator).
- Theme provider + toggle (system/light/dark, persisted).
- Verify: `pnpm --filter control-plane dev` boots; root renders themed.

### Task 7 — Supabase client + data layer + demo fallback
- `lib/supabase.ts` (browser + server via @supabase/ssr), `lib/demo-data.ts`
  (re-exports seed fixtures), `lib/queries.ts` (per-entity fetchers that use
  Supabase when `VITE_SUPABASE_URL` set, else demo data), TanStack Query setup.
- Verify: queries return demo rows with no env configured.

### Task 8 — Auth + app shell
- `routes/login.tsx` (Supabase email/OAuth; demo bypass when unconfigured),
  `_app` layout route guarding session, `TopBar` with **OrgSwitcher** (company
  tabs + add), **ProjectSwitcher** (dropdown + All Projects), `SideNav` left rail,
  `ThemeToggle`. Active org/project in URL search + context.
- Verify: login → shell renders; switching org changes active tenant; switching
  project re-scopes; nav routes work.

### Task 9 — Universal FilterBar
- `FilterBar` component: Project · Tags · Source · Sort. Reads/writes URL search
  params; shared by every registry page.
- Verify: changing a filter updates the URL and filters the list.

### Task 10 — Registry pages (parallelizable, one subagent each)
For each of: **Runs, Jobs, Agents, Routines, Skills, MCPs, Knowledge,
Approvals, Cost, Connections, Settings** — build the route under `_app/`:
- List/board view using TanStack Table or card grid, the FilterBar, status dots,
  empty states, and a detail drawer/page where the master doc specifies one
  (Runs detail = activity log/tokens/cost; Agents detail = Overview/Config/Runs/
  Approvals tabs). Data from `lib/queries`.
- Verify each: renders populated from demo data, filter bar works, light+dark ok.

### Task 11 — Polish + verify
- Dashboard `index` (Runs board as home), 404, loading skeletons, responsive,
  PWA manifest. Run `tsc --noEmit`, build, and a dev-server smoke check of every
  route in light and dark.

## Self-review checklist
- Every Part V table present in migration + Drizzle. RLS enabled on all.
- Every left-rail item has a route. FilterBar shared, not copy-pasted.
- Demo fallback works with zero env. Real Supabase works when env set.
- No type errors; app builds; both themes polished.
