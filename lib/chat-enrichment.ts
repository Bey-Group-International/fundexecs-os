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

// Extract the real, named companies/people an answer refers to. Returns empty
// arrays with no key, on any API error, or when nothing lookupable is named.
export async function extractEntities(
  query: string,
  answer: string,
): Promise<ExtractedEntities> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { companies: [], people: [] };

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
    if (!raw) return { companies: [], people: [] };
    const parsed = JSON.parse(raw) as Partial<ExtractedEntities>;
    return normalizeEntities(parsed);
  } catch {
    return { companies: [], people: [] };
  }
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

// The orchestrator the chat route calls after a reply finishes streaming.
// Query + answer in → a verified contact appendix (or "") out. Never throws,
// never fabricates: without an Apollo key it returns "" immediately.
export async function buildContactAppendix(query: string, answer: string): Promise<string> {
  if (!process.env.APOLLO_API_KEY) return "";
  if (!mightMentionEntity(`${query}\n${answer}`)) return "";
  try {
    const entities = await extractEntities(query, answer);
    if (entities.companies.length === 0 && entities.people.length === 0) return "";
    const enriched = await enrichEntities(entities);
    return formatContactAppendix(enriched);
  } catch {
    return "";
  }
}
