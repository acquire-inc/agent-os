// scripts/seed/seed-tool-access-log-analyzer.ts
// Batch wrapper for the tool.access-log-analyzer registry row.
// Run: pnpm seed:tool-access-log-analyzer
import { seedToolAccessLogAnalyzer } from "./acqu-tool-access-log-analyzer.js";

async function main() {
  console.log("▸ Seeding tool.access-log-analyzer registry row for tenant Acqu");
  await seedToolAccessLogAnalyzer();
  console.log("");
  console.log("✓ tool.access-log-analyzer seeded (unbound). Binds in 09-05 to security-anomaly-watchdog.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
