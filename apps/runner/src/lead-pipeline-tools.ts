// Lead pipeline tool handlers (P3 Discovery + P4 Enrichment + Scoring).
//
// Each handler is a deterministic tool dispatched from the runner. The pure
// per-tool decision logic (matrix, dedupe, suppression, scoring contract)
// lives in @agent-os/core/lead-pipeline; this file is the HTTP + DB I/O
// layer that the agent's PreToolUse gate fronts.
//
// Doctrine constraints:
//   - Every handler is tenant-scoped via ctx.tenantId. DB writes use the
//     scoped tenant; HTTP responses are returned to the agent unchanged.
//   - Missing API keys -> { ok: false, error: "missing API key for ..." }.
//     Never throw on a missing external dep — the agent should log + skip.
//   - Item caps from DISCOVERY_ACTORS clamp the requested limit.
//   - Large external payloads are written to ctx.outputDir (CLAUDE.md
//     non-negotiable #4) and the path is returned to the agent.
//
// The handlers are registered into the runner's customToolDispatch at the
// bottom of custom-tools.ts via Object.assign.
import { schema, type Db } from "@agent-os/db";
import {
  DISCOVERY_ACTORS,
  computeDedupeKey,
  matchesSuppression,
  normalizeDomain,
  normalizeEmail,
  type RawLeadInput,
  type SuppressionEntry,
} from "@agent-os/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CustomToolHandler } from "./custom-tools.js";

// ─── Result envelope ───────────────────────────────────────────────────
//
// The CustomToolHandler contract is `Promise<{ result: unknown }>` — the
// dispatcher unwraps `.result` and returns it to the agent. So our public
// envelope (`{ ok, result } | { ok, error }`) goes INSIDE the contract's
// `.result`. `ok` + `result` makes the response shape agent-readable
// without forcing the agent to do error-vs-success branching by throwing.

type ToolEnvelope<T> = { ok: true; result: T } | { ok: false; error: string };
type ToolReturn<T> = { result: ToolEnvelope<T> };

function envOk<T>(result: T): ToolReturn<T> { return { result: { ok: true, result } }; }
function envErr<T = never>(error: string): ToolReturn<T> { return { result: { ok: false, error } }; }
function badKey(name: string): ToolReturn<never> {
  return envErr(`missing API key — set ${name} in env to enable this tool`);
}

async function writeArtifact<T>(outputDir: string, name: string, body: T): Promise<string> {
  const path = join(outputDir, name);
  await writeFile(path, JSON.stringify(body, null, 2), "utf-8");
  return path;
}

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ─── P3 — Discovery tools ──────────────────────────────────────────────

/**
 * tool.discovery.apify_run_actor — Run an Apify actor synchronously and
 * return the dataset items. Input:
 *   { actor_id: string, input: object, max_items?: number }
 * Output:
 *   { ok, result: { actor_id, items: object[], total_returned, run_id? } }
 *   or { ok: false, error }
 *
 * Caps:
 *   - max_items defaults to and is clamped to the actor's
 *     DISCOVERY_ACTORS[actor].maxItemsPerRun (controls Apify cost).
 *   - 90s HTTP timeout.
 */
