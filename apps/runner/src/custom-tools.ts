// Runner-side dispatch for custom registry tools (Plan 07-06 + 09-04).
//
// Tools bound to an agent surface in the Bundle as `bundle.tools[]`. For each
// one whose key matches a registered handler here, the runner can dispatch it
// outside of the Claude Agent SDK's MCP path — useful for deterministic
// shared services like tool.browser where we want SSRF guard + file outputs
// (CLAUDE.md non-negotiable #4) before anything hits the model.
//
// The PreToolUse autonomy gate still fires for these; we leave the gate alone
// and only add the dispatch layer.
//
// Phase 9 adds: tool.rls-test, tool.vault-rotate, tool.access-audit,
// tool.access-log-analyzer. Each lazy-creates its db connection + (for
// vault-rotate) the vault key from env vars on first call so handlers stay
// process-isolated from runner module load — env may not be wired at import.
import { recordFinding, scrubToolResult } from "@agent-os/core";
import { getBudgetTracker } from "./budget.js";
import { ratchetAutonomy } from "./run-state.js";
import { runBrowserTool, type BrowserToolInput, type BrowserToolResult } from "@agent-os/tool-browser";
import {
  runIsolationSuite,
  type IsolationInput,
  type IsolationResult,
} from "@agent-os/tool-rls-test";
import {
  rotateCredential,
  findOrphanedGrants,
  detectUsageSpikes,
  closeRefresher,
  metaRefresher,
  stripeRefresher,
  type RotateResult,
} from "@agent-os/core";
import { createDb, type Db } from "@agent-os/db";
import type { Refresher } from "@agent-os/vault";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bundle } from "./api-client.js";

/** Result envelope written to a file under the run's tmp dir. */
export interface CustomToolDispatchResult {
  toolKey: string;
  resultPath: string;
}

export interface CustomToolHandlerCtx {
  outputDir: string;
  /** Bundle metadata for Phase 19 Relay finding emission. Optional for
   *  back-compat with handlers that don't need it. */
  tenantId?: string;
  runId?: string;
  agentId?: string;
}

export type CustomToolHandler = (
  input: unknown,
  ctx: CustomToolHandlerCtx,
) => Promise<{ result: unknown }>;

// Lazy singletons — created on first use, reused across dispatches.
let cachedDb: Db | null = null;
function getDb(): Db {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for security tool dispatch");
  cachedDb = createDb(url);
  return cachedDb;
}

function getVaultKey(): Buffer {
  const k = process.env.AOS_VAULT_KEY;
  if (!k) throw new Error("AOS_VAULT_KEY required for tool.vault-rotate");
  // Keys are stored hex-encoded; 32 bytes for AES-256.
  return Buffer.from(k, "hex");
}

function pickRefresher(provider: string): Refresher {
  switch (provider) {
    case "close":
      return closeRefresher;
    case "meta":
      return metaRefresher;
    case "stripe":
      return stripeRefresher;
    default:
      throw new Error(`tool.vault-rotate: unknown provider "${provider}" (expected close|meta|stripe)`);
  }
}

