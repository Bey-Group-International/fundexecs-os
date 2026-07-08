// lib/ingestion/extract.ts
// Structured extraction — turn a fetched HTML page into candidate entities.
// This is the FundExecs-native distillation of the ScrapeGraphAI idea ("point
// an LLM at a page, get structured records back"), wired to the same
// Claude-optional seam every other engine here uses (lib/source-ai.ts): when
// ANTHROPIC_API_KEY is present we ask the model for clean structured output;
// with no key — CI, preview, offline — we fall back to a DETERMINISTIC
// heuristic parser (JSON-LD, <title>, meta description, contact hints). The
// loop always produces something, and the pure parsers are fully unit-testable.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS, isAnthropicTimeout } from "@/lib/anthropic-client";
import type { EntityKind } from "@/lib/sourcing-intel";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// A raw entity candidate lifted from a page, before catalog normalization.
export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  domain?: string | null;
  description?: string | null;
  categories?: string[];
  geography?: string | null;
  /** Where on the page this came from — provenance for auditability. */
  evidence?: string;
}

export interface ExtractInput {
  url: string;
  html: string;
  /** What kind of entity this crawl targets — biases both model and fallback. */
  targetKind: EntityKind;
}

export function extractionLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// PURE — HTML → text/facets (deterministic, unit-testable)
// ---------------------------------------------------------------------------

// Strip tags, script/style bodies, and collapse whitespace. Pure.
export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// The <title>, trimmed of the common " | Site Name" / " - Site" suffix. Pure.
export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const raw = stripHtml(m[1]);
  const cut = raw.split(/\s+[|–—-]\s+/)[0].trim();
  return cut || raw || null;
}

// The meta description / og:description, whichever is present first. Pure.
export function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return stripHtml(m[1]) || null;
  }
  return null;
}

// Parse any application/ld+json blocks and return the objects. Malformed JSON
// is skipped, never thrown. Pure.
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && typeof node === "object") out.push(node as Record<string, unknown>);
      }
    } catch {
      // Skip malformed JSON-LD — extraction is best-effort.
    }
  }
  return out;
}

// Pull an Organization-ish record out of JSON-LD if present (schema.org). The
// most reliable structured signal a site can give us. Pure.
export function organizationFromJsonLd(
  nodes: Record<string, unknown>[],
): { name: string; description?: string; geography?: string } | null {
  for (const node of nodes) {
    const type = node["@type"];
    const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
    if (!types.some((t) => /organization|corporation|localbusiness|company/i.test(t))) continue;
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (!name) continue;
    const description = typeof node.description === "string" ? node.description.trim() : undefined;
    let geography: string | undefined;
    const addr = node.address;
    if (addr && typeof addr === "object") {
      const a = addr as Record<string, unknown>;
      geography =
        [a.addressLocality, a.addressRegion, a.addressCountry].filter((x) => typeof x === "string").join(", ") ||
        undefined;
    }
    return { name, description, geography: geography || undefined };
  }
  return null;
}

// The registrable-ish host of a URL, lower-cased, sans "www.". Pure.
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// A light, deterministic categorizer: keyword → facet tags over page text.
// Not trying to be clever — just enough structure for downstream fit scoring.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  saas: ["saas", "software", "platform", "cloud"],
  fintech: ["fintech", "payments", "banking", "lending", "wallet"],
  healthcare: ["health", "clinical", "medical", "biotech", "pharma"],
  manufacturing: ["manufacturing", "industrial", "factory", "supply chain"],
  ecommerce: ["ecommerce", "e-commerce", "retail", "marketplace"],
  services: ["consulting", "services", "agency", "advisory"],
  energy: ["energy", "solar", "renewable", "oil", "gas"],
  realestate: ["real estate", "property", "reit"],
};

export function guessCategories(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw))) hits.push(cat);
  }
  return hits.slice(0, 6);
}

/**
 * Deterministic extraction from a single page: prefer JSON-LD, then fall back
 * to <title> + meta description. Returns at most one entity per page (the page
 * subject). Pure — no model, no network.
 */
export function heuristicExtract(input: ExtractInput): ExtractedEntity[] {
  const jsonld = organizationFromJsonLd(extractJsonLd(input.html));
  const title = extractTitle(input.html);
  const metaDesc = extractMetaDescription(input.html);
  const bodyText = stripHtml(input.html).slice(0, 4000);

  const name = jsonld?.name || title;
  if (!name) return [];

  const description = jsonld?.description || metaDesc || null;
  const categories = guessCategories(`${name} ${description ?? ""} ${bodyText}`);

  return [
    {
      kind: input.targetKind,
      name,
      domain: domainOf(input.url),
      description,
      categories,
      geography: jsonld?.geography ?? null,
      evidence: jsonld ? "schema.org/Organization" : "title+meta",
    },
  ];
}

// ---------------------------------------------------------------------------
// Claude-optional structured extraction
// ---------------------------------------------------------------------------

// Parse the model's JSON array reply, tolerating prose or code fences around it.
function parseModelEntities(raw: string, input: ExtractInput): ExtractedEntity[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const domain = domainOf(input.url);
  return arr
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e) => ({
      kind: (typeof e.kind === "string" ? e.kind : input.targetKind) as EntityKind,
      name: typeof e.name === "string" ? e.name.trim() : "",
      domain: typeof e.domain === "string" ? e.domain : domain,
      description: typeof e.description === "string" ? e.description : null,
      categories: Array.isArray(e.categories) ? e.categories.filter((c): c is string => typeof c === "string") : [],
      geography: typeof e.geography === "string" ? e.geography : null,
      evidence: "model",
    }))
    .filter((e) => e.name);
}

/**
 * Extract entities from a page. Claude-backed when a key is present, with a
 * deterministic heuristic fallback on no-key, timeout, or any model error — so
 * a caller always gets a usable array. Never throws.
 */
export async function extractEntities(input: ExtractInput): Promise<ExtractedEntity[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return heuristicExtract(input);

  const text = stripHtml(input.html).slice(0, 6000);
  const client = anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You extract structured business entities from web page text for a private-markets sourcing catalog. " +
        "Return ONLY a JSON array. Each item: {kind, name, domain, description, categories[], geography}. " +
        `kind must be one of company|investor|fund|advisor|lender|provider (target: ${input.targetKind}). ` +
        "Only include entities the page is actually about. No commentary.",
      messages: [{ role: "user", content: `URL: ${input.url}\n\nPAGE TEXT:\n${text}` }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseModelEntities(raw, input);
    return parsed.length ? parsed : heuristicExtract(input);
  } catch (err) {
    if (isAnthropicTimeout(err)) {
      // Model was slow — the deterministic fallback still yields a record.
    }
    return heuristicExtract(input);
  }
}

export const __test = {
  parseModelEntities,
  CATEGORY_KEYWORDS,
};
