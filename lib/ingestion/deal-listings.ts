// lib/ingestion/deal-listings.ts
// Marketplace-aware deal-listing parser. Turns a fetched (or pasted) listing /
// search-results page from a business-for-sale or CRE marketplace into
// structured DealListing records ready to land in the `deals` pipeline.
//
// This is the deal-native sibling of extract.ts (which lifts a single generic
// Organization per page). Listing pages are different: one page can carry many
// listings (search results), and each listing has FINANCIALS — asking price,
// cash flow / SDE, revenue, EBITDA, cap rate — plus a broker contact. We pull
// those out deterministically:
//
//   1. schema.org JSON-LD  (Product / Offer / RealEstateListing / ItemList) —
//      the most reliable signal these SEO-heavy marketplaces emit, and the one
//      that yields many listings from a single search page.
//   2. labeled-text heuristics  ("Asking Price: $1.25M", "Cash Flow: $320K") —
//      the fallback for a single detail page with no clean JSON-LD.
//
// Supported marketplaces: LoopNet, Crexi, BizBuySell, BusinessesForSale,
// Transworld. Unknown hosts still parse via the generic path (`source:
// "generic"`). Everything here is PURE and side-effect-free — no network, no
// model — so it is fully unit-testable; the Claude-assisted path lives behind
// the same keyless-fallback seam as extract.ts, in `parseListingsSmart`.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS, isAnthropicTimeout } from "@/lib/anthropic-client";
import { extractJsonLd, extractTitle, extractMetaDescription, stripHtml, domainOf } from "@/lib/ingestion/extract";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export type MarketplaceKey =
  | "loopnet"
  | "crexi"
  | "bizbuysell"
  | "businessesforsale"
  | "transworld"
  | "generic";

interface MarketplaceDef {
  key: MarketplaceKey;
  label: string;
  /** Hostname fragments that identify the marketplace. */
  hosts: string[];
  /** Default asset_class when a listing's own category is unknown. */
  assetClass: string;
}

// The top networks we parse natively. Order matters only for the (rare) host
// that matches more than one fragment; first win.
export const MARKETPLACES: MarketplaceDef[] = [
  { key: "loopnet", label: "LoopNet", hosts: ["loopnet.com"], assetClass: "commercial_real_estate" },
  { key: "crexi", label: "Crexi", hosts: ["crexi.com"], assetClass: "commercial_real_estate" },
  { key: "bizbuysell", label: "BizBuySell", hosts: ["bizbuysell.com"], assetClass: "business" },
  { key: "businessesforsale", label: "BusinessesForSale", hosts: ["businessesforsale.com"], assetClass: "business" },
  {
    key: "transworld",
    label: "Transworld",
    hosts: ["tworld.com", "transworldbusinessadvisors.com", "transworld"],
    assetClass: "business",
  },
];

const GENERIC_DEF: MarketplaceDef = { key: "generic", label: "Web", hosts: [], assetClass: "business" };

// A single parsed listing, before it is mapped onto a `deals` row.
export interface DealListing {
  /** Business / property name. */
  name: string;
  /** Which network it came from. */
  source: MarketplaceKey;
  sourceLabel: string;
  /** Canonical listing URL (detail page), when known. */
  url: string | null;
  askingPrice: number | null;
  cashFlow: number | null;
  revenue: number | null;
  ebitda: number | null;
  /** Cap rate as a percentage number (7.5 == 7.5%). CRE listings mainly. */
  capRate: number | null;
  /** City / region / "City, ST". */
  location: string | null;
  /** Industry / property type → maps to asset_class. */
  category: string | null;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Where in the page this came from — provenance for auditability. */
  evidence: string;
}

export interface ParseListingsInput {
  url: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Marketplace identification
// ---------------------------------------------------------------------------

export function marketplaceForUrl(url: string): MarketplaceDef {
  const host = domainOf(url) ?? "";
  for (const m of MARKETPLACES) {
    if (m.hosts.some((h) => host.includes(h))) return m;
  }
  return GENERIC_DEF;
}

// ---------------------------------------------------------------------------
// Money / percent parsing (pure)
// ---------------------------------------------------------------------------

const NO_PRICE = /(contact|call|inquire|undisclosed|withheld|request|price on|tbd|n\/?a|not disclosed)/i;

/**
 * Parse a money string into a whole-dollar number. Handles "$1,250,000",
 * "$1.25M", "$950K", "1.2 million", "USD 1.2mm". Returns null for
 * "Contact for price" / undisclosed / non-numeric input. Pure.
 */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  let s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (!/[0-9]/.test(s)) return null;
  if (NO_PRICE.test(s) && !/[$0-9]/.test(s.replace(NO_PRICE, ""))) return null;
  // Drop thousands separators; keep decimal points and suffix letters.
  s = s.replace(/,/g, "");
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(mm|bn|thousand|million|billion|[kmb])?/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const suffix = (m[2] || "").toLowerCase();
  const mult =
    suffix === "k" || suffix === "thousand" ? 1_000 :
    suffix === "m" || suffix === "mm" || suffix === "million" ? 1_000_000 :
    suffix === "b" || suffix === "bn" || suffix === "billion" ? 1_000_000_000 :
    1;
  const value = n * mult;
  return value > 0 ? Math.round(value) : null;
}