export const customToolDispatch: Record<string, CustomToolHandler> = {
  "tool.browser": async (input, ctx) => {
    const result: BrowserToolResult = await runBrowserTool(input as BrowserToolInput, {
      outputDir: ctx.outputDir,
    });
    // Phase 15: scrub prompt-injection patterns from browser-returned content
    // before piping back to the planner. The browser is the canonical
    // external-trust-boundary tool — scraped pages can contain hostile text.
    // Phase 19: emit finding.recorded for each distinct category detected.
    const { result: scrubbed, detections } = scrubToolResult(result);
    if (detections.length > 0) {
      const categoriesSeen = [...new Set(detections.map((d) => d.category))];
      console.warn(
        `[runner] tool.browser: ${detections.length} prompt-injection pattern(s) redacted from result (categories: ${categoriesSeen.join(", ")})`,
      );
      // WR-03 fix: steganographic-only matches (BOM, RTL/LTR marks, ZWJ, etc.)
      // commonly appear in legitimate non-ASCII content (Arabic/Hebrew text,
      // Windows-exported Excel snippets, emoji ZWJ sequences). They get
      // recorded as findings but do NOT trigger the autonomy ratchet — the
      // redaction marker is the audit trail; the ratchet would produce an
      // operator-noise firehose.
      const nonSteganographic = categoriesSeen.filter((c) => c !== "steganographic");
      // Phase 22: ratchet the rest of the run to propose ONLY when the
      // match included a real-attack category (anything beyond steganographic).
      if (ctx.runId && nonSteganographic.length > 0) {
        ratchetAutonomy(
          ctx.runId,
          "propose",
          `prompt-injection detected in tool.browser result (categories: ${nonSteganographic.join(", ")})`,
        );
      }
      // Best-effort Relay emit. Skip if we don't have tenant context (e.g.
      // tests dispatch without bundle metadata).
      if (ctx.tenantId && ctx.runId) {
        try {
          const db = getDb();
          for (const cat of categoriesSeen) {
            const catDetections = detections.filter((d) => d.category === cat);
            // WR-03 fix: steganographic = medium (often benign non-ASCII).
            // Other categories = high (real attack patterns).
            // WR-12 fix: base64-encode the span preview so the operator must
            // explicitly decode it. A determined attacker could craft a
            // payload whose first-100 chars exfiltrate into operator logs.
            const severity = cat === "steganographic" ? "medium" : "high";
            await recordFinding(db, {
              tenantId: ctx.tenantId,
              category: "anomaly",
              severity,
              title: "prompt-injection attempt redacted",
              agentId: ctx.agentId ?? null,
              payload: {
                source: "tool.browser",
                run_id: ctx.runId,
                category: cat,
                detail: `${catDetections.length} ${cat} injection pattern(s) detected in tool.browser result; redacted before planner read`,
                count: catDetections.length,
                first_span_preview_b64: Buffer.from(
                  catDetections[0]!.matchedSpan.slice(0, 100),
                ).toString("base64"),
              },
            }).catch((e) => {
              console.error(`[runner] failed to recordFinding for injection cat=${cat}: ${(e as Error).message}`);
            });
          }
        } catch (e) {
          console.error(`[runner] tool.browser injection-emit skipped (db unavailable): ${(e as Error).message}`);
        }
      }
    }
    return { result: scrubbed };
  },
  // D-01: runner-dispatched RLS test uses ctx.db (likely service-role) — for
  // cron sanity ONLY; HARD GATE verification uses scripts/verify/isolation-live.ts
  // with RLS_TEST_DATABASE_URL (plan 09-06). The in-runner call is sanity-
  // checking; false-pass is caught by positive controls in attack-vectors.ts.
  "tool.rls-test": async (input, ctx) => {
    const result: IsolationResult = await runIsolationSuite(input as IsolationInput, {
      db: getDb(),
      outputDir: ctx.outputDir,
    });
    return { result };
  },
  "tool.vault-rotate": async (input) => {
    const { mcpId, provider } = input as { mcpId: string; provider: string };
    const result: RotateResult = await rotateCredential(
      getDb(),
      getVaultKey(),
      mcpId,
      pickRefresher(provider),
    );
    return { result };
  },
  "tool.access-audit": async (input) => {
    const { tenantId } = input as { tenantId: string };
    const result = await findOrphanedGrants(getDb(), tenantId);
    return { result };
  },
  "tool.access-log-analyzer": async (input) => {
    const { tenantId, hours } = input as { tenantId: string; hours?: number };
    const result = await detectUsageSpikes(getDb(), tenantId, { hours: hours ?? 24 });
    return { result };
  },
};

/** Derive the explicit allowedTools list from the agent's bindings. Pitfall 5:
 *  never leave allowedTools unset — that lets the agent call ANY tool. Returns
 *  custom tool keys + MCP names; the Agent SDK matches on either. */
export function deriveAllowedTools(bundle: Bundle): string[] {
  const toolKeys = (bundle.tools ?? []).map((t) => t.key);
  const mcpNames = (bundle.mcpServers ?? []).map((m) => m.name);
  return [...toolKeys, ...mcpNames];
}

