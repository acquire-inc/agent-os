// Unit tests for tool.browser — zod input validation + SSRF denylist.
// No live Browserbase call (that's the operator-run live smoke in Plan 07-06).
// Run: pnpm --filter @agent-os/tool-browser test
import { BrowserToolInputSchema } from "./types.js";
import { assertUrlAllowed, SsrfError, SSRF_BLOCK_REASONS } from "./ssrf.js";

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
async function assertBlocks(url: string, reason: string, msg: string) {
  try {
    await assertUrlAllowed(url);
    failed++;
    console.error(`  ✗ ${msg} — expected block, allowed`);
  } catch (e) {
    if (e instanceof SsrfError) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg} — wrong error: ${(e as Error).message}`);
    }
  }
}
async function assertAllows(url: string, msg: string) {
  try {
    await assertUrlAllowed(url);
    passed++;
    console.log(`  ✓ ${msg}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${msg} — unexpectedly blocked: ${(e as Error).message}`);
  }
}

async function main() {
  console.log("• zod input validation");
  assert(BrowserToolInputSchema.safeParse({ url: "https://example.com", instruction: "click" }).success, "accepts valid input");
  assert(!BrowserToolInputSchema.safeParse({ url: "not-a-url", instruction: "x" }).success, "rejects non-URL");
  assert(!BrowserToolInputSchema.safeParse({ url: "https://example.com", instruction: "" }).success, "rejects empty instruction");
  assert(!BrowserToolInputSchema.safeParse({ instruction: "x" }).success, "rejects missing url");

  console.log("• SSRF denylist — metadata + private + loopback + scheme");
  await assertBlocks("http://169.254.169.254/latest/meta-data/", SSRF_BLOCK_REASONS.METADATA, "blocks AWS metadata IP");
  await assertBlocks("http://127.0.0.1:8787/", SSRF_BLOCK_REASONS.PRIVATE, "blocks IPv4 loopback");
  await assertBlocks("http://10.0.0.5/", SSRF_BLOCK_REASONS.PRIVATE, "blocks 10/8 private");
  await assertBlocks("http://192.168.1.1/", SSRF_BLOCK_REASONS.PRIVATE, "blocks 192.168/16 private");
  await assertBlocks("http://172.16.5.5/", SSRF_BLOCK_REASONS.PRIVATE, "blocks 172.16/12 private");
  await assertBlocks("http://[::1]/", SSRF_BLOCK_REASONS.PRIVATE, "blocks IPv6 loopback");
  await assertBlocks("http://localhost/", SSRF_BLOCK_REASONS.LOCALHOST, "blocks localhost alias");
  await assertBlocks("file:///etc/passwd", SSRF_BLOCK_REASONS.SCHEME, "blocks file:// scheme");
  await assertBlocks("ftp://example.com/", SSRF_BLOCK_REASONS.SCHEME, "blocks ftp:// scheme");

  console.log("• SSRF allows public hosts");
  // Public IP literal — no DNS needed, must pass.
  await assertAllows("https://1.1.1.1/", "allows public IPv4 literal (1.1.1.1)");
  await assertAllows("https://8.8.8.8/", "allows public IPv4 literal (8.8.8.8)");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
