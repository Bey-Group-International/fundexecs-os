// lib/chat-enrichment.ts
// Verified contact enrichment for the Earn chat.
//
// PRIME RULE: the chat model must NEVER invent phone numbers or email
// addresses. When a reply references a real company or person, this module
// extracts those entities and looks them up through the Apollo provider
// (lib/integrations/providers/apollo.ts), then formats a "Verified contacts"
// appendix built ONLY from real, provenance-stamped Apollo data. No Apollo key
// or no Apollo hit → nothing is appended. Everything here degrades to "" rather
// than throwing, so it can never break a chat reply.

import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import {
  searchPeople,
  searchOrganizations,
  enrichOrganization,
} from "@/lib/integrations/providers/apollo";
import type { VerifiedPerson, VerifiedCompany } from "@/lib/source-hub-types";

// A fast, cheap model for entity extraction — this runs after every qualifying
// chat reply, so it must not add meaningful latency or cost.
const EXTRACT_MODEL = process.env.CLAUDE_MODEL_FAST || "claude-haiku-4-5-20251001";

// Bounds so a single reply can't fan out into a storm of Apollo calls.
const MAX_PEOPLE = 3;
const MAX_COMPANIES = 2;

export interface ExtractedEntities {
  companies: { name: string; domain: string }[];
  people: { name: string; company: string }[];
}

// Cheap pre-filter: only spend an extraction call when the text plausibly names
// an organization or asks to reach someone. Keeps casual chat ("what's on my
// plate today?") from triggering enrichment.
const ORG_HINT =
  /\b(Capital|Partners|Group|Fund|Ventures|Holdings|Advisors|Advisers|Management|Asset Management|Family Office|REIT|Realty|Bank|Securities|Equity|Credit|LLC|LLP|Inc|Corp|Co\.)\b/;
const REACH_HINT =
  /\b(contact|reach|email|phone|number|introduce|intro|connect|get in touch|who (runs|leads|is|are|should)|decision[- ]maker|point of contact|reach out|cold outreach)\b/i;

export function mightMentionEntity(text: string): boolean {
  return ORG_HINT.test(text) || REACH_HINT.test(text);
}

const EXTRACT_SYSTEM =
  "You extract the real, named companies and people that an assistant's answer refers to, so their verified contact details can be looked up in a contact database. " +
  "Include ONLY specific, real, identifiable organizations (e.g. 'Blackstone', 'Carlyle Group') and named individuals (e.g. 'Jonathan Gray'). " +
  "EXCLUDE: generic categories ('family offices', 'regional lenders'), asset classes, the operator's own firm, and roles mentioned without a name. " +
  "If the answer names no real, lookupable company or person, return empty arrays. Use an empty string for any field you do not know.";

const ENTITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    companies: {
      type: "array",
      description: "Real, named organizations discussed as identifiable entities.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "The organization's name" },
          domain: { type: "string", description: "Website domain if stated, else empty string" },
        },
        required: ["name", "domain"],
      },
    },
    people: {
      type: "array",
      description: "Real, named individuals discussed in the answer.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Person's full name" },
          company: { type: "string", description: "Their company if known, else empty string" },
        },
        required: ["name", "company"],
      },
    },
  },
  required: ["companies", "people"],
} as const;

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Extract the real, named companies/people an answer refers to.
//
// Two-tier and fully native at the floor:
//   - With no ANTHROPIC_API_KEY (or on any API failure) it degrades to a
//     deterministic, keyless regex extractor rather than returning nothing — so
//     verified contacts still surface without a model call.
//   - With a key it uses the model, then MERGES in the deterministic org-suffix
//     hits (high precision) the model may have missed. Apollo still verifies
//     everything downstream, so a spurious extraction just yields no contact.
export async function extractEntities(
  query: string,
  answer: string,
): Promise<ExtractedEntities> {
  const deterministic = extractEntitiesDeterministic(query, answer);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return deterministic;

  try {
    const anthropic = anthropicClient(apiKey);
    const message = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 600,
      system: [{ type: "text", text: EXTRACT_SYSTEM }],
      output_config: { format: { type: "json_schema", schema: ENTITY_SCHEMA } },
      messages: [{ role: "user", content: `Question:\n${query}\n\nAnswer:\n${answer}` }],
    });
    const raw = textOf(message);
    if (!raw) return deterministic;
    const parsed = JSON.parse(raw) as Partial<ExtractedEntities>;
    // Model result is primary; graft on deterministic companies it missed.
    return mergeEntities(normalizeEntities(parsed), {
      companies: deterministic.companies,
      people: [],
    });
  } catch {
    return deterministic;
  }
}

