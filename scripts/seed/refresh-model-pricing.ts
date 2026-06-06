// scripts/seed/refresh-model-pricing.ts — the "looping knowledge" job.
// Pulls live pricing/availability from OpenRouter and merges it into the model registry so the
// model-intelligence knowledge stays congruent with current models. Run on a schedule (or by the
// model-intelligence agent). Model SELECTION is capability-driven and does NOT depend on pricing —
// so if OpenRouter isn't reachable (host not allowlisted) this exits 0 with a clear note rather
// than failing anything.
// Run: pnpm --filter @agent-os/seed exec tsx refresh-model-pricing.ts
import { MODEL_REGISTRY, refreshRegistryPricing, OPENROUTER_MODELS_URL } from "@agent-os/core";

async function main() {
  console.log(`▸ Refreshing model pricing from ${OPENROUTER_MODELS_URL} …`);
  try {
    const { registry, refreshed, unmatched } = await refreshRegistryPricing();
    console.log("\n  model                                  prompt/M   completion/M   source");
    for (const m of registry) {
      const p = m.pricing;
      console.log(`  ${m.slug.padEnd(36)} $${String(p?.promptPerM ?? "?").padEnd(8)} $${String(p?.completionPerM ?? "?").padEnd(10)} ${p?.source}`);
    }
    console.log(`\n✓ Refreshed ${refreshed.length} model(s); ${unmatched.length} not present in OpenRouter payload.`);
    if (unmatched.length) console.log(`  unmatched (kept seed pricing): ${unmatched.join(", ")}`);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n⚠ Pricing refresh unavailable: ${msg}`);
    console.error("  Model SELECTION is capability-driven and unaffected — pricing is reference knowledge only.");
    console.error(`  Current registry (${MODEL_REGISTRY.length} models) keeps its curated seed pricing.`);
    process.exit(0); // non-fatal by design
  }
}

main();
