#!/usr/bin/env tsx
// Post-deploy smoke test.
//
// Hits the API surface against a base URL and confirms the shape of every
// load-bearing admin endpoint. Operator runs this AFTER bringing up the
// API + admin key to confirm the deploy is healthy before letting agents
// run.
//
// Usage:
//   AOS_BASE_URL=https://api.your-tenant.com \
//   AOS_ADMIN_KEY=ak_xxx \
//   pnpm smoke
//
// Exit 0 = healthy. Non-zero = something's wrong; read the output.

import { argv, exit } from "node:process";

const BASE = process.env.AOS_BASE_URL ?? "http://localhost:8787";
const KEY = process.env.AOS_ADMIN_KEY ?? "";

if (!KEY) {
  console.error("Set AOS_ADMIN_KEY before running smoke.");
  exit(2);
}

interface Check {
  label: string;
  path: string;
  method: "GET";
  expect: (j: unknown) => boolean;
}

const CHECKS: Check[] = [
  {
    label: "tier-overrides list",
    path: "/api/admin/tenants/me/tier-overrides",
    method: "GET",
    expect: (j) => isObj(j) && Array.isArray((j as { tiers?: unknown[] }).tiers),
  },
  {
    label: "scorecard thresholds",
    path: "/api/admin/tenants/me/scorecard-thresholds",
    method: "GET",
    expect: (j) =>
      isObj(j) &&
      hasNumber(j, "defaults.minSampleSize") &&
      hasNumber(j, "effective.minSampleSize"),
  },
  {
    label: "budget status",
    path: "/api/admin/tenants/me/budget-status",
    method: "GET",
    expect: (j) => isObj(j) && hasNumber(j, "monthToDateUsd"),
  },
  {
    label: "models catalog",
    path: "/api/admin/models",
    method: "GET",
    expect: (j) => isObj(j) && Array.isArray((j as { models?: unknown[] }).models),
  },
  {
    label: "improvement proposals queue",
    path: "/api/admin/improvement-proposals?status=pending",
    method: "GET",
    expect: (j) => isObj(j) && Array.isArray((j as { proposals?: unknown[] }).proposals),
  },
  {
    label: "manager proposals queue",
    path: "/api/admin/manager-proposals?status=pending",
    method: "GET",
    expect: (j) => isObj(j) && Array.isArray((j as { proposals?: unknown[] }).proposals),
  },
  {
    label: "model routing recent",
    path: "/api/admin/model-routing/recent?limit=5",
    method: "GET",
    expect: (j) => isObj(j) && Array.isArray((j as { events?: unknown[] }).events),
  },
];

function isObj(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function hasNumber(j: unknown, dottedPath: string): boolean {
  if (!isObj(j)) return false;
  const parts = dottedPath.split(".");
  let cur: unknown = j;
  for (const p of parts) {
    if (!isObj(cur)) return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "number" && Number.isFinite(cur);
}

const verbose = argv.includes("--verbose");

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const ck of CHECKS) {
  process.stdout.write(`▸ ${ck.label.padEnd(36)} `);
  try {
    const res = await fetch(`${BASE}${ck.path}`, {
      method: ck.method,
      headers: { authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) {
      failed++;
      failures.push(`${ck.label}: HTTP ${res.status}`);
      console.log(`✗ HTTP ${res.status}`);
      continue;
    }
    const body = (await res.json()) as unknown;
    const ok = ck.expect(body);
    if (ok) {
      passed++;
      console.log("✓");
      if (verbose) console.log(`    payload sample: ${JSON.stringify(body).slice(0, 120)}…`);
    } else {
      failed++;
      failures.push(`${ck.label}: shape mismatch — got ${JSON.stringify(body).slice(0, 200)}`);
      console.log("✗ shape");
    }
  } catch (e) {
    failed++;
    failures.push(`${ck.label}: ${(e as Error).message}`);
    console.log(`✗ ${(e as Error).message}`);
  }
}

console.log("");
console.log("============================================================");
console.log(`  Smoke: ${failed === 0 ? "HEALTHY ✓" : `${failed} CHECKS FAILED`}`);
console.log(`  ${passed} passed · ${failed} failed · ${CHECKS.length} total`);
console.log("============================================================");
if (failures.length > 0) {
  console.log("");
  console.log("Failures:");
  for (const f of failures) console.log(`  • ${f}`);
}
exit(failed === 0 ? 0 : 1);
