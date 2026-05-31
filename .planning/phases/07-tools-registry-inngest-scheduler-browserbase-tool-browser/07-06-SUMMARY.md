---
plan: 07-06
phase: 7
status: complete
completed: 2026-05-30
requirements: [SC-7-3]
---
# Plan 07-06 Summary: runner allowedTools + tool.browser dispatch

## Built
- `apps/runner/src/custom-tools.ts`: `deriveAllowedTools(bundle)` builds an explicit
  allowlist from `bundle.tools[]` keys + `bundle.mcpServers[]` names (Pitfall 5 —
  never leave allowedTools unset). `customToolDispatch` maps `tool.browser` →
  `runBrowserTool` (result to file, returns path). `dispatchCustomTool` refuses an
  unbound tool / unregistered handler (defense in depth).
- `apps/runner/src/execute.ts`: liveRun options now include `allowedTools: deriveAllowedTools(b)`.
- `apps/runner/src/api-client.ts`: Bundle gains optional `tools[]` (wire shape).
- `apps/runner/src/browser-smoke.ts`: operator smoke against example.com.
- 6/6 unit tests (allowlist derivation + dispatch guards).

## Verification
12 packages typecheck; runner test 6/6; architect 33/33.

## Operator follow-ups
- `pnpm tsx apps/runner/src/browser-smoke.ts` to smoke the fetch backend.
