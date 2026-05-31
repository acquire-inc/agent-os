---
plan: 07-05
phase: 7
status: complete
completed: 2026-05-30
requirements: [SC-7-3]
---
# Plan 07-05 Summary: @agent-os/tool-browser package

## Built
- `packages/tool-browser/`: workspace package. `BrowserToolInputSchema` (zod:
  url + instruction + optional extractSchema), `runBrowserTool` (validate →
  SSRF-guard → fetch → write to file → return path, non-negotiable #4).
- `src/ssrf.ts` (T-7-03): `assertUrlAllowed` DNS-resolves then BlockList-checks
  every address against cloud-metadata IPs (169.254.169.254), private/loopback/
  link-local v4+v6, localhost aliases, non-http(s) schemes. Brand-new security code.
- `BrowserFetcher` interface for swappable backends (defaultFetcher = Node fetch).
- 15/15 unit tests (zod + SSRF denylist + public-IP allow).

## Scope note
Phase 7 ships the SSRF boundary + the runBrowserTool contract with the Node-fetch
backend. The Browserbase + Stagehand backend lands in Phase 8 when an agent binds
the tool — Stagehand 3.4's V3 class surface is moving, so the dependency footprint
is kept small here (zod only). The handler shape the runner depends on is stable.

## Verification
12 packages typecheck; tool-browser test 15/15.

## Operator follow-ups
- Browserbase + Stagehand backend wiring (Phase 8) + BROWSERBASE_API_KEY/PROJECT_ID
  for JS-rendered pages and agent actions.
