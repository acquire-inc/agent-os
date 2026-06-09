#!/usr/bin/env bash
# One-command integration verification for Agent OS.
# Requires DATABASE_URL pointing at a Postgres 16 + pgvector instance.
# Resets the schema, applies migrations, seeds, then runs every backend suite,
# the workspace typecheck, and the control-plane build.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a Postgres 16 + pgvector instance}"
export AOS_VAULT_KEY="${AOS_VAULT_KEY:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▸ Resetting schema…"
psql "$DATABASE_URL" -q -c "drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null

echo "▸ Migrating + seeding…"
pnpm --filter @agent-os/db migrate >/dev/null
pnpm --filter @agent-os/db seed >/dev/null

echo "▸ Typecheck (workspace)…"
pnpm -r typecheck >/dev/null

echo "▸ Backend test suites…"
pnpm --filter @agent-os/db test | grep -E "Result:"
pnpm --filter @agent-os/core test | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/knowledge.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/provision.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/model-registry.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/autonomy.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/compliance-ruleset.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/isolation-tester.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/connector-health.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/ad-rules.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/change-discipline.test.ts | grep -E "Result:"
pnpm --filter @agent-os/core exec tsx src/custom-tools.test.ts | grep -E "Result:"
pnpm --filter @agent-os/vault test | grep -E "Result:"
pnpm --filter @agent-os/registry test | grep -E "Result:"
pnpm --filter @agent-os/api test | grep -E "Result:"
pnpm --filter @agent-os/runner test | grep -E "Result:"
# Seed pure-tests (no DB): doctrine parser, record validators, workforce tool, go-live gate.
pnpm --filter @agent-os/seed test | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _schema.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _model-tiering.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _tools.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _connectors.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _skills.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _safety-skills.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx _skill-anatomy.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx author-skill-anatomy.ts --check | grep -E "✓|✗"
pnpm --filter @agent-os/seed exec tsx _evals.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx readiness.test.ts | grep -E "Result:|READY"
# Coverage gate: every SKILL.md must declare allowed-tools (least-privilege operationalized).
pnpm --filter @agent-os/seed exec tsx author-allowed-tools.ts --check | grep -E "✓|✗"
pnpm --filter @agent-os/seed exec tsx _workforce-tools.test.ts | grep -E "Result:"
pnpm --filter @agent-os/seed exec tsx verify-golive.test.ts | grep -E "Result:"

echo "▸ Control-plane build…"
pnpm --filter control-plane build >/dev/null && echo "  build ok"

echo "✓ All verification passed."