// Org-name tail words. A capitalized run ending in one of these is almost
// always a real firm — the basis of the keyless extractor's high precision.
const ORG_SUFFIX_WORDS =
  "Capital|Partners|Group|Fund|Funds|Ventures|Holdings|Holding|Advisors|Advisers|Management|Securities|Equities|Equity|Credit|Bancorp|Bank|Realty|Trust|Associates|Global|Financial|LLC|LLP|Inc|Incorporated|Corp|Corporation|Company";
const COMPANY_RE = new RegExp(
  `\\b((?:[A-Z][A-Za-z0-9&.'\\-]+ ){1,4}(?:${ORG_SUFFIX_WORDS}))\\b`,
  "g",
);
// Titlecase first+last (optional middle) — a person candidate. Verified by
// Apollo downstream, so precision here only needs to be reasonable.
const PERSON_RE =
  /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b/g;
// Capitalized words that only lead a name because they start a sentence/clause
// (verbs, articles, pronouns). Stripped from the front of a matched run so
// "Consider Carlyle Group" becomes "Carlyle Group".
const LEADING_STOPWORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "and", "but", "or",
  "our", "their", "his", "her", "its", "we", "they", "you", "he", "she", "it",
  "if", "when", "while", "also", "both", "consider", "contact", "reach", "with",
  "about", "for", "to", "from", "at", "in", "on", "of", "recommend", "try",
  "see", "call", "email", "introduce", "connect", "meet", "check", "ask",
]);

function trimLeadingStopwords(name: string): string {
  const toks = name.split(/\s+/);
  while (toks.length > 1 && LEADING_STOPWORDS.has(toks[0].toLowerCase())) toks.shift();
  return toks.join(" ");
}

// Common Titlecase phrases that look like names/firms but aren't lookupable.
const NAME_STOPWORDS = new Set(
  [
    "Private Equity", "Venture Capital", "Asset Management", "Family Office",
    "Real Estate", "Wealth Management", "Hedge Fund", "Due Diligence",
    "New York", "United States", "San Francisco", "Los Angeles", "Hong Kong",
    "United Kingdom", "Middle East", "North America", "Managing Director",
    "Limited Partner", "General Partner", "Chief Executive", "Executive Officer",
    "Board Member", "Investment Committee", "Cash Flow", "Balance Sheet",
  ].map((s) => s.toLowerCase()),
);

// Deterministic, keyless entity extraction. Pulls capitalized org-suffix names
// and Titlecase person names out of the text, minus a stopword list. Never
// throws; over-extraction is harmless because Apollo verifies every hit.
export function extractEntitiesDeterministic(
  query: string,
  answer: string,
): ExtractedEntities {
  const text = `${query}\n${answer}`;

  const companyNames: string[] = [];
  for (const m of text.matchAll(COMPANY_RE)) {
    companyNames.push(trimLeadingStopwords(m[1].trim()));
  }
  // Drop names wholly contained in a longer matched name (e.g. keep
  // "Apollo Global Management", drop a nested "Global Management").
  const companies = dedupeContained(companyNames)
    .slice(0, MAX_COMPANIES * 2)
    .map((name) => ({ name, domain: "" }));

  const companyText = companyNames.join(" | ").toLowerCase();
  const people: { name: string; company: string }[] = [];
  const seenP = new Set<string>();
  for (const m of text.matchAll(PERSON_RE)) {
    const name = m[1].trim();
    const key = name.toLowerCase();
    if (seenP.has(key)) continue;
    if (NAME_STOPWORDS.has(key)) continue;
    // Skip sentence-leading verbs/articles masquerading as a first name.
    if (LEADING_STOPWORDS.has(name.split(/\s+/)[0].toLowerCase())) continue;
    // Skip fragments of a company name we already captured.
    if (companyText.includes(key)) continue;
    seenP.add(key);
    people.push({ name, company: "" });
    if (people.length >= MAX_PEOPLE * 2) break;
  }

  return normalizeEntities({ companies, people });
}

// Remove names that are a substring of another matched name (case-insensitive),
// keeping the longest form.
function dedupeContained(names: string[]): string[] {
  const uniq = Array.from(new Set(names));
  return uniq.filter(
    (n) =>
      !uniq.some(
        (other) =>
          other !== n && other.toLowerCase().includes(n.toLowerCase()),
      ),
  );
}

