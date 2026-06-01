// scripts/seed/seed-tool-vault-rotate.ts
// Batch wrapper for the tool.vault-rotate registry row.
// Run: pnpm seed:tool-vault-rotate
import { seedToolVaultRotate } from "./acqu-tool-vault-rotate.js";

async function main() {
  console.log("▸ Seeding tool.vault-rotate registry row for tenant Acqu");
  await seedToolVaultRotate();
  console.log("");
  console.log("✓ tool.vault-rotate seeded (unbound, requiresApproval=true). Binds in 09-05 to secrets-rotation.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
