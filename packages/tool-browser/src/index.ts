// tool.browser — headless web automation.
//
// Invoked runner-side; the runner's PreToolUse autonomy gate decides whether a
// given agent may call it. This module validates input, SSRF-guards the target,
// fetches the page, and persists outputs to files (CLAUDE.md non-negotiable #4).
//
// Phase 7 scope is the security boundary + the registry+runner integration. A
// full Browserbase + Stagehand wiring lands in Phase 8 when an actual agent
// binds the tool — Stagehand 3.4's API surface (V3 class) is moving, so we keep
// the dependency footprint small here and the contract stable. The handler
// shape (validate → SSRF-guard → fetch → write files → return paths) is what
// the runner depends on; the Browserbase fetcher is a one-line swap.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertUrlAllowed } from "./ssrf.js";
import { BrowserToolInputSchema, type BrowserToolInput, type BrowserToolResult } from "./types.js";

export * from "./types.js";
export * from "./ssrf.js";

export interface BrowserFetcher {
  fetchPage(url: string): Promise<{ finalUrl: string; html: string }>;
}

/** Default fetcher: plain Node fetch. Good enough for static pages + smoke tests;
 *  swap to Browserbase + Stagehand in Phase 8 for JS-rendered pages + agent actions. */
export const defaultFetcher: BrowserFetcher = {
  async fetchPage(url) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
    const html = await res.text();
    return { finalUrl: res.url, html };
  },
};

export async function runBrowserTool(
  input: BrowserToolInput,
  opts?: { outputDir?: string; fetcher?: BrowserFetcher },
): Promise<BrowserToolResult> {
  // 1. Validate the contract.
  const parsed = BrowserToolInputSchema.parse(input);
  // 2. SSRF guard BEFORE any network construction (DNS-rebinding-safe).
  await assertUrlAllowed(parsed.url);

  const outDir = opts?.outputDir ?? (await mkdtemp(join(tmpdir(), "tool-browser-")));
  const fetcher = opts?.fetcher ?? defaultFetcher;

  // 3. Fetch and persist. Large outputs to files (non-negotiable #4), return paths.
  const { finalUrl, html } = await fetcher.fetchPage(parsed.url);
  const textPath = join(outDir, "page.txt");
  await writeFile(textPath, html, "utf8");

  return { url: parsed.url, finalUrl, textPath };
}
