// WR-06 parity: the router's T_CRITICAL_ALLOWLIST (the slug the resolver pins
// to for T-critical) MUST equal the runner's T_CRITICAL_MODEL_ALLOWLIST (the
// slugs assertCantFailModel accepts). If someone changes
// DEFAULT_TIER_MODELS["T-critical"].primary to a new Opus slug without
// updating apps/runner/src/execute.ts, every T-critical run fails-close at
// runtime. This test surfaces the drift at CI time.
// Run: pnpm --filter @agent-os/core test:parity

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { T_CRITICAL_ALLOWLIST } from "./tier-models.js";

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerFile = resolve(__dirname, "../../../../apps/runner/src/execute.ts");

let runnerSource: string;
try {
  runnerSource = readFileSync(runnerFile, "utf8");
} catch {
  console.error(
    `could not locate ${runnerFile} — parity test requires both sources. Update path if repo layout changed.`,
  );
  process.exit(1);
}

const match = runnerSource.match(
  /T_CRITICAL_MODEL_ALLOWLIST\s*=\s*new\s+Set\(\s*\[([^\]]+)\]/,
);
assert(match !== null, "found T_CRITICAL_MODEL_ALLOWLIST literal in runner source");

if (!match) {
  console.error("first 200 chars of runner source for debug:");
  console.error(runnerSource.slice(0, 200));
  process.exit(1);
}

const runnerSet = new Set(
  [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string),
);

console.log(`\n• router T_CRITICAL_ALLOWLIST: ${JSON.stringify([...T_CRITICAL_ALLOWLIST])}`);
console.log(`• runner T_CRITICAL_MODEL_ALLOWLIST: ${JSON.stringify([...runnerSet])}`);

assert(
  runnerSet.size === T_CRITICAL_ALLOWLIST.size,
  `allowlist sizes match (router=${T_CRITICAL_ALLOWLIST.size}, runner=${runnerSet.size})`,
);

for (const el of T_CRITICAL_ALLOWLIST) {
  assert(runnerSet.has(el), `router element ${el} present in runner allowlist`);
}

for (const el of runnerSet) {
  assert(T_CRITICAL_ALLOWLIST.has(el), `runner element ${el} present in router allowlist`);
}

if (failed > 0) {
  console.error(`\nrouter: ${JSON.stringify([...T_CRITICAL_ALLOWLIST])}`);
  console.error(`runner: ${JSON.stringify([...runnerSet])}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
