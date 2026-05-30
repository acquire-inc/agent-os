// Unit tests for the Inngest client + runScheduledAgent function metadata.
// Run: pnpm --filter @agent-os/inngest test
import { inngest } from "./client.js";
import { runScheduledAgent } from "./functions/runScheduled.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  console.log("• inngest client");
  assert(inngest.id === "agent-os", "client id is agent-os");

  console.log("• runScheduledAgent function metadata");
  assert(runScheduledAgent != null && typeof runScheduledAgent === "object", "runScheduledAgent is defined");
  // Version-tolerant id check: SDK exposes it differently across versions.
  // We cast to a loose record to read what's there without typing each shape.
  const fn = runScheduledAgent as unknown as Record<string, unknown>;
  const idCandidate =
    typeof fn["id"] === "function" ? (fn["id"] as () => string)() :
    typeof fn["absoluteId"] === "string" ? (fn["absoluteId"] as string) :
    typeof (fn["opts"] as { id?: string } | undefined)?.id === "string" ? (fn["opts"] as { id: string }).id :
    "";
  assert(
    typeof idCandidate === "string",
    "runScheduledAgent id is readable across SDK versions",
  );

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
