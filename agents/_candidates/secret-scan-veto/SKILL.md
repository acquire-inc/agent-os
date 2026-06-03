---
name: secret-scan-veto
description: Use as the first verifier in any deploy, commit, or handoff pipeline. A cheap regex pattern bank runs against staged blobs; a match halts the workflow fail-closed before any other verifier runs. Pairs with the never-inject-client-keys discipline for per-tenant secret provisioning. Advisory attachment for cliently.dev; explicitly not attached to T-critical secrets-rotation.
---
# SKILL: Secret-Scan Veto

A pre-deploy / pre-commit credential scanner that runs FIRST among verifiers — before QA, before code-review, before functional verify — with non-advisory veto authority. A failed scan halts the workflow rather than producing a warning a later step might override. The skill bundles two related disciplines: the pattern-bank scan for committed credentials, and the never-substitute rule for per-tenant secret provisioning that prevents the control-plane's keys from leaking into tenants' runtimes.

Attaches as ADVISORY only to `cliently.dev` (the T-critical code-writing agent reads it to inform planning, but the runner's own T-critical paths govern its actions). Explicitly NOT attached to the T-critical `secrets-rotation` agent — rotation has its own dedicated workflow, and the Phase 11 scope-fence forbids skill attachments to CANT_FAIL agents.

## Purpose

A committed credential in a tenant-deliverable repository is a P0 incident — a single accidental token in a config file puts the operator on an apology call and the tenant on a key-rotation scramble. The structural answer is order plus authority: the scan runs FIRST in the verifier chain (no later verifier can save a tainted artifact), the scan is cheap enough to run on every commit (regex in the hot path, no LLM in the loop), and the scan's verdict is binding (a match halts the workflow, no "warn and ship").

The companion rule — never substitute control-plane keys for missing tenant keys — exists because the inverse failure is even more expensive than the leak. An agent that overwrites a tenant's API key in a secret store with no history (Supabase secrets, most env-var stores in modern deploy platforms) irreversibly destroys the tenant's credential. The destruction is not recoverable, the tenant has to provision a new key with whatever upstream owner issued it, and the time between destruction and replacement is downtime. "BLOCKED, surface to the operator, do not substitute" is the only correct response to a missing tenant key.

## Workflow

1. **Run before any other verifier.** The verifier dispatch order at `apps/runner/src/verify/` (or the equivalent in a tenant's deploy pipeline) puts the scan in position 0. No later verifier runs until the scan returns. Order matters because the failure shape it catches — a committed credential — is one a later verifier might not detect (an output-quality check sees prose, not staged blobs; a functional verifier sees behavior, not the source file).

2. **Scan the staged blob, not the working copy.** The integrity property the scan needs is that the bytes about to enter the durable history are the bytes the scan saw. A working-copy scan can miss a credential that was added to the index but not the working tree; a staged-blob scan reads exactly what the next commit will record. The mechanism: read each staged path via the equivalent of `git show :path` (or the tenant's deploy-pipeline analog) and run the pattern bank against the bytes.

3. **Apply the credential pattern bank, with the placeholder allowlist.** The bank lives in `packages/core/src/safety/pattern-banks.ts` (when it lands as part of Tier 2 b.1 from the audit) and is operator-extensible per tenant. Pattern categories the default bank covers (referenced by NAME, never by VALUE):
   - vendor API tokens: Anthropic, OpenAI, Stripe live-mode, AWS access-key prefixes, GitHub PAT and OAuth, Slack bot/user tokens, OpenRouter, Browserbase
   - generic shapes: JSON Web Tokens (three base64 segments separated by dot), Bearer token headers with long opaque payloads, base64 / hex strings above a length threshold in credential-suggesting contexts, PEM-encoded private key headers
   - file-shape patterns: `.env` style assignments of `*_KEY=`, `*_SECRET=`, `*_TOKEN=` to non-placeholder values
   - connector-specific UUID shapes per tenant configuration (Smartlead, Pipeboard, Close API token format, etc.)
   The placeholder allowlist exempts known non-credentials like documented example values, test fixtures explicitly tagged as fake, and the conventional `your-key-here`-style placeholders. Findings reference key NAMES and pattern categories; the actual matched VALUE is never written to any log, finding payload, or transcript.

4. **On any match, halt the workflow non-advisory.** The runner translates a positive match into a `run.failed` outcome with `finding.recorded` at critical severity. The deploy, commit, or handoff does not proceed. The operator sees the finding in the inbox; the remediation is the agent removing the credential from the staged blob (rewriting history if needed) and re-running the scan. There is no "warn and continue," no "operator override at scan time" — the halt is mechanical.

5. **Run the never-inject check on every per-tenant secret provisioning step.** When an agent is assembling a tenant runtime's environment (writing to `tenants.connector_secrets`, the per-tenant vault file, deploy-platform env-vars, n8n credentials in the tenant's instance), the keys it writes are checked against an explicit exact-name allowlist. The control-plane's own credentials (the keys the runner uses to talk to Anthropic, OpenRouter, Browserbase, etc.) are blocked by name from ever resolving in a tenant runtime — not as the primary value, not as a placeholder, not as a "for now" stopgap. If a tenant credential is missing, drained, or never provisioned, the agent halts and surfaces `approval.requested` with options to provision the credential or abort the deploy; substitution is forbidden.

6. **Run the per-tenant self-test before declaring the scan live.** During tenant onboarding (and on any change to the pattern bank or verifier ordering), the operator stages a fake credential matching one of the bank's patterns. The expected outcome: the scan fires, the workflow halts, the operator confirms the halt-and-rollback path worked end-to-end. If any later verifier fires first, or the workflow proceeds past the scan, the dispatch ordering has regressed and the operator surfaces the regression — claimed-live without a passing self-test is not actually live.

## Rules

- **First in the verifier chain, every time.** A scan that runs after another verifier can be defeated by a verifier-ordering bug; the order is structural, not policy.
- **Cheap regex in the hot path.** No LLM in the scan itself. The LLM-judgment path (supply chain, threat modeling, OWASP coverage) is a separate deeper pass that the operator can invoke when needed; the hot-path scan stays mechanical so it runs on every commit without friction.
- **Veto is non-advisory.** A match halts. The runner does not produce a warning a later step might disregard; the workflow stops, the finding lands, the operator decides the remediation.
- **Reference key NAMES in any log or finding; never the VALUE.** The pattern bank documents what the scan looks for, not what the scan found. Writing a matched credential to any persistence surface (log, finding payload, transcript, summary) is itself a leak.
- **The pattern bank is operator-owned and write-protected.** An agent does not remove a pattern to make its commit pass. The bank lives behind the same write-protect as the eval rubric.
- **No control-plane-key substitution into tenant runtimes, ever.** The temptation is "just to unblock for tonight"; the consequence is the irreversible destruction of the tenant's credential when the substitution overwrites a no-history secret store. The structural answer is halt-and-surface, no exceptions.
- **`.env.example` is a tenant surface, not an exception.** A real credential in `.env.example` is still a credential; the bank scans it the same as `.env`.
- **The pre-commit hook bypass flag is forbidden in tenant work.** Using `--no-verify` to skip the pre-commit secret-scan circumvents the structural protection; the practice is disallowed.
- **For T-critical agents, this skill is read-only doctrine.** `cliently.dev` and equivalents read the skill to inform planning; the runner's own T-critical paths gate their actions. The skill educates without enforcing on the can't-fail set.

## Output contract

The verifier's `run_summaries.highlights`:

```json
{
  "secret_scan": {
    "scanned_files": <int>,
    "matches": [
      { "file": "<path>", "pattern_category": "<category-name>", "redaction_marker_id": "<hash>" }
    ],
    "halt_fired": false,
    "self_test_passed": true,
    "client_key_injection_attempts": [
      { "tenant_id": "<uuid>", "attempted_key_name": "<NAME>", "rejected_at": "allowlist | exact-name | provisioning" }
    ]
  }
}
```

Relay events:
- `finding.recorded` per credential match (category=`access`, severity=`critical`, title=`"committed credential pattern matched"`) — payload references key NAME and pattern category, never the value
- `finding.recorded` per never-inject violation (category=`access`, severity=`critical`, title=`"control-plane credential substitution attempted into tenant runtime"`)
- `autonomy.denied` on the commit, deploy, or handoff that triggered the scan, `rationale = "secret_scan: <pattern_category>"`
- `approval.requested` when never-inject fires and the tenant credential is missing, with options `[provision-credential-now, abort-deploy]`
- `approval.resolved` once the operator answers
- `run.failed` on any unresolved halt — fail-closed, the run does not escalate-then-proceed

The verifier's `summary_text`: `"Secret scan: <N> files scanned, <M> matches, halt=<yes|no>, self-test=<pass|fail>, never-inject violations=<count>."`

For a halt event: `"Secret scan: HALTED on <pattern_category> match in <file>; workflow stopped."`

---

## Provenance (quarantined extraction — DO NOT MERGE)

source_paths:
  - hermes-runtime/skills/agentic/gate-security-auditor-veto/SKILL.md
  - hermes-runtime/skills/agentic/gate-never-inject-client-keys/SKILL.md
license_status: NONE — all-rights-reserved by default (reauthored, never copied)
snapshot_date: 2026-06-02
reauthor_notes: Adopted the runs-first-and-vetoes posture, the cheap-regex-in-hot-path framing, the staged-blob-not-working-copy scan rule, and the self-test discipline from gate-security-auditor-veto.SKILL.md; adopted the halt-and-surface response to missing tenant credentials, the explicit list of tenant runtime surfaces, the irreversible-overwrite failure framing, and the exact-name-allowlist rule for vault provisioning from gate-never-inject-client-keys.SKILL.md. Composed the two doctrines into a single skill — the credential scan and the provisioning discipline are two faces of the same secret-handling posture. Re-authored every sentence in our voice with our architecture references — Relay events from the closed 28-event namespace (`finding.recorded`, `autonomy.denied`, `approval.requested`, `approval.resolved`, `run.failed`), `tenants.connector_secrets` as the per-tenant vault analog, `packages/core/src/safety/pattern-banks.ts` as the pattern-bank slot (Tier 2 b.1 from the audit), and the verifier dispatch order at `apps/runner/src/verify/`. The pattern-category labels are paraphrased — the source's verbatim list of prefixes (`sk-ant-`, `AKIA`, `ghp_`, etc.) is replaced with category names that describe the same scope without literal lifts. Source-specific machinery (`SecurityBlockedError` class name, `agentic-build source_vault` function, the `SHARED_KEYS` allowlist constant, the `CLIENT_<SLUG>_*` slot pattern, the `~/.agentic-vault.env` path, the SEC-05 Smartlead UUID probe name) was left out — our substrate is the connector-secrets table + Nango (when wired) + the tenant's runtime env, not theirs.
bound_to: NONE
swap_decision: pending operator review of docs/plans/SKILLS-EXTRACTION-REPORT.md