// Union two extractions, de-duplicating by lowercased name. `a` wins ties.
function mergeEntities(a: ExtractedEntities, b: ExtractedEntities): ExtractedEntities {
  return normalizeEntities({
    companies: [...a.companies, ...b.companies],
    people: [...a.people, ...b.people],
  });
}

// Defensive normalization + de-duplication of the model's extraction.
function normalizeEntities(raw: Partial<ExtractedEntities>): ExtractedEntities {
  const seenCo = new Set<string>();
  const companies = (Array.isArray(raw.companies) ? raw.companies : [])
    .map((c) => ({ name: String(c?.name ?? "").trim(), domain: String(c?.domain ?? "").trim() }))
    .filter((c) => c.name && !seenCo.has(c.name.toLowerCase()) && seenCo.add(c.name.toLowerCase()));

  const seenP = new Set<string>();
  const people = (Array.isArray(raw.people) ? raw.people : [])
    .map((p) => ({ name: String(p?.name ?? "").trim(), company: String(p?.company ?? "").trim() }))
    .filter((p) => p.name && !seenP.has(p.name.toLowerCase()) && seenP.add(p.name.toLowerCase()));

  return { companies, people };
}

export interface EnrichedContacts {
  people: VerifiedPerson[];
  companies: VerifiedCompany[];
}

// A person is only worth surfacing as a "contact" if we have a real way to
// reach them — an email or a phone number. Everything else is noise.
function isContactable(p: VerifiedPerson): boolean {
  return Boolean(p.email || p.phone);
}

// Look up real contacts for the extracted entities via Apollo. Bounded fan-out;
// each lookup is independent and non-fatal.
export async function enrichEntities(
  entities: ExtractedEntities,
): Promise<EnrichedContacts> {
  const people = entities.people.slice(0, MAX_PEOPLE);
  const companies = entities.companies.slice(0, MAX_COMPANIES);

  // Named people → direct person search (name + company narrows it).
  const personLookups = people.map((p) =>
    searchPeople({ name: p.name, company: p.company || undefined, per_page: 1 }),
  );
  // Named companies → the org card PLUS one primary decision-maker to contact.
  const orgLookups = companies.map((c) =>
    enrichOrganization({ name: c.name, domain: c.domain || undefined }),
  );
  const orgContactLookups = companies.map((c) =>
    searchPeople({ company: c.name, per_page: 1 }),
  );

  const [personRes, orgRes, orgContactRes] = await Promise.all([
    Promise.allSettled(personLookups),
    Promise.allSettled(orgLookups),
    Promise.allSettled(orgContactLookups),
  ]);

  const foundPeople: VerifiedPerson[] = [];
  const seen = new Set<string>();
  const pushPerson = (p: VerifiedPerson | undefined) => {
    if (!p || !isContactable(p)) return;
    const key = (p.email || p.name).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    foundPeople.push(p);
  };

  // A failed Apollo lookup returns data of [] (searches) or null (enrich), so
  // reading `.data` is sufficient — no separate success check needed.
  for (const r of personRes) {
    if (r.status === "fulfilled") pushPerson(r.value.data?.[0]);
  }
  for (const r of orgContactRes) {
    if (r.status === "fulfilled") pushPerson(r.value.data?.[0]);
  }

  const foundCompanies: VerifiedCompany[] = [];
  for (const r of orgRes) {
    if (r.status === "fulfilled" && r.value.data) foundCompanies.push(r.value.data);
  }

  return { people: foundPeople, companies: foundCompanies };
}