export const apifyRunActor: CustomToolHandler = async (input, ctx) => {
  const token = process.env.APIFY_TOKEN;
  if (!token) return badKey("APIFY_TOKEN");

  const { actor_id, input: actorInput, max_items } = input as {
    actor_id: string;
    input?: Record<string, unknown>;
    max_items?: number;
  };
  if (!actor_id || typeof actor_id !== "string") {
    return envErr("actor_id required");
  }

  // Clamp items to the matrix cap. We look up by external id since the agent
  // may pass either the catalog key or the raw "org/name".
  const matrixActor = DISCOVERY_ACTORS.find((a) => a.externalId === actor_id || a.key === actor_id);
  const ceiling = matrixActor?.maxItemsPerRun ?? 100;
  const requested = typeof max_items === "number" && max_items > 0 ? max_items : ceiling;
  const limit = Math.min(requested, ceiling);

  const externalId = matrixActor?.externalId ?? actor_id;
  // Apify supports run-sync with a paginated dataset return; the
  // run-sync-get-dataset-items endpoint waits for the actor to finish and
  // returns the items in one response.
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(externalId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&limit=${limit}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput ?? {}),
    }, 90_000);
  } catch (e) {
    return envErr(`apify network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return envErr(`apify ${res.status}: ${body.slice(0, 200)}`);
  }
  const items: unknown[] = (await res.json().catch(() => null)) as unknown[] ?? [];
  if (!Array.isArray(items)) {
    return envErr("apify returned non-array body");
  }
  // Large payload → write to file, return path + first 5 items as preview.
  const resultPath = await writeArtifact(ctx.outputDir, `apify-${Date.now()}.json`, items);
  return envOk({
    actor_id: externalId,
    total_returned: items.length,
    items_preview: items.slice(0, 5),
    items_path: resultPath,
    capped_at: limit,
  });
};

/**
 * tool.discovery.apollo_search — Apollo people search (B2B by title/industry/headcount).
 * Input: { q_organization_industry_tag_ids?: string[], person_titles?: string[],
 *          person_locations?: string[], organization_num_employees_ranges?: string[],
 *          page?: number, per_page?: number }
 * Output: { ok, result: { contacts: object[], total } }
 */
export const apolloSearch: CustomToolHandler = async (input, ctx) => {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return badKey("APOLLO_API_KEY");
  const params = (input ?? {}) as Record<string, unknown>;
  const perPage = Math.min(Number(params.per_page ?? 25), 100);
  const page = Math.max(1, Number(params.page ?? 1));
  const body = {
    ...params,
    page,
    per_page: perPage,
  };

  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
    }, 60_000);
  } catch (e) {
    return envErr(`apollo network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return envErr(`apollo ${res.status}: ${text.slice(0, 200)}`);
  }
  const payload = (await res.json().catch(() => null)) as { people?: unknown[]; pagination?: { total_entries?: number } } | null;
  const contacts = Array.isArray(payload?.people) ? payload!.people : [];
  const resultPath = await writeArtifact(ctx.outputDir, `apollo-${Date.now()}.json`, payload ?? {});
  return envOk({
    contacts_preview: contacts.slice(0, 5),
    contacts_path: resultPath,
    total: payload?.pagination?.total_entries ?? contacts.length,
    page,
    per_page: perPage,
  });
};

// ─── Supabase wrappers (deterministic typed I/O) ───────────────────────

/**
 * tool.lead.supabase_query — Read leads / icps / suppression_list / lead_events
 * for the current tenant. Input:
 *   { table: 'leads' | 'icps' | 'suppression_list' | 'lead_events',
 *     filter?: Record<string, string|number|boolean|null>, limit?: number }
 * Strict: only these four tables are reachable, and the tenant filter is
 * always applied server-side.
 */
export const supabaseQuery: CustomToolHandler = async (input, ctx) => {
  if (!ctx.tenantId) return envErr("supabase_query requires tenant context");
  const { table, filter, limit } = input as {
    table?: string;
    filter?: Record<string, string | number | boolean | null>;
    limit?: number;
  };
  const cap = Math.min(Math.max(1, Number(limit ?? 50)), 500);

  const db = getDb();
  const rows = await runScopedQuery(db, ctx.tenantId, table ?? "", filter ?? {}, cap);
  if (!rows.ok) return envErr(rows.error);
  return envOk({ table, rows: rows.value, returned: rows.value.length });
};