/** Sentinel error thrown when a tool dispatch is refused because the
 *  reserve would breach the agent's budget cap. Callers (the SDK hook or
 *  the runner orchestrator) can map this to a propose / approval / abort
 *  path per the cost-ceiling-discipline skill workflow step 5. */
export class CapBreachError extends Error {
  readonly toolKey: string;
  readonly requestedUsd: number;
  readonly committedUsd: number;
  readonly capUsd: number;

  constructor(toolKey: string, requestedUsd: number, committedUsd: number, capUsd: number) {
    super(
      `dispatchCustomTool: cap breach refused for ${toolKey} (requested $${requestedUsd.toFixed(4)} + committed $${committedUsd.toFixed(4)} > cap $${capUsd.toFixed(2)})`,
    );
    this.name = "CapBreachError";
    this.toolKey = toolKey;
    this.requestedUsd = requestedUsd;
    this.committedUsd = committedUsd;
    this.capUsd = capUsd;
  }
}

/** Dispatch a custom tool call.
 *
 * Phase 26: wraps the handler with the BudgetTracker reserve-before /
 * commit-after pattern from the cost-ceiling-discipline SKILL. The
 * reserve uses the tool's per-invocation cost estimate (bundle.tools[].
 * costEstimateUsd, sourced from migration 0016's tools.cost_estimate_usd).
 * A reserve that would breach the run's cap throws CapBreachError — the
 * tool call does NOT run.
 *
 * Best-effort: if the run was never opened in the singleton tracker
 * (test fixtures, dry-run paths that don't call executeRun's openRun),
 * we skip reserve/commit silently so dispatchCustomTool stays usable
 * in isolation. The audit trail is only complete when executeRun is
 * the entry point.
 */
export async function dispatchCustomTool(
  bundle: Bundle,
  toolKey: string,
  input: unknown,
): Promise<CustomToolDispatchResult> {
  const bound = (bundle.tools ?? []).find((t) => t.key === toolKey);
  if (!bound) {
    throw new Error(`agent ${bundle.agent.key} is not bound to ${toolKey} — refusing dispatch`);
  }
  const handler = customToolDispatch[toolKey];
  if (!handler) {
    throw new Error(`no custom-tool handler registered for ${toolKey}`);
  }

  // Phase 26: reserve before dispatch. Skip if the tracker has no open run
  // for this id (dispatchCustomTool used outside executeRun, e.g. a script
  // or a dry-run test path).
  const tracker = getBudgetTracker();
  const estimateUsd = Number(bound.costEstimateUsd ?? "0");
  let reservationId: string | null = null;
  if (tracker.hasRun(bundle.run.id) && estimateUsd > 0) {
    const r = tracker.reserveSpend(bundle.run.id, estimateUsd, {
      tool: toolKey,
      phase: "dispatch",
    });
    if (!r.ok && r.reason === "would_breach_cap") {
      throw new CapBreachError(
        toolKey,
        estimateUsd,
        r.state.committedTotal,
        r.state.capUsd,
      );
    }
    if (r.ok) reservationId = r.reservationId;
  }

  const outputDir = await mkdtemp(join(tmpdir(), `runner-${bundle.agent.key}-`));
  try {
    const { result } = await handler(input, {
      outputDir,
      tenantId: bundle.agent.tenantId,
      runId: bundle.run.id,
      agentId: bundle.agent.id,
    });
    const resultPath = join(outputDir, `${toolKey.replace(/[^a-zA-Z0-9._-]/g, "_")}-result.json`);
    await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");

    // Commit the estimate as the actual on success. Future enhancement:
    // a handler that returns a true cost can supersede the estimate.
    if (reservationId) {
      tracker.commitSpend(bundle.run.id, reservationId, estimateUsd, {
        tool: toolKey,
        phase: "dispatch",
      });
    }
    return { toolKey, resultPath };
  } catch (err) {
    // Release the reservation on any failure so subsequent dispatches
    // can still proceed within the cap.
    if (reservationId) {
      tracker.releaseSpend(bundle.run.id, reservationId, {
        tool: toolKey,
        phase: "dispatch",
        error: (err as Error).message,
      });
    }
    throw err;
  }
}
