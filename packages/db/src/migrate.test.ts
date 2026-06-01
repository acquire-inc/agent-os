// Pure test for the migration-ledger decision. No DB.
// Run: pnpm --filter @agent-os/db exec tsx src/migrate.test.ts
import { pendingMigrations } from "./migrate.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const ALL = ["0001_init.sql", "0002_pg_cron.sql", "0003_autonomy_events.sql"];

function main() {
  // fresh DB: nothing applied → everything pending, in order
  assert(
    JSON.stringify(pendingMigrations(ALL, [])) === JSON.stringify(ALL),
    "empty ledger → all files pending, in order",
  );

  // fully migrated DB: re-run is a no-op (the whole point — db:migrate is now safe to re-run)
  assert(pendingMigrations(ALL, ALL).length === 0, "all applied → nothing pending (re-run safe)");

  // partial: only the un-applied tail is pending
  assert(
    JSON.stringify(pendingMigrations(ALL, ["0001_init.sql", "0002_pg_cron.sql"])) === JSON.stringify(["0003_autonomy_events.sql"]),
    "partial ledger → only the new migration is pending",
  );

  // a newly added file on an up-to-date DB → just that file
  const withNew = [...ALL, "0004_new.sql"];
  assert(
    JSON.stringify(pendingMigrations(withNew, ALL)) === JSON.stringify(["0004_new.sql"]),
    "new migration on an up-to-date ledger → only the new file pending",
  );

  // out-of-order input is still returned in filename order
  assert(
    JSON.stringify(pendingMigrations(["0003_autonomy_events.sql", "0001_init.sql", "0002_pg_cron.sql"], [])) ===
      JSON.stringify(ALL),
    "unsorted input → pending returned in filename order",
  );

  // applied entries not in the file list are ignored (don't crash, don't resurrect)
  assert(
    pendingMigrations(ALL, [...ALL, "0099_removed.sql"]).length === 0,
    "stale ledger entry is harmless",
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
