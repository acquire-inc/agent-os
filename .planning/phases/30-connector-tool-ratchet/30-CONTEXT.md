# Phase 30 — Connector tool ratchet (dispatch-layer injection scrub)

**Triggered by:** Phase 22's autonomy ratchet was wired to `tool.browser` only. The backlog noted that any future `tool.connector.*` should inherit the same defense-in-depth scrub + ratchet.
**Status:** complete

## Delivered

`apps/runner/src/custom-tools.ts` — `dispatchCustomTool` adds a post-handler scrub for any tool that crosses the AgentOS trust boundary:

- `tool.browser` continues to scrub at the handler level (richer, runs against the BrowserToolResult shape)
- ANY `tool.connector.*` (or other tool keys matching the external-trust prefix policy) goes through `scrubToolResult` at the dispatch layer, with the same:
  - Redaction marker pattern
  - Per-category finding emission (severity high for real attacks, medium for steganographic)
  - Autonomy ratchet to `propose` for non-steganographic matches
  - Base64-encoded span preview (WR-12 alignment)

When a `tool.connector.*` handler is eventually registered (operator wires Pipeboard × Meta, Close, Slack, etc. through deterministic adapters), the scrub layer fires automatically without per-tool edits.

## Acceptance ✓

- Typecheck clean
- All runner tests still green
