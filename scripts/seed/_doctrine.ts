// scripts/seed/_doctrine.ts
// Doctrine parser — the engine that makes "agents are DATA" literal: it reads each
// agent's fenced `System prompt:` block (and field lines) straight out of the
// doctrine .md files, so seeded prompts are guaranteed verbatim (no transcription).
//
// Precedence (CLAUDE.md): MODEL comes from main §1.5 tiering, NOT the per-agent
// `**Model:**` line (v1/v2 list pre-OpenRouter slugs). Behavior fields
// (autonomy/budget/trigger/mcps/skills) are parsed from the block — unchanged by main.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..", "..", "docs");

export type DoctrineBlock = {
  key: string;
  systemPrompt: string | null;
  fields: Record<string, string>;
};

const FILES: Record<"v1" | "v2", string> = {
  v1: join(DOCS, "acqu-agent-doctrine.md"),
  v2: join(DOCS, "acqu-agent-doctrine-v2.md"),
};

const cache: Record<string, DoctrineBlock[]> = {};

function parseDoc(doc: "v1" | "v2"): DoctrineBlock[] {
  if (cache[doc]) return cache[doc]!;
  const text = readFileSync(FILES[doc], "utf8");
  const lines = text.split("\n");
  const blocks: DoctrineBlock[] = [];
  let i = 0;
  const anchor = /^#### `([a-z0-9.\-]+)`/;
  while (i < lines.length) {
    const m = anchor.exec(lines[i]!);
    if (!m) { i++; continue; }
    const key = m[1]!;
    // Block runs until the next #### / ### / ## / # heading.
    let j = i + 1;
    while (j < lines.length && !/^#{1,4} /.test(lines[j]!)) j++;
    const body = lines.slice(i + 1, j);
    // Fields.
    const fields: Record<string, string> = {};
    const fieldRe = /^\*\*([A-Za-z ]+):\*\*\s*(.*)$/;
    for (const line of body) {
      const fm = fieldRe.exec(line);
      if (fm) fields[fm[1]!.trim()] = fm[2]!.trim();
    }
    // System prompt: first fenced ``` block after a "**System prompt:**" marker.
    let systemPrompt: string | null = null;
    const spIdx = body.findIndex((l) => /^\*\*System prompt:\*\*/.test(l));
    if (spIdx >= 0) {
      const fenceStart = body.findIndex((l, idx) => idx > spIdx && /^```/.test(l));
      if (fenceStart >= 0) {
        const fenceEnd = body.findIndex((l, idx) => idx > fenceStart && /^```/.test(l));
        if (fenceEnd >= 0) systemPrompt = body.slice(fenceStart + 1, fenceEnd).join("\n").trim();
      }
    }
    blocks.push({ key, systemPrompt, fields });
    i = j;
  }
  cache[doc] = blocks;
  return blocks;
}

/** Get the canonical block for an agent key from a doc. When a key appears more than
 *  once (v1 has a few "see §X" stubs), prefer the instance with a real fenced prompt
 *  (the longest one), so stubs never win. */
export function getAgentBlock(doc: "v1" | "v2", key: string): DoctrineBlock {
  const matches = parseDoc(doc).filter((b) => b.key === key);
  if (matches.length === 0) throw new Error(`Agent "${key}" not found in doctrine ${doc}.`);
  const withPrompt = matches.filter((b) => b.systemPrompt && b.systemPrompt.length > 0);
  const pick = (withPrompt.length ? withPrompt : matches).sort(
    (a, b) => (b.systemPrompt?.length ?? 0) - (a.systemPrompt?.length ?? 0),
  )[0]!;
  return pick;
}

/** List every agent in a doc that has a real fenced system prompt (stubs excluded). */
export function listPromptAgents(doc: "v1" | "v2"): { key: string; promptLen: number }[] {
  const seen = new Map<string, number>();
  for (const b of parseDoc(doc)) {
    if (!b.systemPrompt) continue;
    const len = b.systemPrompt.length;
    if (!seen.has(b.key) || len > seen.get(b.key)!) seen.set(b.key, len);
  }
  return [...seen.entries()].map(([key, promptLen]) => ({ key, promptLen }));
}

// ── parsers for the prose field lines ──────────────────────────────────────

/** Parse the **Autonomy:** line → the conservative gate (propose if any propose appears). */
export function parseAutonomy(raw: string | undefined): "propose" | "execute_safe" | "execute_full" {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("propose")) return "propose";
  if (s.includes("execute_full")) return "execute_full";
  if (s.includes("execute_safe")) return "execute_safe";
  return "propose"; // safest default
}

/** Parse the **Budget:** line → first dollar figure as a numeric string. */
export function parseBudget(raw: string | undefined): string {
  const m = /\$([0-9]+(?:\.[0-9]+)?)/.exec(raw ?? "");
  return m ? Number(m[1]).toFixed(2) : "0.50";
}

export type ParsedTrigger =
  | { type: "cron"; schedule: string; jobName: string }
  | { type: "webhook" | "state" | "on_demand"; eventKey: string | null };

const DOW: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/** Best-effort parse of the prose **Trigger:** line into typed triggers. Unparseable
 *  fragments fall back to on_demand. Clock-times absent in doctrine use noted defaults. */