interface ScopedQueryOk { ok: true; value: unknown[] }
interface ScopedQueryErr { ok: false; error: string }
async function runScopedQuery(
  db: Db,
  tenantId: string,
  table: string,
  filter: Record<string, string | number | boolean | null>,
  cap: number,
): Promise<ScopedQueryOk | ScopedQueryErr> {
  switch (table) {
    case "leads": {
      const where = [eq(schema.leads.tenantId, tenantId)];
      if (typeof filter.status === "string") where.push(eq(schema.leads.status, filter.status));
      if (typeof filter.qualified === "boolean") where.push(eq(schema.leads.qualified, filter.qualified));
      if (typeof filter.icp_id === "string") where.push(eq(schema.leads.icpId, filter.icp_id));
      const rows = await db.select().from(schema.leads).where(and(...where)).limit(cap);
      return { ok: true, value: rows };
    }
    case "icps": {
      const where = [eq(schema.icps.tenantId, tenantId)];
      if (typeof filter.active === "boolean") where.push(eq(schema.icps.active, filter.active));
      const rows = await db.select().from(schema.icps).where(and(...where)).limit(cap);
      return { ok: true, value: rows };
    }
    case "suppression_list": {
      const where = [eq(schema.suppressionList.tenantId, tenantId)];
      if (typeof filter.kind === "string") where.push(eq(schema.suppressionList.kind, filter.kind));
      const rows = await db.select().from(schema.suppressionList).where(and(...where)).limit(cap);
      return { ok: true, value: rows };
    }
    case "lead_events": {
      const where = [eq(schema.leadEvents.tenantId, tenantId)];
      if (typeof filter.lead_id === "string") where.push(eq(schema.leadEvents.leadId, filter.lead_id));
      if (typeof filter.type === "string") where.push(eq(schema.leadEvents.type, filter.type));
      const rows = await db.select().from(schema.leadEvents).where(and(...where)).limit(cap);
      return { ok: true, value: rows };
    }
    default:
      return { ok: false, error: `table '${table}' not readable via supabase_query (allowed: leads, icps, suppression_list, lead_events)` };
  }
}

/**
 * tool.lead.supabase_insert_lead — Insert a single lead. Computes dedupe_key
 * if absent. Checks suppression list. Returns `{ inserted: boolean, lead_id?,
 * dedupe_key, suppressed?, duplicate? }`.
 *
 * Doctrine: dedupe + suppression checks both run server-side so the agent
 * can't bypass them via a malformed prompt.
 */