function pct(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

// Render a person as one contact entry — only fields Apollo actually returned.
function formatPerson(p: VerifiedPerson): string {
  const heading = [p.title, p.company].filter(Boolean).join(", ");
  const lines: string[] = [`**${p.name}**${heading ? ` — ${heading}` : ""}`];
  const reach: string[] = [];
  if (p.phone) reach.push(`📞 ${p.phone}`);
  if (p.email) reach.push(`✉️ ${p.email}`);
  if (p.linkedin_url) reach.push(`[LinkedIn](${p.linkedin_url})`);
  if (reach.length) lines.push(reach.join(" · "));
  lines.push(`_Apollo · confidence ${pct(p.confidence)}_`);
  return lines.join("\n");
}

// Render a company as a compact firm line (website / HQ / industry).
function formatCompany(c: VerifiedCompany): string {
  const facts = [
    c.website || (c.domain ? `https://${c.domain}` : ""),
    c.headquarters,
    c.industry,
  ].filter(Boolean);
  return `**${c.name}**${facts.length ? ` — ${facts.join(" · ")}` : ""}\n_Apollo · confidence ${pct(c.confidence)}_`;
}

// Build the markdown appendix. Returns "" when there is nothing verified to add.
export function formatContactAppendix(enriched: EnrichedContacts): string {
  const blocks: string[] = [];
  for (const p of enriched.people) blocks.push(formatPerson(p));
  for (const c of enriched.companies) blocks.push(formatCompany(c));
  if (blocks.length === 0) return "";
  return `\n\n---\n\n**Verified contacts** · source: Apollo.io\n\n${blocks.join("\n\n")}`;
}

// --- Sourcing / discovery intent -------------------------------------------
// A query like "source family offices near me" or "find private credit lenders
// in Texas" names a CATEGORY of firm, not a specific one — the reply model
// won't (and shouldn't) invent real firms, so name-drop enrichment finds
// nothing. This path instead runs an Apollo directory search for matching firms
// and attaches a decision-maker contact to each, so the reply carries real
// websites, phones, emails, and point-of-contact names.

// How many firms a sourcing reply surfaces, each with one point of contact.
const MAX_SOURCED_FIRMS = 10;

// Senior titles we try to attach as a firm's point of contact, best-first.
const POC_TITLES = [
  "Managing Partner", "Managing Director", "Partner", "Principal",
  "Chief Investment Officer", "Founder", "President", "Head of Investments",
];

// Category phrase in the query → the Apollo keyword tag to search on.
const SOURCING_TARGETS: { re: RegExp; keyword: string }[] = [
  { re: /\bfamily offices?\b/i, keyword: "family office" },
  { re: /\bwealth (managers?|management)\b/i, keyword: "wealth management" },
  { re: /\b(registered investment advis(?:o|e)rs?|RIAs?)\b/i, keyword: "registered investment advisor" },
  { re: /\bendowments?\b/i, keyword: "endowment" },
  { re: /\bfoundations?\b/i, keyword: "foundation" },
  { re: /\bpensions?\b/i, keyword: "pension fund" },
  { re: /\b(private equity|PE (firms?|funds?|shops?)|sponsors?)\b/i, keyword: "private equity" },
  { re: /\b(venture capital|VC (firms?|funds?))\b/i, keyword: "venture capital" },
  { re: /\bhedge funds?\b/i, keyword: "hedge fund" },
  { re: /\bprivate credit\b|\bcredit (funds?|firms?|managers?|providers?)\b/i, keyword: "private credit" },
  { re: /\blenders?\b/i, keyword: "lending" },
  { re: /\bbanks?\b/i, keyword: "bank" },
  { re: /\basset managers?\b/i, keyword: "asset management" },
  { re: /\bfund of funds\b/i, keyword: "fund of funds" },
  { re: /\bsovereign wealth funds?\b/i, keyword: "sovereign wealth fund" },
  { re: /\b(insurers?|insurance (companies|firms))\b/i, keyword: "insurance" },
  { re: /\b(limited partners?|LPs?|allocators?|institutional investors?)\b/i, keyword: "institutional investor" },
  { re: /\b(m&a|investment) (advisors?|advisers?|bankers?)\b/i, keyword: "investment banking" },
  { re: /\b(business )?brokers?\b/i, keyword: "business broker" },
];

// Verbs/framings that mark a discovery ask (vs. a definitional question).
const SOURCING_VERB =
  /\b(source|sourcing|find|identify|prospect|research|scout|discover|surface|build (me )?a? ?list|list|show me|get me|look for|who (are|runs)|which (firms|funds|offices|investors|lenders|lps))\b/i;

const NEAR_ME = /\bnear me\b|\bnearby\b|\bin my (area|region|market)\b/i;

export interface SourcingSpec {
  keywords: string[];
  location?: string;
}

// Pull an explicit place out of "in/near/around <Place>" — but not "near me"
// (that resolves to the mandate geographies) or generic words.
function parseLocation(query: string): string | undefined {
  const m = query.match(
    /\b(?:in|near|around|based in|located in|across)\s+([A-Za-z][\w.\-]+(?:\s+[A-Za-z][\w.\-]+){0,2})/,
  );
  if (!m) return undefined;
  const loc = m[1].trim();
  if (/^(me|my|the|us|our|your|this|that|a|an)\b/i.test(loc)) return undefined;
  // Don't mistake a trailing category word ("...in private credit") for a place.
  if (SOURCING_TARGETS.some((t) => t.re.test(loc))) return undefined;
  return loc;
}

// Detect a sourcing/discovery intent. Returns the category keyword(s) + any
// explicit location, or null when the query isn't asking to source firms.
export function detectSourcingIntent(query: string): SourcingSpec | null {
  const targets = SOURCING_TARGETS.filter((t) => t.re.test(query));
  if (targets.length === 0) return null;
  const location = parseLocation(query);
  // Require an explicit sourcing verb or a location cue so "what is a family
  // office?" doesn't trigger a directory search.
  if (!SOURCING_VERB.test(query) && !location && !NEAR_ME.test(query)) return null;
  return { keywords: Array.from(new Set(targets.map((t) => t.keyword))), location };
}

export interface SourcedFirm {
  firm: VerifiedCompany;
  contact?: VerifiedPerson;
}

// Search Apollo for firms matching the sourcing spec and attach a senior point
// of contact to each. Location precedence: explicit query location → the org's
// mandate geographies → nationwide. Bounded fan-out; never throws.
export async function sourceFirmsWithContacts(
  spec: SourcingSpec,
  geographies: string[] = [],
): Promise<SourcedFirm[]> {
  const locations = spec.location ? [spec.location] : geographies.slice(0, 3);
  const orgRes = await searchOrganizations({
    keywords: spec.keywords,
    locations: locations.length ? locations : undefined,
    per_page: MAX_SOURCED_FIRMS,
  });
  const firms = (orgRes.data ?? []).slice(0, MAX_SOURCED_FIRMS);
  if (firms.length === 0) return [];

  const pocs = await Promise.allSettled(
    firms.map((f) => searchPeople({ company: f.name, title: POC_TITLES, per_page: 1 })),
  );
  return firms.map((firm, i) => {
    const r = pocs[i];
    const contact = r.status === "fulfilled" ? r.value.data?.[0] : undefined;
    return { firm, contact };
  });
}

// Render one firm + its point of contact — only fields Apollo returned.
function formatSourcedFirm(s: SourcedFirm): string {
  const facts = [
    s.firm.website || (s.firm.domain ? `https://${s.firm.domain}` : ""),
    s.firm.headquarters,
    s.firm.industry,
  ].filter(Boolean);
  const lines = [`**${s.firm.name}**${facts.length ? ` — ${facts.join(" · ")}` : ""}`];
  const c = s.contact;
  if (c?.name) {
    const reach: string[] = [];
    if (c.phone) reach.push(`📞 ${c.phone}`);
    if (c.email) reach.push(`✉️ ${c.email}`);
    if (c.linkedin_url) reach.push(`[LinkedIn](${c.linkedin_url})`);
    lines.push(`↳ **${c.name}**${c.title ? `, ${c.title}` : ""}${reach.length ? ` · ${reach.join(" · ")}` : ""}`);
  }
  lines.push(`_Apollo · confidence ${pct(s.firm.confidence)}_`);
  return lines.join("\n");
}

// The markdown block for a sourcing reply. "" when nothing verified surfaced.
export function formatSourcedFirms(firms: SourcedFirm[]): string {
  const blocks = firms.filter((s) => s.firm?.name).map(formatSourcedFirm);
  if (blocks.length === 0) return "";
  return `\n\n---\n\n**Sourced firms** · verified via Apollo.io\n\n${blocks.join("\n\n")}`;
}

export interface ChatEnrichmentContext {
  // The org's mandate geographies, used to resolve "near me" for sourcing.
  geographies?: string[];
}

// The orchestrator the chat route calls after a reply finishes streaming.
// Handles two paths and appends whichever produced verified data:
//   1. Sourcing/discovery intent → active Apollo directory search for firms.
//   2. Name-drop enrichment → contacts for firms/people the answer referenced.
// Never throws, never fabricates: without an Apollo key it returns "".
export async function buildContactAppendix(
  query: string,
  answer: string,
  context: ChatEnrichmentContext = {},
): Promise<string> {
  if (!process.env.APOLLO_API_KEY) return "";
  const sourcing = detectSourcingIntent(query);
  const nameDrop = mightMentionEntity(`${query}\n${answer}`);
  if (!sourcing && !nameDrop) return "";

  let out = "";
  if (sourcing) {
    try {
      out += formatSourcedFirms(await sourceFirmsWithContacts(sourcing, context.geographies ?? []));
    } catch {
      // Additive — a sourcing failure never breaks the reply.
    }
  }
  try {
    if (nameDrop) {
      const entities = await extractEntities(query, answer);
      if (entities.companies.length || entities.people.length) {
        out += formatContactAppendix(await enrichEntities(entities));
      }
    }
    return out;
  } catch {
    return out;
  }
}
