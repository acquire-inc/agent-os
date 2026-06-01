// scripts/seed/seed-tool-access-audit.ts
// Batch wrapper for the tool.access-audit registry row.
// Run: pnpm seed:tool-access-audit
import { seedToolAccessAudit } from "./acqu-tool-access-audit.js";

async function main() {
  console.log("▸ Seeding tool.access-audit registry row for tenant Acqu");
  await seedToolAccessAudit();
  console.log("");
  console.log("✓ tool.access-audit seeded (unbound). Binds in 09-05 to access-auditor.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