/** Parse "7.5%" → 7.5. Pure. */
export function parsePercent(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : null;
  const m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(String(raw));
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isFinite(n) && n > 0 && n < 100 ? n : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find the numeric/money token that follows a labeled field in visible text.
// Tolerates a short run of separator characters ("Asking Price: ", "SDE — ")
// between the label and the value. Pure.
function valueAfterLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    // Only spaces/punctuation may sit between a label and its value — never
    // letters. That keeps a generic "price" from bridging across intervening
    // words ("…for Price. SDE: $410,000") to the wrong number.
    const re = new RegExp(
      `${escapeRe(label)}\\b[^\\w$%]{0,14}?(\\$?\\s?[0-9][0-9.,]*\\s*(?:mm|bn|thousand|million|billion|[kmb])?%?)`,
      "i",
    );
    const m = re.exec(text);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

const MONEY_LABELS = {
  asking: ["asking price", "asking", "list price", "sale price", "offered at", "offering price", "price"],
  cashFlow: [
    "seller's discretionary earnings",
    "sellers discretionary earnings",
    "discretionary earnings",
    "cash flow",
    "sde",
    "net profit",
    "net income",
  ],
  revenue: ["gross revenue", "annual revenue", "gross income", "gross sales", "revenue", "turnover"],
  ebitda: ["adjusted ebitda", "ebitda"],
} as const;

export interface ListingFinancials {
  askingPrice: number | null;
  cashFlow: number | null;
  revenue: number | null;
  ebitda: number | null;
  capRate: number | null;
}

/** Pull the standard listing financials out of a page's visible text. Pure. */
export function extractFinancials(text: string): ListingFinancials {
  return {
    askingPrice: parseMoney(valueAfterLabel(text, [...MONEY_LABELS.asking])),
    cashFlow: parseMoney(valueAfterLabel(text, [...MONEY_LABELS.cashFlow])),
    revenue: parseMoney(valueAfterLabel(text, [...MONEY_LABELS.revenue])),
    ebitda: parseMoney(valueAfterLabel(text, [...MONEY_LABELS.ebitda])),
    capRate: parsePercent(valueAfterLabel(text, ["cap rate", "capitalization rate"])),
  };
}

// ---------------------------------------------------------------------------
// Contact / location extraction (pure)
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// US-style phone. Kept deliberately conservative to avoid grabbing IDs.
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
// Emails that belong to the platform/assets, not a broker — skip these.
const NON_CONTACT_EMAIL = /(noreply|no-reply|support|privacy|sentry|example|\.png|\.jpg|\.svg|wixpress|godaddy)/i;

export function extractContact(text: string): { name: string | null; email: string | null; phone: string | null } {
  let email: string | null = null;
  const emails = text.match(new RegExp(EMAIL_RE, "gi")) ?? [];
  for (const e of emails) {
    if (!NON_CONTACT_EMAIL.test(e)) { email = e.toLowerCase(); break; }
  }
  const phoneM = PHONE_RE.exec(text);
  const phone = phoneM ? phoneM[0].trim() : null;

  // Broker name after a presenter label — best-effort, capitalized run. Locate
  // the label case-insensitively, then read a capitalized name right after it
  // (the name match stays case-SENSITIVE so we don't grab lowercase words).
  let name: string | null = null;
  const labelM = /(listing agent|listed by|presented by|listing broker|broker|agent|contact)\s*[:\-–—]?\s*/i.exec(text);
  if (labelM) {
    const after = text.slice(labelM.index + labelM[0].length);
    // Capitalized first name + 1-2 more tokens (surname or middle initial).
    // Word tokens end at sentence punctuation so we don't swallow "Doe. Email".
    const nameM = /^([A-Z][a-z'-]+(?:\s+[A-Z](?:[a-z'-]+|\.)){1,2})/.exec(after);
    if (nameM) name = nameM[1].trim();
  }
  return { name, email, phone };
}

