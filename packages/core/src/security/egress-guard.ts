// Secret-egress guard (V3 E3) — no operator secret leaves through a tool call.
//
// Concept re-authored from the "secret-egress scan at the tool-call boundary"
// pattern (external survey 2026-07-21; license=NONE upstream, re-authored):
// the inbound direction is already covered (injection-guard scrubs tool
// RESULTS before the model reads them). This closes the OUTBOUND direction:
// before any custom tool dispatches, its INPUT payload is scanned for known
// secret material. A prompt-injected or off-prompt agent that tries to send
// the vault key, a provider API key, or the DB connection string to an
// external endpoint gets the dispatch refused, fail-closed, with a finding.
//
// Design:
//   - EXACT-VALUE matching against the secrets actually loaded in this
//     process's env (deterministic, zero false positives) — plus a short
//     list of high-confidence prefixes for keys that arrive from elsewhere.
//   - Values shorter than MIN_SECRET_LENGTH are ignored (common words like
//     "1" or "true" in env would otherwise false-positive everything).
//   - The guard reports WHICH env var leaked by NAME, never by value —
//     the finding itself must not re-leak the secret.
//
// Pure: caller supplies the secret map; the runner builds it from env once.

export const MIN_SECRET_LENGTH = 12;

/** Env vars whose values must never appear in an outbound tool payload. */
export const SENSITIVE_ENV_VARS: ReadonlyArray<string> = Object.freeze([
  "AOS_VAULT_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "INNGEST_SIGNING_KEY",
  "INNGEST_EVENT_KEY",
  "APIFY_TOKEN",
  "APOLLO_API_KEY",
  "SERPER_API_KEY",
  "FIRECRAWL_API_KEY",
  "NEVERBOUNCE_API_KEY",
  "NUMVERIFY_API_KEY",
  "JINA_API_KEY",
  "NANGO_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "CLOSE_OAUTH_CLIENT_SECRET",
  "RUNNER_API_KEY",
]);

/** High-confidence secret prefixes — caught even when the value didn't come
 *  from this process's env (e.g. a key the agent read from a file). */
const SECRET_PREFIXES: ReadonlyArray<{ prefix: string; label: string }> = Object.freeze([
  { prefix: "sk-ant-", label: "anthropic-api-key" },
  { prefix: "sk-or-", label: "openrouter-api-key" },
  { prefix: "sk-proj-", label: "openai-project-key" },
  { prefix: "-----BEGIN PRIVATE KEY-----", label: "pem-private-key" },
  { prefix: "-----BEGIN RSA PRIVATE KEY-----", label: "pem-rsa-private-key" },
]);

export interface EgressMatch {
  /** The env var NAME or prefix label that matched — never the value. */
  source: string;
  kind: "env-value" | "prefix";
}

export interface EgressScanResult {
  clean: boolean;
  matches: EgressMatch[];
}

/** Build the secret map from a process env snapshot. Values below the length
 *  floor are skipped (deterministic false-positive control). */
export function collectSecrets(env: Record<string, string | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of SENSITIVE_ENV_VARS) {
    const v = env[name];
    if (typeof v === "string" && v.length >= MIN_SECRET_LENGTH) out.set(name, v);
  }
  return out;
}

/**
 * Scan an outbound payload (the serialized tool input) for secret material.
 * Pure and deterministic: exact substring match on collected env values +
 * the high-confidence prefixes.
 */
export function scanSecretEgress(
  payload: string,
  secrets: ReadonlyMap<string, string>,
): EgressScanResult {
  const matches: EgressMatch[] = [];
  for (const [name, value] of secrets) {
    if (payload.includes(value)) matches.push({ source: name, kind: "env-value" });
  }
  for (const p of SECRET_PREFIXES) {
    if (payload.includes(p.prefix)) matches.push({ source: p.label, kind: "prefix" });
  }
  return { clean: matches.length === 0, matches };
}
