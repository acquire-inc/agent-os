#!/usr/bin/env tsx
// First-run setup wizard.
//
// Goal: take an operator from a fresh clone to a working .env in under 2
// minutes. Asks for OpenRouter key (the one required value), generates
// AOS_VAULT_KEY automatically, leaves Supabase + Inngest blank with clear
// next-step pointers. No-op if .env already exists (won't overwrite without
// --force).
//
// Usage:
//   pnpm setup            # interactive, writes .env from template + answers
//   pnpm setup --force    # overwrite existing .env
//   pnpm setup --check    # just validate current .env, don't prompt

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output, argv, exit } from "node:process";

// CR-05: readline's default echoes every keystroke. Pasted secrets (OpenRouter
// keys, DB passwords, service-role keys) end up in the shell scrollback,
// tmux/screen logs, and any session recorder. secretQuestion masks input by
// overriding `output._writeToOutput` with a "*" muter for the duration of one
// question — the same pattern inquirer uses. We DO NOT log the value;
// `.env` 0600 is the only persistent home for these strings.
async function secretQuestion(rl: Interface, prompt: string): Promise<string> {
  output.write(prompt);
  // The Node typings don't expose _writeToOutput, but every readline
  // interface has it (lib/internal/readline/interface.js). Cast through
  // an internal shape that lets us patch + restore.
  type WriteMuter = { _writeToOutput?: (s: string) => void };
  const muter = rl as unknown as WriteMuter;
  const original = muter._writeToOutput;
  muter._writeToOutput = (s: string) => {
    output.write(s === "\n" || s === "\r\n" ? s : "*");
  };
  try {
    const answer = await rl.question("");
    return answer;
  } finally {
    muter._writeToOutput = original;
    output.write("\n");
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const ENV_PATH = join(REPO_ROOT, ".env");
const TEMPLATE_PATH = join(REPO_ROOT, ".env.example");

const FORCE = argv.includes("--force");
const CHECK_ONLY = argv.includes("--check");

interface KnownVar {
  key: string;
  required: boolean;
  generator?: () => string;
  /** Human-readable explanation for the operator. */
  hint: string;
}

const KNOWN: KnownVar[] = [
  {
    key: "OPENROUTER_API_KEY",
    required: true,
    hint: "One key gateways Hermes (Architect) + Claude (runner). Mint at https://openrouter.ai/keys",
  },
  {
    key: "ANTHROPIC_API_KEY",
    required: true,
    hint: "Same value as OPENROUTER_API_KEY (gateway mode per CLAUDE.md doctrine).",
  },
  {
    key: "ANTHROPIC_BASE_URL",
    required: true,
    hint: "Should be https://openrouter.ai/api (set automatically).",
  },
  {
    key: "AOS_VAULT_KEY",
    required: true,
    generator: () => randomBytes(32).toString("base64"),
    hint: "Encrypts MCP connector creds. Generated locally.",
  },
  {
    key: "DATABASE_URL",
    required: false,
    hint: "Supabase Postgres URI (Settings → Database → Connection string).",
  },
  {
    key: "VITE_SUPABASE_URL",
    required: false,
    hint: "Supabase Project URL — control plane reads this.",
  },
  {
    key: "VITE_SUPABASE_ANON_KEY",
    required: false,
    hint: "Supabase anon (public) key.",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    required: false,
    hint: "Supabase service-role key — server-only.",
  },
  {
    key: "INNGEST_SIGNING_KEY",
    required: false,
    hint: "Inngest signing key — durable scheduler.",
  },
  {
    key: "INNGEST_EVENT_KEY",
    required: false,
    hint: "Inngest event key.",
  },
];

function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out.set(key, value);
  }
  return out;
}

function buildEnvFromTemplate(answers: Map<string, string>): string {
  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(`.env.example not found at ${TEMPLATE_PATH}`);
  }
  const tmpl = readFileSync(TEMPLATE_PATH, "utf-8");
  const lines = tmpl.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^([A-Z][A-Z0-9_]+)=(.*)$/);
    if (!m) {
      out.push(raw);
      continue;
    }
    const key = m[1]!;
    const defaultValue = m[2] ?? "";
    const answer = answers.get(key);
    if (answer !== undefined) {
      out.push(`${key}=${answer}`);
    } else {
      out.push(`${key}=${defaultValue}`);
    }
  }
  return out.join("\n");
}

function reportCheck(env: Map<string, string>): number {
  let missing = 0;
  console.log("\n[required]");
  for (const v of KNOWN.filter((k) => k.required)) {
    const has = (env.get(v.key) ?? "").length > 0;
    console.log(`  ${has ? "✓" : "✗"} ${v.key}`);
    if (!has) missing++;
  }
  console.log("\n[optional — needed for live DB / scheduler]");
  for (const v of KNOWN.filter((k) => !k.required)) {
    const has = (env.get(v.key) ?? "").length > 0;
    console.log(`  ${has ? "✓" : "○"} ${v.key}`);
  }
  if (missing > 0) {
    console.log(
      `\n${missing} required value(s) missing. Run \`pnpm setup\` to fill them, or edit .env directly.`,
    );
  } else {
    console.log("\n✓ All required values set. The platform can run on demo data + the Architect can dispatch.");
    console.log("  For a live database, fill the Supabase + Inngest keys and follow docs/connect-and-launch.md.");
  }
  return missing;
}

