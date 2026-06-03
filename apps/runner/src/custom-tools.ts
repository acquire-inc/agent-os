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
      // Phase 22: ratchet the rest of the run to propose. The injection
      // attempt has touched the planner's context (the redaction marker is
      // still there); the safer floor for any subsequent tool call is
      // operator-in-the-loop.
      if (ctx.runId) {
        ratchetAutonomy(
          ctx.runId,
          "propose",
          `prompt-injection detected in tool.browser result (categories: ${categoriesSeen.join(", ")})`,
        );
      }
      // Best-effort Relay emit. Skip if we don't have tenant context (e.g.
      // tests dispatch without bundle metadata).
      if (ctx.tenantId && ctx.runId) {
        try {
          const db = getDb();
          for (const cat of categoriesSeen) {
            const catDetections = detections.filter((d) => d.category === cat);
            await recordFinding(db, {
              tenantId: ctx.tenantId,
              category: "anomaly",
              severity: "high",
              title: "prompt-injection attempt redacted",
              agentId: ctx.agentId ?? null,
              payload: {
                source: "tool.browser",
                run_id: ctx.runId,
                category: cat,
                detail: `${catDetections.length} ${cat} injection pattern(s) detected in tool.browser result; redacted before planner read`,
                count: catDetections.length,
                first_span_preview: catDetections[0]!.matchedSpan.slice(0, 100),
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

/** Dispatch a custom tool call. Defense in depth — the gate also checks. */
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
  const outputDir = await mkdtemp(join(tmpdir(), `runner-${bundle.agent.key}-`));
  const { result } = await handler(input, {
    outputDir,
    tenantId: bundle.agent.tenantId,
    runId: bundle.run.id,
    agentId: bundle.agent.id,
  });
  const resultPath = join(outputDir, `${toolKey.replace(/[^a-zA-Z0-9._-]/g, "_")}-result.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
  return { toolKey, resultPath };
}
