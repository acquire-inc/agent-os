// scripts/seed/seed-tool-rls-test.ts
// Batch wrapper for the tool.rls-test registry row.
// Run: pnpm seed:tool-rls-test
import { seedToolRlsTest } from "./acqu-tool-rls-test.js";

async function main() {
  console.log("▸ Seeding tool.rls-test registry row for tenant Acqu");
  await seedToolRlsTest();
  console.log("");
  console.log("✓ tool.rls-test seeded (unbound). Binds in 09-05 to tenant-isolation-tester.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
