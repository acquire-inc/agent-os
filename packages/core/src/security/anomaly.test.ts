// security/anomaly.test.ts — locks the Pitfall 3 mitigations (24h window,
// absolute floor, 5× ratio) into the rendered SQL via mock-db capture.
// Run: pnpm --filter @agent-os/core run test:security

import { detectUsageSpikes } from "./anomaly.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function makeCaptureDb() {
  const captured: { text: string; params: unknown[] } = { text: "", params: [] };
  const db = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const chunks = (q.queryChunks ?? []) as Array<{ value?: string[] } | unknown>;
      let text = "";
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === "object" && "value" in c && Array.isArray((c as { value: string[] }).value)) {
          text += (c as { value: string[] }).value.join("");
        } else {
          params.push(c);
        }
      }
      captured.text = text;
      captured.params = params;
      return { rows: [] } as unknown as never;
    },
  } as unknown as Parameters<typeof detectUsageSpikes>[0];
  return { db, captured };
}

async function main() {
  console.log("• detectUsageSpikes surface");
  assert(typeof detectUsageSpikes === "function", "detectUsageSpikes is a function");

  console.log("• detectUsageSpikes — rendered SQL encodes Pitfall 3 mitigations");
  const { db, captured } = makeCaptureDb();
  await detectUsageSpikes(db, "00000000-0000-0000-0000-000000000000");

  assert(
    captured.text.includes("with current_window"),
    "CTE-structured (current_window + baseline)",
  );
  assert(
    captured.text.includes("interval '8 days'") && captured.text.includes("interval '1 day'"),
    "baseline window = 8d→1d ago (fixed lookback, planner-friendly)",
  );
  assert(
    captured.text.includes("count(*)::float / 7"),
    "baseline divides by 7 (daily average across 7-day window)",
  );
  assert(
    captured.text.includes("c.n > 10"),
    "absolute floor n > 10 (short-circuits trivial-count false-positives)",
  );
  assert(
    captured.text.includes("nullif(b.daily_avg, 0)") && captured.text.includes("> 5"),
    "5× ratio threshold + nullif guard (D-07 loose-day-1 threshold)",
  );
  assert(
    /from\s+audit_log/.test(captured.text),
    "reads from audit_log (windowed)",
  );

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
