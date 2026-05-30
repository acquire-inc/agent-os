// v3 enhancement D — brand-voice gate (mirrors the uploaded repo's build_lib/voice_lint.py).
// Deterministic check for em-dashes + banned AI-slop phrases. Pure: no I/O. Intended to back a
// PostToolUse / pre-delivery content gate for client-facing agents (content-engine,
// creative-studio, client-comms, email/copy producers).

/** Banned phrases (verbatim from the agentic-templates brand-voice bank). Case-insensitive. */
export const BANNED_PHRASES = [
  "delve into", "in today's fast-paced world", "i hope this helps", "let's dive in",
  "elevate your", "robust solution", "leverage", "optimize", "streamline", "holistic",
  "seamless", "unlock", "empower", "synergy", "cutting-edge", "revolutionary",
  "game-changing", "utilize",
] as const;

const MAX_INPUT = 1_048_576; // 1 MiB ReDoS guard
const EM_DASHES = /[–—]/g; // – (en) and — (em)

export interface VoiceLintHit {
  kind: "em-dash" | "banned-phrase";
  match: string;
  index: number;
}

/** Return every brand-voice violation in `text` (empty array = clean). */
export function lintVoice(text: string): VoiceLintHit[] {
  const t = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;
  const hits: VoiceLintHit[] = [];

  for (const m of t.matchAll(EM_DASHES)) hits.push({ kind: "em-dash", match: m[0], index: m.index ?? 0 });

  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(phrase, from);
      if (i === -1) break;
      hits.push({ kind: "banned-phrase", match: t.slice(i, i + phrase.length), index: i });
      from = i + phrase.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** True when `text` has no brand-voice violations. */
export function isVoiceClean(text: string): boolean {
  return lintVoice(text).length === 0;
}