// A "City, ST" or "City, State" phrase from free text. Pure, best-effort.
export function extractLocationText(text: string): string | null {
  const labeled = /(?:location|address|located in|city)\b[^a-z0-9]{0,6}([A-Z][a-zA-Z.\s]+,\s*[A-Z]{2}\b)/.exec(text);
  if (labeled) return labeled[1].replace(/\s+/g, " ").trim();
  const bare = /\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?,\s*[A-Z]{2})\b/.exec(text);
  return bare ? bare[1].trim() : null;
}

// ---------------------------------------------------------------------------
// JSON-LD listing extraction (pure)
// ---------------------------------------------------------------------------

const LISTING_TYPE_RE =
  /product|offer|realestatelisting|residence|singlefamilyresidence|apartment|house|store|localbusiness|business|accommodation|place/i;

// Expand @graph containers and ItemList search-result wrappers so a single
// search page yields every listing node it carries. Pure.
function flattenJsonLd(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec["@graph"])) (rec["@graph"] as unknown[]).forEach(visit);
    const list = rec["itemListElement"];
    if (Array.isArray(list)) {
      for (const el of list) {
        if (el && typeof el === "object") visit((el as Record<string, unknown>).item ?? el);
      }
    }
    out.push(rec);
  };
  nodes.forEach(visit);
  return out;
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x ?? ""));
}

function priceFromNode(node: Record<string, unknown>): number | null {
  const offers = node.offers ?? node.offer;
  const off = Array.isArray(offers) ? offers[0] : offers;
  let raw: unknown;
  if (off && typeof off === "object") {
    const o = off as Record<string, unknown>;
    raw = o.price ?? o.lowPrice ?? o.highPrice;
  }
  raw ??= node.price;
  if (raw == null) return null;
  return parseMoney(typeof raw === "number" ? raw : String(raw));
}

function locationFromNode(node: Record<string, unknown>): string | null {
  const addr = node.address ?? node.location;
  if (typeof addr === "string") return addr.trim() || null;
  if (addr && typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    const inner = (a.address && typeof a.address === "object" ? (a.address as Record<string, unknown>) : a);
    const parts = [inner.addressLocality, inner.addressRegion, inner.addressCountry].filter(
      (x) => typeof x === "string" && x,
    );
    if (parts.length) return parts.join(", ");
  }
  const area = node.areaServed;
  if (typeof area === "string") return area.trim() || null;
  return null;
}

function categoryFromNode(node: Record<string, unknown>): string | null {
  const c = node.category ?? node.additionalType;
  if (typeof c === "string") return c.trim() || null;
  if (Array.isArray(c) && typeof c[0] === "string") return String(c[0]).trim() || null;
  return null;
}

