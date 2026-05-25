// Knowledge (pgvector) integration test.
// Run: DATABASE_URL=... pnpm --filter @agent-os/core exec tsx src/knowledge.test.ts
import { createDb, schema } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";
import { chunkText, hashEmbedder, indexDocument, retrieve } from "./knowledge.js";

let passed = 0,
  failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDb(url);
  const embedder = hashEmbedder();
  const tenantId = TENANT_IDS.acqu;
  const ns = "acqu/test-knowledge";

  console.log("\n[chunking]");
  assert(chunkText("short").length === 1, "short text → 1 chunk");
  const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} about ads and budgets.\n\n`).join("");
  assert(chunkText(long, 400).length > 1, "long text → multiple chunks");

  console.log("\n[indexing]");
  // Clean any docs left in this namespace by a prior aborted run (cascades to chunks).
  for (const stale of await db.select().from(schema.documents).where(eq(schema.documents.vectorNamespace, ns))) {
    await db.delete(schema.documents).where(eq(schema.documents.id, stale.id));
  }
  // Seed three documents on distinct topics.
  const docs = [
    { name: "ads", ns, content: "Meta ad campaign performance: CPA, ROAS, creative testing, budget pacing and prospecting audiences." },
    { name: "churn", ns, content: "Client churn risk: usage decline, negative QBR sentiment, unanswered renewal emails and save plays." },
    { name: "code", ns, content: "Deploying the TypeScript service: docker build, migrations, health checks and rolling restarts." },
  ];
  const ids: Record<string, string> = {};
  for (const d of docs) {
    const [row] = await db
      .insert(schema.documents)
      .values({ tenantId, name: `kt_${d.name}`, type: "markdown", source: "agent-generated", vectorNamespace: ns })
      .returning();
    ids[d.name] = row!.id;
    const n = await indexDocument(db, embedder, { documentId: row!.id, tenantId, content: d.content, vectorNamespace: ns });
    assert(n >= 1, `indexed "${d.name}" (${n} chunk(s))`);
  }
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, ids.ads!));
  assert(doc?.vectorIndexed === true, "document marked vector_indexed");

  console.log("\n[retrieval]");
  // hashEmbedder ranks by lexical overlap (it stands in for a real embedding
  // model), so queries use words present in the target document.
  const hits = await retrieve(db, embedder, { tenantId, query: "Meta ad campaign ROAS creative testing budget pacing prospecting", namespaces: [ns], limit: 3 });
  assert(hits.length >= 1, `retrieval returns hits (${hits.length})`);
  assert(hits[0]?.documentId === ids.ads, "most relevant hit is the ads document");
  assert(hits[0]!.score > (hits[hits.length - 1]?.score ?? 0) - 1e-9, "scores are in descending order");

  const churnHits = await retrieve(db, embedder, { tenantId, query: "client churn risk usage decline renewal save plays sentiment", namespaces: [ns], limit: 1 });
  assert(churnHits[0]?.documentId === ids.churn, "churn query ranks the churn document first");

  // Namespace scoping: a different namespace yields nothing.
  const scoped = await retrieve(db, embedder, { tenantId, query: "ad spend", namespaces: ["acqu/other"], limit: 3 });
  assert(scoped.length === 0, "namespace scoping excludes out-of-scope chunks");

  // Cleanup test docs.
  for (const id of Object.values(ids)) await db.delete(schema.documents).where(eq(schema.documents.id, id));

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
