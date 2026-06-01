// @agent-os/tool-rls-test — the hard-gate RLS test harness for Phase 9.
//
// Caller supplies a Db connected via RLS_TEST_DATABASE_URL (non-service-role —
// see README D-01). runIsolationSuite() iterates ATTACK_VECTORS, writes the
// result envelope to a file (CLAUDE.md non-negotiable #4 — large outputs go
// to file), and returns { resultsPath, passed, count }.

import type { Db } from "@agent-os/db";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATTACK_VECTORS,
  REGISTERED_COUNT_FLOOR,
  assertVectorsAppendOnly,
  type AttackVector,
} from "./attack-vectors.js";
import { asUser } from "./impersonate.js";
import {
  IsolationInputSchema,
  type IsolationInput,
  type IsolationResult,
  type VectorResult,
} from "./types.js";

export {
  ATTACK_VECTORS,
  REGISTERED_COUNT_FLOOR,
  assertVectorsAppendOnly,
  asUser,
  IsolationInputSchema,
};
export type { AttackVector, IsolationInput, IsolationResult, VectorResult };

export interface RunOptions {
  db: Db;
  /** Optional override of the output dir; defaults to a fresh os.tmpdir() child. */
  outputDir?: string;
}

export async function runIsolationSuite(
  input: IsolationInput,
  opts: RunOptions,
): Promise<IsolationResult> {
  const parsed = IsolationInputSchema.parse(input);
  assertVectorsAppendOnly();

  const outDir = opts.outputDir ?? (await mkdtemp(join(tmpdir(), "rls-test-")));
  const results: VectorResult[] = [];

  // Optional table filter via input.tables — when set, only vectors covering
  // those tables run (useful for targeted debugging; full suite is the default).
  const filter = parsed.tables ? new Set(parsed.tables) : null;
  for (const v of ATTACK_VECTORS) {
    if (filter && !filter.has(v.table)) continue;
    results.push(await v.run(opts.db, parsed));
  }

  const resultsPath = join(outDir, "results.json");
  await writeFile(
    resultsPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        vectorsCount: results.length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  return {
    resultsPath,
    passed: results.every((r) => r.passed),
    count: results.length,
  };
}