function listingsFromJsonLd(html: string, def: MarketplaceDef, url: string): DealListing[] {
  const nodes = flattenJsonLd(extractJsonLd(html));
  const out: DealListing[] = [];
  for (const node of nodes) {
    const types = typesOf(node);
    if (!types.some((t) => LISTING_TYPE_RE.test(t))) continue;
    const name = typeof node.name === "string" ? node.name.trim() : "";
    const price = priceFromNode(node);
    // A listing node must at least name the thing or price it.
    if (!name && price == null) continue;
    const description = typeof node.description === "string" ? node.description.trim() : null;
    const nodeUrl = typeof node.url === "string" && /^https?:\/\//.test(node.url) ? node.url : null;
    out.push({
      name: name || "Untitled listing",
      source: def.key,
      sourceLabel: def.label,
      url: nodeUrl ?? url,
      askingPrice: price,
      cashFlow: null,
      revenue: null,
      ebitda: null,
      capRate: null,
      location: locationFromNode(node),
      category: categoryFromNode(node),
      description: description ? description.slice(0, 1000) : null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      evidence: "schema.org/JSON-LD",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Single-page heuristic (pure) — when there is no usable JSON-LD
// ---------------------------------------------------------------------------

function heuristicListing(html: string, def: MarketplaceDef, url: string): DealListing[] {
  const text = stripHtml(html).slice(0, 12_000);
  const title = extractTitle(html);
  const fin = extractFinancials(text);
  const hasSignal = title || fin.askingPrice != null || fin.cashFlow != null || fin.revenue != null;
  if (!hasSignal) return [];

  const contact = extractContact(text);
  return [
    {
      name: title || "Untitled listing",
      source: def.key,
      sourceLabel: def.label,
      url,
      askingPrice: fin.askingPrice,
      cashFlow: fin.cashFlow,
      revenue: fin.revenue,
      ebitda: fin.ebitda,
      capRate: fin.capRate,
      location: extractLocationText(text),
      category: null,
      description: extractMetaDescription(html)?.slice(0, 1000) ?? null,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      evidence: "title+labels",
    },
  ];
}

// ---------------------------------------------------------------------------
// Public deterministic parser
// ---------------------------------------------------------------------------

// Dedupe by (lower name, url); merge financials so a JSON-LD node (name+price)
// and the labeled-text pass (cash flow/revenue) reinforce each other. Pure.
function mergeDedupe(listings: DealListing[]): DealListing[] {
  const byKey = new Map<string, DealListing>();
  for (const l of listings) {
    const key = `${l.name.trim().toLowerCase()}::${l.url ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, { ...l }); continue; }
    existing.askingPrice ??= l.askingPrice;
    existing.cashFlow ??= l.cashFlow;
    existing.revenue ??= l.revenue;
    existing.ebitda ??= l.ebitda;
    existing.capRate ??= l.capRate;
    existing.location ??= l.location;
    existing.category ??= l.category;
    existing.description ??= l.description;
    existing.contactName ??= l.contactName;
    existing.contactEmail ??= l.contactEmail;
    existing.contactPhone ??= l.contactPhone;
  }
  return [...byKey.values()];
}

// Fill a listing's missing asset_class with the marketplace default. Pure.
function withDefaults(listings: DealListing[], def: MarketplaceDef): DealListing[] {
  return listings.map((l) => ({ ...l, category: l.category || (def.key === "generic" ? null : def.assetClass) }));
}

/**
 * Parse every deal listing out of a marketplace page. Prefers JSON-LD (yields
 * many listings from a search page); falls back to a labeled-text heuristic for
 * a single detail page. Deterministic — no network, no model. Never throws.
 */
export function parseDealListings(input: ParseListingsInput): DealListing[] {
  const def = marketplaceForUrl(input.url);
  const structured = listingsFromJsonLd(input.html, def, input.url);

  let collected: DealListing[];
  if (structured.length >= 2) {
    // A multi-listing (search) page: page-level labeled financials don't map to
    // any single listing, so trust the structured nodes as-is.
    collected = structured;
  } else if (structured.length === 1) {
    // A detail page with one structured node: the labeled-text pass reinforces
    // it (cash flow / revenue / cap rate / broker the node omitted). The node's
    // canonical URL can differ from the browsing URL, so merge by position.
    const base = { ...structured[0] };
    const h = heuristicListing(input.html, def, input.url)[0];
    if (h) {
      base.askingPrice ??= h.askingPrice;
      base.cashFlow ??= h.cashFlow;
      base.revenue ??= h.revenue;
      base.ebitda ??= h.ebitda;
      base.capRate ??= h.capRate;
      base.location ??= h.location;
      base.description ??= h.description;
      base.contactName ??= h.contactName;
      base.contactEmail ??= h.contactEmail;
      base.contactPhone ??= h.contactPhone;
    }
    collected = [base];
  } else {
    collected = heuristicListing(input.html, def, input.url);
  }

  return withDefaults(mergeDedupe(collected), def).filter(
    (l) => (l.name && l.name !== "Untitled listing") || l.askingPrice != null,
  );
}

// ---------------------------------------------------------------------------
// Deal-row mapping (pure)
// ---------------------------------------------------------------------------

/** Human money for a notes block: $1.25M, $950K, $1,250,000. Pure. */
export function formatMoney(n: number | null | undefined): string | null {
  if (n == null || !isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${(Math.round(m * 100) / 100).toString()}M`;
  }
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/**
 * Compose the structured `notes` block that carries every financial the `deals`
 * table has no dedicated column for. Pure — the single source of truth for how a
 * listing's economics are rendered into a deal. */
export function formatListingNotes(l: DealListing): string {
  const econ: string[] = [];
  const asking = formatMoney(l.askingPrice);
  const cf = formatMoney(l.cashFlow);
  const rev = formatMoney(l.revenue);
  const eb = formatMoney(l.ebitda);
  if (asking) econ.push(`Asking ${asking}`);
  if (cf) econ.push(`Cash Flow ${cf}`);
  if (rev) econ.push(`Revenue ${rev}`);
  if (eb) econ.push(`EBITDA ${eb}`);
  if (l.capRate != null) econ.push(`Cap Rate ${l.capRate}%`);

  const lines: string[] = [];
  if (econ.length) lines.push(econ.join(" · "));
  const meta: string[] = [];
  if (l.location) meta.push(l.location);
  if (l.contactName) meta.push(`Broker: ${l.contactName}`);
  meta.push(`Listed on ${l.sourceLabel}`);
  lines.push(meta.join(" · "));
  if (l.description) lines.push(l.description.slice(0, 400));
  return lines.join("\n");
}

export interface DealRowInput {
  provenance: string;
  name: string;
  stage: "sourced";
  asset_class: string | null;
  geography: string | null;
  target_amount: number | null;
  source: string;
  notes: string;
  url_source: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  verification_note: string | null;
}

/** Map a parsed listing onto the columns of a `deals` insert. Pure. */
export function listingToDealRow(l: DealListing): DealRowInput {
  return {
    provenance: "web_ingest",
    name: l.name.slice(0, 200),
    stage: "sourced",
    asset_class: l.category,
    geography: l.location,
    target_amount: l.askingPrice,
    source: l.sourceLabel,
    notes: formatListingNotes(l),
    url_source: l.url,
    website: l.url,
    contact_name: l.contactName,
    contact_email: l.contactEmail,
    contact_phone: l.contactPhone,
    // The listing URL is the citation an operator confirms the row against.
    verification_note: l.url ? l.url.slice(0, 500) : null,
  };
}

// ---------------------------------------------------------------------------
// Claude-assisted parse (keyless fallback) — messy pages the heuristics miss
// ---------------------------------------------------------------------------

function parseModelListings(raw: string, def: MarketplaceDef, url: string): DealListing[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e) => ({
      name: typeof e.name === "string" ? e.name.trim() : "",
      source: def.key,
      sourceLabel: def.label,
      url: typeof e.url === "string" && /^https?:\/\//.test(e.url) ? e.url : url,
      askingPrice: parseMoney((e.askingPrice ?? e.price) as string | number | null),
      cashFlow: parseMoney((e.cashFlow ?? e.sde) as string | number | null),
      revenue: parseMoney(e.revenue as string | number | null),
      ebitda: parseMoney(e.ebitda as string | number | null),
      capRate: parsePercent(e.capRate as string | number | null),
      location: typeof e.location === "string" ? e.location : null,
      category: typeof e.category === "string" ? e.category : null,
      description: typeof e.description === "string" ? e.description.slice(0, 1000) : null,
      contactName: typeof e.contactName === "string" ? e.contactName : null,
      contactEmail: typeof e.contactEmail === "string" ? e.contactEmail : null,
      contactPhone: typeof e.contactPhone === "string" ? e.contactPhone : null,
      evidence: "model",
    }))
    .filter((l) => l.name);
}

/**
 * Parse listings with Claude when a key is present AND the deterministic pass
 * came up short, else return the deterministic result. Never throws — any model
 * error or timeout degrades to the deterministic listings. */
export async function parseListingsSmart(input: ParseListingsInput): Promise<DealListing[]> {
  const deterministic = parseDealListings(input);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Trust the deterministic parse when it already found priced listings.
  if (!apiKey || deterministic.some((l) => l.askingPrice != null)) return deterministic;

  const def = marketplaceForUrl(input.url);
  const text = stripHtml(input.html).slice(0, 9000);
  const client = anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        "You extract business/property FOR-SALE listings from marketplace page text for an M&A deal pipeline. " +
        "Return ONLY a JSON array. Each item: {name, url, askingPrice, cashFlow, revenue, ebitda, capRate, location, category, description, contactName, contactEmail, contactPhone}. " +
        "Money as plain numbers in dollars (no symbols). Omit a field you cannot find. Only real listings on the page. No commentary.",
      messages: [{ role: "user", content: `URL: ${input.url}\n\nPAGE TEXT:\n${text}` }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = withDefaults(mergeDedupe(parseModelListings(raw, def, input.url)), def);
    return parsed.length ? parsed : deterministic;
  } catch (err) {
    if (isAnthropicTimeout(err)) { /* deterministic fallback below */ }
    return deterministic;
  }
}

export const __test = {
  valueAfterLabel,
  flattenJsonLd,
  mergeDedupe,
  parseModelListings,
  GENERIC_DEF,
};