async function main() {
  if (CHECK_ONLY) {
    if (!existsSync(ENV_PATH)) {
      console.log("No .env yet. Run `pnpm setup` to create one.");
      exit(1);
    }
    const env = parseEnvFile(readFileSync(ENV_PATH, "utf-8"));
    exit(reportCheck(env) === 0 ? 0 : 1);
  }

  if (existsSync(ENV_PATH) && !FORCE) {
    console.log(`.env already exists at ${ENV_PATH}`);
    console.log("Running validation instead. Use --force to overwrite.\n");
    const env = parseEnvFile(readFileSync(ENV_PATH, "utf-8"));
    exit(reportCheck(env) === 0 ? 0 : 1);
  }

  console.log("\nAgentOS — first-run setup");
  console.log("  Doctrine: one OpenRouter key gateways everything. Hermes + Claude + Architect.");
  console.log("  This wizard fills required values, leaves optional ones for later.\n");

  const rl = createInterface({ input, output });
  try {
    const answers = new Map<string, string>();

    // Required — OpenRouter key (used twice). Secret prompt: echo masked.
    const orKey = (await secretQuestion(rl, "OPENROUTER_API_KEY (https://openrouter.ai/keys): ")).trim();
    if (!orKey) {
      console.log("\nNo OpenRouter key entered. The platform can still boot in demo mode,");
      console.log("but the Architect (/architect) will return 501 and the runner stays in DRY-RUN.");
      console.log("Re-run `pnpm setup` when you have a key.");
    } else {
      answers.set("OPENROUTER_API_KEY", orKey);
      answers.set("ANTHROPIC_API_KEY", orKey);
    }
    answers.set("ANTHROPIC_BASE_URL", "https://openrouter.ai/api");

    // Auto-generated.
    answers.set("AOS_VAULT_KEY", randomBytes(32).toString("base64"));
    console.log("  ✓ AOS_VAULT_KEY generated locally (32 random bytes, base64).");

    // Optional Supabase — surface the docs path, don't block. The y/N answer
    // is NOT a secret (echo allowed); the URL/keys that follow ARE secrets.
    const wantSupabase = (await rl.question("\nDo you have a Supabase project ready? [y/N]: ")).trim().toLowerCase();
    if (wantSupabase === "y" || wantSupabase === "yes") {
      const dbUrl = (await secretQuestion(rl, "  DATABASE_URL (Supabase Settings → Database → Connection string URI): ")).trim();
      if (dbUrl) answers.set("DATABASE_URL", dbUrl);
      const supaUrl = (await rl.question("  VITE_SUPABASE_URL (Settings → API → Project URL): ")).trim();
      if (supaUrl) answers.set("VITE_SUPABASE_URL", supaUrl);
      const anon = (await secretQuestion(rl, "  VITE_SUPABASE_ANON_KEY (anon public key): ")).trim();
      if (anon) answers.set("VITE_SUPABASE_ANON_KEY", anon);
      const svc = (await secretQuestion(rl, "  SUPABASE_SERVICE_ROLE_KEY (server-only): ")).trim();
      if (svc) answers.set("SUPABASE_SERVICE_ROLE_KEY", svc);
    } else {
      console.log("  → Skipped. UI runs on demo data until DATABASE_URL is set. See docs/connect-and-launch.md.");
    }

    // Write.
    const out = buildEnvFromTemplate(answers);
    writeFileSync(ENV_PATH, out, { mode: 0o600 });
    console.log(`\n✓ Wrote ${ENV_PATH} (mode 0600)`);
    console.log("  → secrets entered with local echo suppressed; raw values exist only in .env (mode 0600).");

    const env = parseEnvFile(out);
    const missing = reportCheck(env);

    console.log("\nNext:");
    console.log("  pnpm dev          # start control plane on http://localhost:3000");
    if (env.get("DATABASE_URL")) {
      // INFO-01: count migrations dynamically so the wizard's pointer stops
      // drifting every time a new 00NN_*.sql lands.
      const migrationCount = readdirSync(join(REPO_ROOT, "supabase/migrations"))
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .length;
      console.log(`  pnpm db:migrate   # push ${migrationCount} migrations to Supabase`);
      console.log("  pnpm seed:acqu-vitals && pnpm seed:phase-1   # seed tenant + agents");
      console.log("  pnpm verify:isolation-live   # hard gate #2 (live RLS check)");
    } else {
      console.log("  → For a live DB: provision Supabase, re-run `pnpm setup --force`, then `pnpm db:migrate`.");
    }
    console.log("  docs/connect-and-launch.md   # full setup walkthrough");

    exit(missing > 0 ? 1 : 0);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error("setup failed:", e?.message ?? e);
  exit(2);
});
