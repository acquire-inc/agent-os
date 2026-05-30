// v3 enhancement C — credential namespacing (mirrors the uploaded repo's
// docs/security/CREDENTIAL_NAMESPACE_CONVENTION.md + pause_policy.py).
//
// Two credential classes:
//   AGENTIC_<KEY>           = infra credentials the OS owns. Missing → fail loud (no pause);
//                             it's our own infra, a human paste-back won't help.
//   CLIENT_<TENANT>_<KEY>   = per-tenant client-supplied credentials. Missing → PAUSE the run
//                             and request the value from a human (an approval gate), never crash.
// Anything else is an UnknownCredentialClass (fail loud) so creds can't silently fall through.
//
// Pure classification + a resolver that returns a typed outcome the runner turns into either
// a hard error (infra) or an approval-pause (client). No secret values are logged.

export type CredentialClass = "infra" | "client" | "unknown";

const INFRA_PREFIX = "AGENTIC_";
const CLIENT_PREFIX = "CLIENT_";

/** Tenant slug → the underscore/uppercase form used in CLIENT_<SLUG>_ keys. */
export function tenantCredToken(tenantSlug: string): string {
  return tenantSlug.trim().toUpperCase().replace(/[-\s]+/g, "_");
}

/** Classify a credential key by its prefix. */
export function classifyCredential(key: string): CredentialClass {
  if (key.startsWith(INFRA_PREFIX)) return "infra";
  if (key.startsWith(CLIENT_PREFIX)) return "client";
  return "unknown";
}

/** For a CLIENT_<TENANT>_<NAME> key, the tenant token + bare credential name (or null). */
export function parseClientCredential(key: string): { tenantToken: string; name: string } | null {
  if (!key.startsWith(CLIENT_PREFIX)) return null;
  const rest = key.slice(CLIENT_PREFIX.length);
  const us = rest.indexOf("_");
  if (us <= 0 || us === rest.length - 1) return null;
  return { tenantToken: rest.slice(0, us), name: rest.slice(us + 1) };
}

export type CredResolution =
  | { status: "ok"; value: string }
  | { status: "fail"; reason: string }   // infra/unknown missing → fail loud
  | { status: "pause"; reason: string }; // client missing → pause for human paste-back

/**
 * Resolve a credential, returning the action the runner should take.
 * `lookup(key)` reads the stored value (e.g. vault getSecret) and returns null if absent.
 * Enforces: client-class creds NEVER fall through to infra; unknown class fails loud.
 */
export async function resolveCredential(
  key: string,
  tenantSlug: string,
  lookup: (key: string) => Promise<string | null>,
): Promise<CredResolution> {
  const cls = classifyCredential(key);
  if (cls === "unknown") return { status: "fail", reason: `credential '${key}' matches neither AGENTIC_* nor CLIENT_*` };

  if (cls === "client") {
    const parsed = parseClientCredential(key);
    if (!parsed) return { status: "fail", reason: `malformed client credential key '${key}'` };
    const expected = tenantCredToken(tenantSlug);
    if (parsed.tenantToken !== expected)
      return { status: "fail", reason: `client credential '${key}' is for tenant ${parsed.tenantToken}, not ${expected}` };
    const v = await lookup(key);
    return v != null
      ? { status: "ok", value: v }
      : { status: "pause", reason: `client credential ${key} not yet provided — pausing for human paste-back` };
  }

  // infra
  const v = await lookup(key);
  return v != null ? { status: "ok", value: v } : { status: "fail", reason: `infra credential ${key} missing from vault (fail loud)` };
}
