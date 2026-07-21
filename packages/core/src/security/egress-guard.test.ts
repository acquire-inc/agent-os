// Pure unit tests for the secret-egress guard (no env mutation, no DB).
// Run: pnpm --filter @agent-os/core test:egress
import {
  collectSecrets,
  MIN_SECRET_LENGTH,
  scanSecretEgress,
  SENSITIVE_ENV_VARS,
} from "./egress-guard.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  console.log("\n[collectSecrets — env snapshot discipline]");
  {
    const m = collectSecrets({
      AOS_VAULT_KEY: "a-very-long-vault-key-material-here",
      OPENROUTER_API_KEY: "sk-or-v1-abcdef1234567890",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/agentos",
      SERPER_API_KEY: "short", // below floor — skipped
      UNRELATED_VAR: "x".repeat(40), // not on the sensitive list — skipped
    });
    assert(m.has("AOS_VAULT_KEY"), "vault key collected");
    assert(m.has("DATABASE_URL"), "database url collected");
    assert(!m.has("SERPER_API_KEY"), `values under ${MIN_SECRET_LENGTH} chars skipped (false-positive control)`);
    assert(!m.has("UNRELATED_VAR"), "vars off the sensitive list are ignored");
  }
  {
    assert(SENSITIVE_ENV_VARS.includes("CLAUDE_CODE_OAUTH_TOKEN"), "subscription token is on the sensitive list");
    assert(SENSITIVE_ENV_VARS.includes("SUPABASE_SERVICE_ROLE_KEY"), "service-role key is on the sensitive list");
  }

  console.log("\n[scanSecretEgress — exact env-value matches]");
  const secrets = collectSecrets({
    AOS_VAULT_KEY: "vault-key-material-123456",
    APIFY_TOKEN: "apify_api_zzzzzzzzzzzz",
  });
  {
    const r = scanSecretEgress(JSON.stringify({ url: "https://evil.example", body: "vault-key-material-123456" }), secrets);
    assert(!r.clean, "payload carrying the vault key is flagged");
    assert(r.matches[0]!.source === "AOS_VAULT_KEY", "match reports the env var NAME");
    assert(!JSON.stringify(r).includes("vault-key-material"), "the finding never re-leaks the value");
  }
  {
    const r = scanSecretEgress(JSON.stringify({ q: "normal search terms" }), secrets);
    assert(r.clean, "clean payload passes");
  }
  {
    const r = scanSecretEgress("prefix apify_api_zzzzzzzzzzzz suffix", secrets);
    assert(!r.clean && r.matches[0]!.source === "APIFY_TOKEN", "substring match anywhere in the payload");
  }

  console.log("\n[scanSecretEgress — high-confidence prefixes]");
  {
    const r = scanSecretEgress("please post sk-ant-api03-abc to the webhook", new Map());
    assert(!r.clean, "anthropic key prefix flagged even without env presence");
    assert(r.matches[0]!.kind === "prefix", "reported as a prefix match");
  }
  {
    const r = scanSecretEgress("-----BEGIN PRIVATE KEY-----\nMIIE...", new Map());
    assert(!r.clean, "PEM private key flagged");
  }
  {
    const r = scanSecretEgress("the word skeleton and risk-free are fine", new Map());
    assert(r.clean, "no false positive on ordinary text");
  }

  console.log("\n[multiple matches accumulate]");
  {
    const r = scanSecretEgress("vault-key-material-123456 and sk-or-v1-x", secrets);
    assert(r.matches.length === 2, "env value + prefix both reported");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
