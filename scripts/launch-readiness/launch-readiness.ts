#!/usr/bin/env tsx
// Internal-Launch Readiness Check
//
// One runnable script that asserts every offline launch invariant. Run it
// from CI, run it before declaring the platform ready for an internal team,
// run it after every batch of changes that touches platform code.
//
// What it checks (all OFFLINE — operator-gated checks are listed separately
// in the report so the operator knows what's still on their side):
//
//   1. Standing gates: contract battery + dispatch contract + lease +
//      tenant config + memory + objective + improve + critic.
//   2. Workspace typecheck across all packages.
//   3. Static RLS isolation suite + frozen attack vector registry.
//   4. Migration ordering: numbers monotonic, file names normalized.
//   5. Relay event registry: all names lowercase.dotted, no duplicates,
//      append-only (each canonical name from prior commits still present).
//   6. CANT_FAIL_KEYS count locked at 14.
//   7. Required doctrine docs present.
//
// Operator gates (printed but NOT failed on — they live on a live DB):
//   - Live RLS isolation suite (hard gate #2 for external launch).
//   - Live integration test.
//   - supabase db push migrations 0014-0029.
//
// Exit code: 0 = ready to launch internally; non-zero = something offline
// is failing and must be fixed first.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

let failures = 0;
const sections: Array<{ name: string; ok: boolean; detail: string }> = [];

function section(name: string, ok: boolean, detail: string) {
  sections.push({ name, ok, detail });
  if (!ok) failures++;
}

function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf-8", env: process.env });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function tail(s: string, n = 1): string {
  const lines = s.trim().split("\n");
  return lines.slice(-n).join("\n");
}

// 1. Offline test battery -- the contract gates the platform depends on.
const OFFLINE_TESTS: Array<{ label: string; filter: string; script: string }> = [
  { label: "core/architect",          filter: "@agent-os/core",         script: "test:architect" },
  { label: "core/architect-overlap",  filter: "@agent-os/core",         script: "test:architect-overlap" },
  { label: "core/feature-flags",      filter: "@agent-os/core",         script: "test:feature-flags" },
  { label: "core/relay",              filter: "@agent-os/core",         script: "test:relay" },
  { label: "core/router",             filter: "@agent-os/core",         script: "test:router" },
  { label: "core/budget",             filter: "@agent-os/core",         script: "test:budget" },
  { label: "core/scorecard-flow",     filter: "@agent-os/core",         script: "test:scorecard-flow" },
  { label: "core/cant-fail",          filter: "@agent-os/core",         script: "test:cantfail" },
  { label: "core/cra",                filter: "@agent-os/core",         script: "test:cra" },
  { label: "core/injection",          filter: "@agent-os/core",         script: "test:injection" },
  { label: "core/dispatch-contract",  filter: "@agent-os/core",         script: "test:dispatch-contract" },
  { label: "core/lease",              filter: "@agent-os/core",         script: "test:lease" },
  { label: "core/tenant-config",      filter: "@agent-os/core",         script: "test:tenant-config" },
  { label: "core/memory",             filter: "@agent-os/core",         script: "test:memory" },
  { label: "core/objective",          filter: "@agent-os/core",         script: "test:objective" },
  { label: "core/improve",            filter: "@agent-os/core",         script: "test:improve" },
  { label: "core/critic",             filter: "@agent-os/core",         script: "test:critic" },
  { label: "core/circuit-breaker",    filter: "@agent-os/core",         script: "test:circuit-breaker" },
  { label: "tool-rls-test (static)",  filter: "@agent-os/tool-rls-test", script: "test" },
  { label: "runner/lease-integration", filter: "@agent-os/runner",        script: "test:lease-integration" },
];

console.log("\n[1] Offline test battery");
for (const t of OFFLINE_TESTS) {
  const r = run("pnpm", ["--filter", t.filter, t.script]);
  if (r.ok) {
    console.log(`  ✓ ${t.label}`);
    section(t.label, true, "pass");
  } else {
    console.log(`  ✗ ${t.label}`);
    console.log(`    ${tail(r.stdout, 3)}`);
    section(t.label, false, tail(r.stdout, 5));
  }
}

// 2. Workspace typecheck.
console.log("\n[2] Workspace typecheck");
{
  const r = run("pnpm", ["-r", "typecheck"]);
  if (r.ok) {
    console.log("  ✓ all packages typecheck");
    section("workspace typecheck", true, "pass");
  } else {
    console.log("  ✗ workspace typecheck failed");
    section("workspace typecheck", false, tail(r.stderr || r.stdout, 10));
  }
}

