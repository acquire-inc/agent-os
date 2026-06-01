// Applies SQL migrations in supabase/migrations in filename order, tracked by a schema_migrations
// ledger so re-running only applies what's pending (the migrations themselves are not idempotent —
// most use bare CREATE TABLE — so a ledger is what makes `db:migrate` safe to run more than once).
//
// Usage:
//   DATABASE_URL=... pnpm --filter @agent-os/db migrate              # apply pending migrations
//   DATABASE_URL=... pnpm --filter @agent-os/db migrate -- --baseline # adopt the ledger on a DB
//        that was already migrated by the pre-ledger runner: stamp all current files as applied
//        WITHOUT running them (operator asserts the schema already matches). Run once, then migrate.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
// Canonical migrations live at the repo root: supabase/migrations (standard
// Supabase CLI layout, so `supabase db push` works too). packages/db/src → root.
const migrationsDir = join(here, "..", "..", "..", "supabase", "migrations");

const LEDGER_DDL = `create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
)`;

/**
 * Pure: given all migration filenames and the set already applied, return the ones still pending,
 * in filename order. Factored out so the ledger decision is testable without a database.
 */
export function pendingMigrations(allFiles: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return [...allFiles].sort().filter((f) => !done.has(f));
}

async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const baseline = process.argv.includes("--baseline");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const files = await listMigrationFiles();
    await sql.unsafe(LEDGER_DDL);

    if (baseline) {
      for (const file of files) {
        await sql`insert into schema_migrations (filename) values (${file}) on conflict do nothing`;
      }
      console.log(`Baseline: recorded ${files.length} migration(s) as already-applied. No SQL executed.`);
      return;
    }

    const applied = (await sql`select filename from schema_migrations`).map((r) => r.filename as string);
    const pending = pendingMigrations(files, applied);
    if (pending.length === 0) {
      console.log(`Up to date. ${applied.length} migration(s) already applied; nothing to do.`);
      return;
    }
    for (const file of pending) {
      const text = await readFile(join(migrationsDir, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      // One transaction per migration: a failure rolls back the DDL AND its ledger row, so a
      // partial migration is never recorded as applied (it'll retry cleanly next run).
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      process.stdout.write("ok\n");
    }
    console.log(`Done. Applied ${pending.length} new migration(s) (${applied.length} already applied).`);
  } finally {
    await sql.end();
  }
}

// Only run when invoked directly (so the pure helper can be imported by tests without side effects).
const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
