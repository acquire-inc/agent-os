// WR-06 parity: the router's T_CRITICAL_ALLOWLIST (the slug the resolver pins
// to for T-critical) MUST equal the runner's T_CRITICAL_MODEL_ALLOWLIST (the
// slugs assertCantFailModel accepts). If someone changes
// DEFAULT_TIER_MODELS["T-critical"].primary to a new Opus slug without
// updating the runner, every T-critical run fails-close at runtime.
//
// WR-08 fix: previously this test regex-extracted the runner literal from
// `apps/runner/src/execute.ts` as a string. That worked but was brittle
// against any rename / refactor / type-cast. The runner now imports the
// canonical allowlist from @agent-os/core directly, so this test reduces
// to a single-source-of-truth check: the router export is the only set.
// We re-import it under both alias names and assert reference equality.
// Run: pnpm --filter @agent-os/core test:parity

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { T_CRITICAL_ALLOWLIST } from "./tier-models.js";
import { T_CRITICAL_ALLOWLIST as RouterAllowlistViaIndex } from "../index.js";

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

console.log(`\n• router T_CRITICAL_ALLOWLIST: ${JSON.stringify([...T_CRITICAL_ALLOWLIST])}`);
console.log(`• index re-export: ${JSON.stringify([...RouterAllowlistViaIndex])}`);

assert(
  T_CRITICAL_ALLOWLIST === RouterAllowlistViaIndex,
  "router/tier-models.ts T_CRITICAL_ALLOWLIST === @agent-os/core index re-export (single source of truth)",
);

assert(
  T_CRITICAL_ALLOWLIST.size > 0,
  `T_CRITICAL_ALLOWLIST is non-empty (size=${T_CRITICAL_ALLOWLIST.size})`,
);

for (const slug of T_CRITICAL_ALLOWLIST) {
  assert(
    typeof slug === "string" && slug.startsWith("anthropic/"),
    `allowlisted slug ${slug} is anthropic-namespaced`,
  );
}

// Guard: assert the runner source imports T_CRITICAL_ALLOWLIST from
// @agent-os/core and does NOT fork to a local literal. Fail loud if a
// future refactor re-introduces a local Set.
const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerFile = resolve(__dirname, "../../../../apps/runner/src/execute.ts");
try {
  const src = readFileSync(runnerFile, "utf8");
  assert(
    /import\s+\{[^}]*T_CRITICAL_ALLOWLIST[^}]*\}\s+from\s+["']@agent-os\/core["']/.test(src),
    "runner imports T_CRITICAL_ALLOWLIST from @agent-os/core (not declared locally)",
  );
  // Detect a fork: a top-level `const T_CRITICAL_MODEL_ALLOWLIST = new Set(["..."])`
  // declaring a fresh literal would be a regression. The current line
  // `const T_CRITICAL_MODEL_ALLOWLIST = T_CRITICAL_ALLOWLIST;` is fine.
  const forkRe = /const\s+T_CRITICAL_MODEL_ALLOWLIST\s*=\s*new\s+Set\(/;
  assert(!forkRe.test(src), "runner does NOT declare a local `new Set(...)` for T_CRITICAL_MODEL_ALLOWLIST");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(`could not locate ${runnerFile} — parity test requires the runner source. Update the path if repo layout changed.`);
    process.exit(1);
  }
  throw e;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
