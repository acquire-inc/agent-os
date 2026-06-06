// scripts/seed/seed-remaining-phases.ts
// Seeds Phases 2–5 of the main §1.5 roster (the 46 agents beyond Phase 1), driven by
// the doctrine parser + generic seeder. Idempotent. Prints a full 55-agent roster table
// with tier-correctness checks and the can't-fail "never Hermes" guard.
//
// Usage: tsx seed-remaining-phases.ts [Phase 2|Phase 3|Phase 4|Phase 5]   (default: all)

import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS, CANT_FAIL_AGENTS } from "@agent-os/shared";
import { and, eq, inArray } from "drizzle-orm";
import { isCantFailOnHermes } from "./_shared.js";
import { seedRoster, type SeedReport } from "./_generic.js";
import { ALL_PHASES, PHASE_2, PHASE_3, PHASE_4, PHASE_5 } from "./_roster.js";

const TENANT_ID = TENANT_IDS.acqu;

const PHASE_1_KEYS = ["vitals", "ad-ops", "briefing", "ea", "expense-tracker", "margin-monitor", "dunning-manager", "connector-health-monitor", "memory-consolidator"];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const which = process.argv[2];

  const phases = which && ALL_PHASES[which] ? { [which]: ALL_PHASES[which] } : ALL_PHASES;
  const reports: SeedReport[] = [];
  const authored: string[] = [];
  const defaulted: string[] = [];
  const skipped: string[] = [];

  for (const [label, roster] of Object.entries(phases)) {
    const rs = await seedRoster(db, roster, label);
    reports.push(...rs);
    for (const r of rs) {
      if (r.authoredSkill) authored.push(`${r.key}→${r.authoredSkill}`);
      if (r.defaultedTriggers.length) defaulted.push(`${r.key}: ${r.defaultedTriggers.join("; ")}`);
      if (r.skippedMcps.length) skipped.push(`${r.key}: ${r.skippedMcps.join(", ")}`);
    }
    console.log("");
  }

  // Per-task model routing (2026-06): each agent is seeded on its tier's model at insert
  // (modelForAgent); no fleet-wide normalization. The invariant we enforce is the safety one below.

  // ── Full §1.5 roster verification (Phase 1 + all seeded phases) ──
  const phaseKeys = [...PHASE_2, ...PHASE_3, ...PHASE_4, ...PHASE_5].map((s) => s.key);
  const allKeys = [...PHASE_1_KEYS, ...phaseKeys];
  const rows = await db.select().from(schema.agents).where(and(eq(schema.agents.tenantId, TENANT_ID), inArray(schema.agents.key, allKeys)));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  // Safety invariant: NO can't-fail agent may run on a Hermes slug (never Hermes for can't-fail).
  // Backend stays claude-agent-sdk regardless of routed model.
  const cantFailOnHermes = rows.filter((r) => isCantFailOnHermes(r.key, r.model!)).map((r) => `${r.key}=${r.model}`);
  const offBackend = rows.filter((r) => r.backend !== "claude-agent-sdk").map((r) => r.key);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.model!] = (counts[r.model!] ?? 0) + 1;

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`ROSTER SUMMARY — ${rows.length}/${allKeys.length} §1.5 agents present`);
  console.log("══════════════════════════════════════════════════════════════════════════════");
  for (const [model, n] of Object.entries(counts).sort()) console.log(`  ${String(n).padStart(2)} × ${model}`);
  console.log("");
  console.log(`  Authored primary skills this run: ${authored.length}`);
  console.log(`  Can't-fail NEVER on Hermes (MUST hold): ${cantFailOnHermes.length ? "✗ " + cantFailOnHermes.join(", ") : "✓"}`);
  console.log(`  Backend = claude-agent-sdk for all (runtime): ${offBackend.length ? "✗ " + offBackend.join(", ") : "✓"}`);
  const missing = allKeys.filter((k) => !byKey.has(k));
  console.log(`  Missing from roster: ${missing.length ? missing.join(", ") : "none ✓"}`);

  // ── Can't-fail autonomy invariant (defense-in-depth, now ALONGSIDE the Claude model) ──
  // Can't-fail agents run on Claude (Opus, never Hermes) AND must sit at autonomy=`propose`
  // (every irreversible action hits the human Approvals inbox). Auto-promotion past `propose` is
  // blocked in code (proposeAutonomyChange + maxAutonomyForAgent); this asserts the seeded state.
  const presentCantFail = (CANT_FAIL_AGENTS as readonly string[]).filter((k) => byKey.has(k));
  const overPromoted = presentCantFail.filter((k) => byKey.get(k)!.autonomy !== "propose").map((k) => `${k}=${byKey.get(k)!.autonomy}`);
  console.log(`  Can't-fail agents at autonomy=propose (MUST, ${presentCantFail.length} present): ${overPromoted.length ? "✗ " + overPromoted.join(", ") : "✓"}`);

  if (defaulted.length) {
    console.log("\n  ⚠ Triggers using operational defaults (doctrine gave no clock-time / non-cron):");
    for (const d of defaulted) console.log(`    - ${d}`);
  }
  if (skipped.length) {
    console.log("\n  ⚠ MCPs skipped (unmapped or not seeded for Acqu — e.g. github lives under Cliently):");
    for (const s of skipped) console.log(`    - ${s}`);
  }

  if (cantFailOnHermes.length || offBackend.length || missing.length || overPromoted.length) { console.error("\n✗ Verification failed."); process.exit(1); }
  console.log("\n✓ Phases seeded and verified.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