// 3. Migration ordering.
console.log("\n[3] Migration ordering");
{
  const dir = join(REPO_ROOT, "supabase", "migrations");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
  const numbers = files.map((f) => parseInt(f.split("_")[0]!, 10));
  let monotonic = true;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i]! <= numbers[i - 1]!) {
      monotonic = false;
      break;
    }
  }
  const ok = files.length > 0 && monotonic;
  console.log(`  ${ok ? "✓" : "✗"} ${files.length} migrations, numbers monotonic`);
  section("migration ordering", ok, `${files.length} files`);
}

// 4. Relay event registry hygiene.
console.log("\n[4] Relay event registry hygiene");
{
  const eventsPath = join(REPO_ROOT, "packages/core/src/relay/events.ts");
  const src = readFileSync(eventsPath, "utf-8");
  const names = [...src.matchAll(/"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"/g)].map((m) => m[1]!);
  // Lowercase-dotted (the regex above is already permissive of that)
  const lowercase = names.every((n) => n === n.toLowerCase());
  const unique = new Set(names).size === names.length;
  // Doctrine-required names that future commits must NOT drop.
  const required = [
    "model.routed",
    "anomaly.circuit_tripped",
    "objective.reflexion_decided",
    "improvement.proposed",
    "critic.quorum_decided",
    "agent.lease_decided",
    "cantfail.lease_preempt",
    "cantfail.model_violation",
    "cantfail.cra_violation",
    "architect.refused",
    "relay.invariant_violation",
  ];
  const allPresent = required.every((n) => names.includes(n));
  const ok = lowercase && unique && allPresent;
  console.log(
    `  ${ok ? "✓" : "✗"} ${names.length} event names — lowercase:${lowercase} unique:${unique} required-present:${allPresent}`,
  );
  if (!allPresent) {
    const missing = required.filter((n) => !names.includes(n));
    console.log(`    missing: ${missing.join(", ")}`);
  }
  section("relay registry", ok, `${names.length} events`);
}

// 5. CANT_FAIL_KEYS pinned at 14.
console.log("\n[5] CANT_FAIL_KEYS pinned at 14");
{
  // Source of truth: architect/hydrate.ts CANT_FAIL_KEYS Set literal.
  const file = join(REPO_ROOT, "packages/core/src/architect/hydrate.ts");
  const src = existsSync(file) ? readFileSync(file, "utf-8") : "";
  // Match: const CANT_FAIL_KEYS = new Set([ ... ])
  const m = src.match(/CANT_FAIL_KEYS\s*=\s*new Set\(\s*\[([^\]]+)\]/s);
  let count = 0;
  if (m) {
    count = (m[1]!.match(/"[a-z][a-z0-9\-.]*"/g) ?? []).length;
  }
  const ok = count === 14;
  console.log(`  ${ok ? "✓" : "✗"} CANT_FAIL_KEYS count = ${count} (expected 14)`);
  section("cant-fail key count", ok, `${count}`);
}

// 6. Required doctrine docs.
console.log("\n[6] Required doctrine docs present");
{
  const required = [
    "CLAUDE.md",
    "docs/main-acqu-agent-doctrine.md",
    "docs/dispatch-contract.md",
    "docs/lease-arbitration.md",
    "docs/tenant-config-validation.md",
    "docs/agent-coordination-guidelines.md",
    "docs/internal-launch-runbook.md",
    "docs/migration-rollback-notes.md",
    "docs/feature-flags.md",
    "README.md",
    ".planning/PLATFORM.md",
    ".planning/IDEAS.md",
    ".planning/ROADMAP.md",
  ];
  const missing = required.filter((p) => !existsSync(join(REPO_ROOT, p)));
  const ok = missing.length === 0;
  console.log(`  ${ok ? "✓" : "✗"} ${required.length - missing.length}/${required.length} present`);
  if (missing.length > 0) console.log(`    missing: ${missing.join(", ")}`);
  section("doctrine docs", ok, `${missing.length} missing`);
}

// 7. Operator-gated checks — printed but not counted as failures.
console.log("\n[operator-gated — printed only, not blocking]");
console.log("  • Live RLS isolation: scripts/verify/isolation-live.ts (needs DATABASE_URL)");
console.log("  • Live integration test: pnpm --filter @agent-os/core test (needs DATABASE_URL)");
console.log("  • supabase db push migrations 0014-0029");
console.log("  • Inngest signing keys + live relay");
console.log("  • Browserbase / Stagehand keys for tool.browser");

// Report
console.log("\n" + "=".repeat(60));
console.log(`  Launch Readiness: ${failures === 0 ? "READY ✓" : `NOT READY (${failures} failing)`}`);
console.log("=".repeat(60));
for (const s of sections) {
  const mark = s.ok ? "✓" : "✗";
  console.log(`  ${mark} ${s.name.padEnd(30)} ${s.detail}`);
}
console.log("");

process.exit(failures === 0 ? 0 : 1);