export const supabaseInsertLead: CustomToolHandler = async (input, ctx) => {
  if (!ctx.tenantId) return envErr("supabase_insert_lead requires tenant context");
  const row = (input as Record<string, unknown>) ?? {};
  const sourceActor = typeof row.source_actor === "string" ? row.source_actor : null;
  if (!sourceActor) return envErr("source_actor required");

  const raw: RawLeadInput = {
    sourceActor,
    sourceQuery: (row.source_query as Record<string, unknown>) ?? null,
    raw: (row.raw as Record<string, unknown>) ?? {},
    firstName: (row.first_name as string) ?? null,
    lastName: (row.last_name as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    title: (row.title as string) ?? null,
    company: (row.company as string) ?? null,
    domain: (row.domain as string) ?? null,
    linkedinUrl: (row.linkedin_url as string) ?? null,
  };
  const providedKey = typeof row.dedupe_key === "string" ? row.dedupe_key : null;
  const dedupeKey = providedKey ?? computeDedupeKey(raw);
  if (!dedupeKey) {
    return envErr("insufficient identity signal — provide email, linkedin_url, or domain+name");
  }

  const db = getDb();

  // Suppression check (server-side; never trusts the agent).
  const suppRows = await db
    .select({ kind: schema.suppressionList.kind, value: schema.suppressionList.value })
    .from(schema.suppressionList)
    .where(eq(schema.suppressionList.tenantId, ctx.tenantId));
  const suppression: SuppressionEntry[] = suppRows.map((r) => ({
    kind: r.kind as SuppressionEntry["kind"],
    value: r.value,
  }));
  if (matchesSuppression(raw, suppression)) {
    return envOk({ inserted: false, suppressed: true, dedupe_key: dedupeKey });
  }

  // INSERT with ON CONFLICT DO NOTHING on (tenant_id, dedupe_key).
  const [inserted] = await db
    .insert(schema.leads)
    .values({
      tenantId: ctx.tenantId,
      icpId: typeof row.icp_id === "string" ? row.icp_id : null,
      dedupeKey,
      status: "new",
      sourceActor,
      sourceQuery: raw.sourceQuery as object | null,
      raw: raw.raw,
      firstName: raw.firstName,
      lastName: raw.lastName,
      email: normalizeEmail(raw.email),
      phone: raw.phone,
      title: raw.title,
      company: raw.company,
      domain: normalizeDomain(raw.domain),
      linkedinUrl: raw.linkedinUrl,
    })
    .onConflictDoNothing({ target: [schema.leads.tenantId, schema.leads.dedupeKey] })
    .returning({ id: schema.leads.id });

  if (!inserted) {
    return envOk({ inserted: false, duplicate: true, dedupe_key: dedupeKey });
  }
  return envOk({ inserted: true, lead_id: inserted.id, dedupe_key: dedupeKey });
};

/**
 * tool.lead.supabase_log_event — Append a lead_events row. Input:
 *   { lead_id: string, type: string, payload?: object }
 */
export const supabaseLogEvent: CustomToolHandler = async (input, ctx) => {
  if (!ctx.tenantId) return envErr("supabase_log_event requires tenant context");
  const { lead_id, type, payload } = input as { lead_id?: string; type?: string; payload?: object };
  if (!lead_id || typeof lead_id !== "string") return envErr("lead_id required");
  if (!type || typeof type !== "string") return envErr("type required");

  const db = getDb();
  // Defense-in-depth: assert the lead belongs to this tenant before logging
  // (otherwise an agent with a stale lead_id could log against another tenant's row).
  const [owner] = await db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(and(eq(schema.leads.id, lead_id), eq(schema.leads.tenantId, ctx.tenantId)))
    .limit(1);
  if (!owner) return envErr("lead_id not visible to this tenant");

  const [evt] = await db
    .insert(schema.leadEvents)
    .values({
      tenantId: ctx.tenantId,
      leadId: lead_id,
      type,
      payload: (payload as object) ?? {},
    })
    .returning({ id: schema.leadEvents.id });
  return envOk({ event_id: evt!.id });
};

// ─── P4 — Enrichment tools ─────────────────────────────────────────────

/**
 * tool.enrich.serper_search — Google search via Serper.dev. Input:
 *   { q: string, num?: number, gl?: string, hl?: string }
 * Output: top organic results + answer_box / knowledge_graph if present.
 */
export const serperSearch: CustomToolHandler = async (input) => {
  const key = process.env.SERPER_API_KEY;
  if (!key) return badKey("SERPER_API_KEY");
  const { q, num, gl, hl } = input as { q?: string; num?: number; gl?: string; hl?: string };
  if (!q) return envErr("q required");

  let res: Response;
  try {
    res = await fetchWithTimeout("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q, num: Math.min(Math.max(1, num ?? 10), 20), gl: gl ?? "us", hl: hl ?? "en" }),
    }, 30_000);
  } catch (e) {
    return envErr(`serper network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return envErr(`serper ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return envOk({
    organic: (j.organic as unknown[])?.slice(0, 10) ?? [],
    knowledge_graph: j.knowledgeGraph ?? null,
    answer_box: j.answerBox ?? null,
  });
};

/**
 * tool.enrich.jina_scrape — Jina Reader. Returns clean text for an URL.
 * Input: { url: string }
 */
export const jinaScrape: CustomToolHandler = async (input, ctx) => {
  // JINA_API_KEY is optional — Jina Reader allows keyless low-volume use.
  const key = process.env.JINA_API_KEY;
  const { url } = input as { url?: string };
  if (!url) return envErr("url required");

  let res: Response;
  try {
    res = await fetchWithTimeout(`https://r.jina.ai/${encodeURI(url)}`, {
      method: "GET",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    }, 45_000);
  } catch (e) {
    return envErr(`jina network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return envErr(`jina ${res.status}: ${t.slice(0, 200)}`);
  }
  const text = await res.text();
  // Large pages → file path back to the agent.
  const path = await writeArtifact(ctx.outputDir, `jina-${Date.now()}.txt`, text);
  return envOk({ url, text_path: path, length: text.length, preview: text.slice(0, 500) });
};

/**
 * tool.enrich.firecrawl_scrape — Firecrawl single-page scrape.
 * Input: { url: string, only_main_content?: boolean }
 */
export const firecrawlScrape: CustomToolHandler = async (input, ctx) => {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return badKey("FIRECRAWL_API_KEY");
  const { url, only_main_content } = input as { url?: string; only_main_content?: boolean };
  if (!url) return envErr("url required");

  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.firecrawl.dev/v0/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, pageOptions: { onlyMainContent: only_main_content ?? true } }),
    }, 60_000);
  } catch (e) {
    return envErr(`firecrawl network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return envErr(`firecrawl ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json().catch(() => null)) as { data?: { content?: string; markdown?: string; metadata?: unknown } } | null;
  const content = j?.data?.markdown ?? j?.data?.content ?? "";
  const path = await writeArtifact(ctx.outputDir, `firecrawl-${Date.now()}.md`, content);
  return envOk({ url, content_path: path, length: content.length, preview: content.slice(0, 500), metadata: j?.data?.metadata ?? null });
};

/**
 * tool.enrich.email_verify — NeverBounce-compatible email verification.
 * Without an API key, falls back to a syntax check + MX lookup is skipped.
 * Output: { ok, result: { email, status, deliverable_score? } }
 */
export const emailVerify: CustomToolHandler = async (input) => {
  const { email } = input as { email?: string };
  if (!email || typeof email !== "string") return envErr("email required");
  const normalized = normalizeEmail(email);
  // Cheap syntax gate first — saves a verifier call on obvious garbage.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(normalized)) {
    return envOk({ email: normalized, status: "invalid", reason: "syntax" });
  }
  const key = process.env.NEVERBOUNCE_API_KEY;
  if (!key) {
    // No verifier configured — return unknown so the agent doesn't auto-mark
    // a valid-looking address as valid without proof.
    return envOk({ email: normalized, status: "unknown", reason: "no_verifier_configured" });
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(key)}&email=${encodeURIComponent(normalized)}`,
      { method: "GET" },
      30_000,
    );
  } catch (e) {
    return envErr(`neverbounce network error: ${(e as Error).message}`);
  }
  if (!res.ok) return envErr(`neverbounce ${res.status}`);
  const j = (await res.json().catch(() => null)) as { result?: string; flags?: string[] } | null;
  // NeverBounce result vocabulary: valid | invalid | disposable | catchall | unknown
  const status = mapVerifierResult(j?.result);
  return envOk({ email: normalized, status, flags: j?.flags ?? [] });
};

function mapVerifierResult(r: string | undefined): "valid" | "invalid" | "risky" | "catchall" | "role" | "unknown" {
  switch (r) {
    case "valid": return "valid";
    case "invalid":
    case "disposable":
      return "invalid";
    case "catchall": return "catchall";
    case "unknown": return "unknown";
    default: return "unknown";
  }
}

/**
 * tool.enrich.phone_validate — numverify-compatible phone lookup. Without an
 * API key, falls back to a digit-count syntax gate.
 * Output: { ok, result: { phone, type, country_code? } }
 */
export const phoneValidate: CustomToolHandler = async (input) => {
  const { phone } = input as { phone?: string };
  if (!phone || typeof phone !== "string") return envErr("phone required");
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.length < 7) return envOk({ phone: digits, type: "invalid", reason: "too_short" });
  const key = process.env.NUMVERIFY_API_KEY;
  if (!key) return envOk({ phone: digits, type: "unknown", reason: "no_validator_configured" });
  let res: Response;
  try {
    // numverify uses http for the free tier; production should pin https.
    res = await fetchWithTimeout(
      `https://apilayer.net/api/validate?access_key=${encodeURIComponent(key)}&number=${encodeURIComponent(digits)}&format=1`,
      { method: "GET" },
      20_000,
    );
  } catch (e) {
    return envErr(`numverify network error: ${(e as Error).message}`);
  }
  if (!res.ok) return envErr(`numverify ${res.status}`);
  const j = (await res.json().catch(() => null)) as { valid?: boolean; line_type?: string; country_code?: string } | null;
  if (!j?.valid) return envOk({ phone: digits, type: "invalid" });
  const type = j.line_type === "mobile" ? "mobile" :
               j.line_type === "landline" ? "landline" :
               j.line_type === "voip" ? "voip" : "unknown";
  return envOk({ phone: digits, type, country_code: j.country_code });
};

/**
 * tool.enrich.dnc_scrub — Check tenant suppression_list for opt-outs.
 * Input: { email?, phone?, domain?, linkedin_url? }
 * Output: { ok, result: { dnc_flag, matches?: [{kind, value, reason}] } }
 */
export const dncScrub: CustomToolHandler = async (input, ctx) => {
  if (!ctx.tenantId) return envErr("dnc_scrub requires tenant context");
  const { email, phone, domain, linkedin_url } = input as {
    email?: string; phone?: string; domain?: string; linkedin_url?: string;
  };
  const db = getDb();
  const rows = await db
    .select({ kind: schema.suppressionList.kind, value: schema.suppressionList.value, reason: schema.suppressionList.reason })
    .from(schema.suppressionList)
    .where(eq(schema.suppressionList.tenantId, ctx.tenantId));
  const suppression: SuppressionEntry[] = rows.map((r) => ({ kind: r.kind as SuppressionEntry["kind"], value: r.value }));
  const match = matchesSuppression(
    { sourceActor: "dnc_scrub", raw: {}, email, phone, domain, linkedinUrl: linkedin_url },
    suppression,
  );
  // Return matched entries so the agent can log a reason.
  let matches: typeof rows = [];
  if (match) {
    matches = rows.filter((r) => {
      if (r.kind === "email" && email && r.value === normalizeEmail(email)) return true;
      if (r.kind === "domain" && domain && r.value === normalizeDomain(domain)) return true;
      if (r.kind === "phone" && phone && r.value === phone.trim()) return true;
      return false;
    });
  }
  return envOk({ dnc_flag: match, matches });
};

// ─── Registry ──────────────────────────────────────────────────────────

/** Lazy-init DB getter — mirrors the pattern used by the rest of custom-tools. */
let _db: Db | null = null;
function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for lead-pipeline tools");
  _db = createDbLazy(url);
  return _db;
}
function createDbLazy(url: string): Db {
  // Re-export of @agent-os/db createDb — kept lazy so the module doesn't
  // require DATABASE_URL at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createDb } = require("@agent-os/db") as typeof import("@agent-os/db");
  return createDb(url);
}

/** All P3/P4 tool handlers, keyed by the public tool key. */
export const LEAD_PIPELINE_TOOLS: Record<string, CustomToolHandler> = {
  "tool.discovery.apify_run_actor": apifyRunActor,
  "tool.discovery.apollo_search": apolloSearch,
  "tool.lead.supabase_query": supabaseQuery,
  "tool.lead.supabase_insert_lead": supabaseInsertLead,
  "tool.lead.supabase_log_event": supabaseLogEvent,
  "tool.enrich.serper_search": serperSearch,
  "tool.enrich.jina_scrape": jinaScrape,
  "tool.enrich.firecrawl_scrape": firecrawlScrape,
  "tool.enrich.email_verify": emailVerify,
  "tool.enrich.phone_validate": phoneValidate,
  "tool.enrich.dnc_scrub": dncScrub,
};
// Suppress unused-import warning on `sql`/`inArray` — keep them imported so
// future extensions (bulk inserts, IN-list filters) can drop in without
// re-jiggering the imports.
void sql; void inArray;
