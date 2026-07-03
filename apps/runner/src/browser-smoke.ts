// Live smoke for tool.browser — operator runs this with real config:
//   pnpm tsx apps/runner/src/browser-smoke.ts
// Runs on the default Node-fetch backend. The Browserbase + Stagehand backend
// is a backlog item (see ROADMAP.md Backlog) — wire it when an agent needs
// real-browser rendering and the V3 API surface stabilizes.
import { runBrowserTool } from "@agent-os/tool-browser";

async function main() {
  console.log("▸ tool.browser smoke against https://example.com …");
  const result = await runBrowserTool({
    url: "https://example.com",
    instruction: "fetch the page",
  });
  console.log("✓ smoke complete");
  console.log(`  finalUrl  ${result.finalUrl}`);
  console.log(`  textPath  ${result.textPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ tool.browser smoke FAILED:", err);
  process.exit(1);
});
