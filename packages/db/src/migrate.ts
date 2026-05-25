// Applies SQL migrations in supabase/migrations in filename order.
// Usage: DATABASE_URL=... pnpm --filter @agent-os/db migrate
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const text = await readFile(join(migrationsDir, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      await sql.unsafe(text);
      process.stdout.write("ok\n");
    }
    console.log(`Done. Applied ${files.length} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
