// scripts/seed/seed-tool-browser.ts
// Batch wrapper for the tool.browser registry row — mirrors seed-phase-N.ts shape.
// Run: pnpm seed:tool-browser
import { seedToolBrowser } from "./acqu-tool-browser.js";

async function main() {
  console.log("▸ Seeding tool.browser registry row for tenant Acqu");
  await seedToolBrowser();
  console.log("");
  console.log("✓ tool.browser seeded (unbound). Bind it to an agent via AgentSpec.tools in Phase 8.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
