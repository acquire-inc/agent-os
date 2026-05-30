// Input/output contract for tool.browser (Browserbase + Stagehand headless automation).
// Large outputs (screenshots, page HTML/text) are written to files and referenced by
// path — never returned as blobs in the result (CLAUDE.md non-negotiable #4).
import { z } from "zod";

export const BrowserToolInputSchema = z.object({
  url: z.string().url(),
  instruction: z.string().min(1),
  /** Optional zod-ish shape (as JSON) describing what to extract from the page. */
  extractSchema: z.record(z.unknown()).optional(),
});

export type BrowserToolInput = z.infer<typeof BrowserToolInputSchema>;

export interface BrowserToolResult {
  url: string;
  finalUrl: string;
  /** Structured extraction, when an extractSchema was provided. */
  extracted?: unknown;
  /** Path to the saved page HTML/text. */
  textPath: string;
  /** Path to the saved screenshot (PNG) — only set when a Browserbase fetcher is wired (Phase 8). */
  screenshotPath?: string;
}