export function parseTriggers(raw: string | undefined, key: string): { triggers: ParsedTrigger[]; defaulted: string[] } {
  const out: ParsedTrigger[] = [];
  const defaulted: string[] = [];
  const text = (raw ?? "").trim();
  if (!text) { out.push({ type: "on_demand", eventKey: null }); return { triggers: out, defaulted: ["empty→on_demand"] }; }
  // Split on " + " (doctrine uses + to join multiple triggers).
  for (const rawPart of text.split("+")) {
    const part = rawPart.trim().replace(/\.$/, "");
    // Parens-flattened view for frequency/time parsing; keep `part` for event-key derivation.
    const flat = part.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    const low = flat.toLowerCase();
    const time = /(\d{1,2}):(\d{2})/.exec(flat); // HH:MM if stated
    const tH = time ? Number(time[1]) : null;
    const tM = time ? Number(time[2]) : null;
    let mm: RegExpExecArray | null;
    if ((mm = /every\s+(\d+)\s*min/i.exec(low))) {
      out.push({ type: "cron", schedule: `*/${mm[1]} * * * *`, jobName: cap(key, "every-15m") });
    } else if ((mm = /every\s+(\d+)\s*hour/i.exec(low))) {
      out.push({ type: "cron", schedule: `0 */${mm[1]} * * *`, jobName: cap(key, "hourly") });
    } else if (/\bhourly\b|every\s+hour\b/i.test(low)) {
      out.push({ type: "cron", schedule: "0 * * * *", jobName: cap(key, "hourly") });
    } else if (/weekly/i.test(low)) {
      const dowName = Object.keys(DOW).find((d) => low.includes(d));
      const dow = dowName ? DOW[dowName]! : 1;
      const h = tH ?? 9, min = tM ?? 0;
      out.push({ type: "cron", schedule: `${min} ${h} * * ${dow}`, jobName: cap(key, "weekly") });
      if (!dowName || !time) defaulted.push(`${part}→${dowName ?? "Mon"} ${pad(h)}:${pad(min)}`);
    } else if (/monthly/i.test(low)) {
      const dom = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(low)?.[1] ?? "1";
      const h = tH ?? 9, min = tM ?? 0;
      out.push({ type: "cron", schedule: `${min} ${h} ${Number(dom)} * *`, jobName: cap(key, "monthly") });
      if (!time) defaulted.push(`${part}→day ${dom} ${pad(h)}:${pad(min)}`);
    } else if (/quarterly/i.test(low)) {
      const h = tH ?? 9, min = tM ?? 0;
      out.push({ type: "cron", schedule: `${min} ${h} 1 1,4,7,10 *`, jobName: cap(key, "quarterly") });
      if (!time) defaulted.push(`${part}→quarter-start ${pad(h)}:${pad(min)}`);
    } else if (time && /(daily|every\s+morning|every\s+night|every\s+day)/i.test(low)) {
      out.push({ type: "cron", schedule: `${tM} ${tH} * * *`, jobName: cap(key, "daily") });
    } else if (time && !/event|webhook|state|after|before|post-|per-/i.test(low)) {
      // A bare HH:MM with no weekly/event qualifier → daily at that time.
      out.push({ type: "cron", schedule: `${tM} ${tH} * * *`, jobName: cap(key, "daily") });
    } else if (/\bdaily\b|every\s+morning|every\s+night|every\s+day/i.test(low)) {
      out.push({ type: "cron", schedule: "0 9 * * *", jobName: cap(key, "daily") });
      defaulted.push(`${part}→09:00`);
    } else if (/on-demand|on demand/i.test(low)) {
      out.push({ type: "on_demand", eventKey: null });
    } else if (/webhook/i.test(low)) {
      const ev = /\(([^)]+)\)/.exec(part)?.[1] ?? part.replace(/webhook\s*(on)?/i, "").trim();
      out.push({ type: "webhook", eventKey: slug(ev) || `${key}.webhook` });
    } else if (/event|state|spawned|triggered/i.test(low)) {
      const ev = /\(([^)]+)\)/.exec(part)?.[1] ?? part;
      out.push({ type: "state", eventKey: slug(ev) || `${key}.event` });
    } else {
      out.push({ type: "on_demand", eventKey: null });
      defaulted.push(`${part}→on_demand`);
    }
  }
  // De-dup identical triggers.
  const seen = new Set<string>();
  const dedup = out.filter((t) => {
    const sig = JSON.stringify(t);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  return { triggers: dedup, defaulted };
}

function cap(key: string, suffix: string) {
  return `${key}:${suffix}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 48);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse the **MCPs:** line → doctrine mcp keys (lowercased, backtick-stripped). */
export function parseMcpKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim().toLowerCase());
}

/** Parse the **Skills:** line → skill keys (strip `skill:` prefix + backticks). */
export function parseSkillKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/^skill:/, "").trim());
}

/** Parse the **Knowledge scope:** line → { folders, tags }. Folders = unique first path
 *  segment after `kb:` (e.g. `kb:finance/unit-economics-*` → "finance"); tags always ["acqu"]. */
export function parseKnowledgeScope(raw: string | undefined): { folders: string[]; tags: string[] } {
  const folders = new Set<string>();
  if (raw) {
    // Exclusionary scopes ("all kb except kb:legal/…") describe what's EXCLUDED — listing
    // those would invert the meaning. Parse only the part before "except"; if that's a broad
    // phrase with no concrete kb: path (e.g. "all kb"), leave folders empty = broad scope.
    const beforeExcept = raw.split(/\bexcept\b/i)[0]!;
    for (const m of beforeExcept.matchAll(/kb:([a-z0-9._{}\-]+)/gi)) {
      const seg = m[1]!.split("/")[0]!.replace(/\.md$/, "").trim();
      if (seg && !seg.includes("{")) folders.add(seg);
    }
  }
  return { folders: [...folders], tags: ["acqu"] };
}

/** Parse the **Approval gate:** line → escalation-policy text (trimmed), or null. */
export function parseApprovalGate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  return t.length ? t : null;
}
