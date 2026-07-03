import { schema, type Db } from "@agent-os/db";
import { eq, sql } from "drizzle-orm";

const { docChunks, documents } = schema;
export const EMBEDDING_DIM = 1536;

/** Pluggable embedder. Swap in Voyage/OpenAI in production; hashEmbedder is the
 *  zero-dependency default that captures lexical similarity for dev + tests. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  dim: number;
}

/** Deterministic hashed bag-of-words embedder — no API key needed. Shared words
 *  → higher cosine similarity, which is enough for dev and CI. */
export function hashEmbedder(dim = EMBEDDING_DIM): Embedder {
  return {
    dim,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Array<number>(dim).fill(0);
        for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
          let h = 2166136261;
          for (let i = 0; i < tok.length; i++) h = (Math.imul(h ^ tok.charCodeAt(i), 16777619) >>> 0);
          const idx = h % dim;
          v[idx] = (v[idx] ?? 0) + 1;
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}

/** Split text into overlapping chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const para = clean.lastIndexOf("\n\n", end);
      const sentence = clean.lastIndexOf(". ", end);
      const cut = Math.max(para, sentence);
      if (cut > start + maxChars / 2) end = cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (end >= clean.length) break;
  }
  return chunks.filter(Boolean);
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/** Chunk + embed a document's content and store the vectors. Replaces any prior
 *  chunks for the document and marks it indexed. */
export async function indexDocument(
  db: Db,
  embedder: Embedder,
  args: { documentId: string; tenantId: string; content: string; vectorNamespace?: string | null },
): Promise<number> {
  const chunks = chunkText(args.content);
  await db.delete(docChunks).where(eq(docChunks.documentId, args.documentId));
  if (chunks.length === 0) return 0;

  const vectors = await embedder.embed(chunks);
  for (let i = 0; i < chunks.length; i++) {
    await db.execute(sql`
      insert into doc_chunks (document_id, tenant_id, vector_namespace, content, embedding)
      values (${args.documentId}, ${args.tenantId}, ${args.vectorNamespace ?? null}, ${chunks[i]},
              ${toVectorLiteral(vectors[i]!)}::vector)
    `);
  }
  await db.update(documents).set({ vectorIndexed: true, updatedAt: new Date() }).where(eq(documents.id, args.documentId));
  return chunks.length;
}

export interface RetrievedChunk {
  documentId: string;
  content: string;
  vectorNamespace: string | null;
  score: number; // cosine similarity (1 = identical)
}

/** Vector-retrieve the most relevant chunks for a query, scoped to a tenant and
 *  optionally to a set of namespaces (the agent's knowledge_scope). */
export async function retrieve(
  db: Db,
  embedder: Embedder,
  args: { tenantId: string; query: string; namespaces?: string[]; limit?: number },
): Promise<RetrievedChunk[]> {
  const [qvec] = await embedder.embed([args.query]);
  const lit = toVectorLiteral(qvec!);
  const limit = args.limit ?? 5;
  const nsFilter =
    args.namespaces && args.namespaces.length > 0
      ? sql`and vector_namespace in (${sql.join(args.namespaces.map((n) => sql`${n}`), sql`, `)})`
      : sql``;

  const result = await db.execute(sql`
    select document_id, content, vector_namespace,
           1 - (embedding <=> ${lit}::vector) as score
    from doc_chunks
    where tenant_id = ${args.tenantId} and embedding is not null ${nsFilter}
    order by embedding <=> ${lit}::vector
    limit ${limit}
  `);
  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    documentId: r.document_id as string,
    content: r.content as string,
    vectorNamespace: (r.vector_namespace as string | null) ?? null,
    score: Number(r.score),
  }));
}
