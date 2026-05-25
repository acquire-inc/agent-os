// The Scheduler: a single advisory-locked worker that wakes on an interval,
// evaluates enabled job crons, and materializes `scheduled` runs. Even if the
// control plane is scaled to many instances, the Postgres advisory lock ensures
// exactly one scheduler fires.
import { createDb } from "@agent-os/db";
import { evaluateDueJobs } from "@agent-os/core";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000);
const ONCE = process.env.SCHEDULER_ONCE === "1";
const ADVISORY_LOCK_KEY = 4242_0001; // arbitrary, stable across instances

async function tick(db: ReturnType<typeof createDb>) {
  const created = await evaluateDueJobs(db, new Date());
  if (created.length > 0) {
    console.log(`[scheduler] materialized ${created.length} run(s): ${created.map((r) => r.runId).join(", ")}`);
  }
  return created.length;
}

async function main() {
  const db = createDb(DATABASE_URL!);

  if (ONCE) {
    const n = await tick(db);
    console.log(`[scheduler] one-shot complete (${n} run(s) created).`);
    process.exit(0);
  }

  // Hold the advisory lock on a dedicated session for the worker's lifetime.
  const lockConn = postgres(DATABASE_URL!, { max: 1 });
  const tryLock = () => lockConn<{ locked: boolean }[]>`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
  const locked = (await tryLock())[0]?.locked;
  if (!locked) {
    console.log("[scheduler] another scheduler holds the advisory lock — standing by.");
    // Retry acquisition periodically rather than exiting.
    const retry = setInterval(async () => {
      const got = (await tryLock())[0]?.locked;
      if (got) {
        clearInterval(retry);
        console.log("[scheduler] acquired advisory lock — taking over.");
        loop(db);
      }
    }, INTERVAL_MS);
    return;
  }

  console.log(`[scheduler] holding advisory lock; evaluating every ${INTERVAL_MS}ms.`);
  loop(db);
}

function loop(db: ReturnType<typeof createDb>) {
  void tick(db).catch((e) => console.error("[scheduler] tick error:", e));
  setInterval(() => void tick(db).catch((e) => console.error("[scheduler] tick error:", e)), INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
