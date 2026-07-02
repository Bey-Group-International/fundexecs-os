// Natural-language network search powered by Claude.
// Queries the org-pooled network_contacts table plus existing relationships.
// New tables not in database.types.ts — cast supabase client to bypass strict typing.

import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export interface NetworkSearchResult {
  id: string;
  fullName: string;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  strengthScore: number;
  strengthLabel: string;
  connectedOn: string | null;
  relevanceReason: string;
  introPath: string[] | null;
}

interface ContactRow {
  id: string;
  full_name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  strength_score: number;
  strength_label: string;
  connected_on: string | null;
  notes: string | null;
  tags: string[];
}

// Parse natural language intent into structured filters using Claude.
async function parseQueryIntent(query: string): Promise<{
  roles: string[];
  companies: string[];
  locations: string[];
  industries: string[];
  keywords: string[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { roles: [], companies: [], locations: [], industries: [], keywords: [query] };
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `Extract search intent from this network search query. Return JSON only.

Query: "${query}"

Return: {"roles":[],"companies":[],"locations":[],"industries":[],"keywords":[]}

Rules:
- roles: job titles or functions mentioned (e.g. "VP Sales", "CTO", "family office")
- companies: specific company names
- locations: cities or regions
- industries: sectors (e.g. "fintech", "climate tech", "real estate")
- keywords: any other relevant terms`,
      },
    ],
  });

  try {
    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    return JSON.parse(json);
  } catch {
    return { roles: [], companies: [], locations: [], industries: [], keywords: [query] };
  }
}

// Score why a contact is relevant and generate a reason string.
async function scoreRelevance(
  query: string,
  contacts: ContactRow[],
): Promise<Map<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const map = new Map<string, string>();
  if (!apiKey || contacts.length === 0) {
    contacts.forEach((c) => map.set(c.id, "Matches your search"));
    return map;
  }

  const client = new Anthropic({ apiKey });
  const contactList = contacts
    .map((c) => `${c.id}|${c.full_name}|${c.title ?? ""}|${c.company ?? ""}|${c.location ?? ""}`)
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `For each contact, write a 1-sentence reason why they match this search query.

Query: "${query}"

Contacts (id|name|title|company|location):
${contactList}

Return JSON: {"reasons":{"<id>":"<reason>"}}`,
      },
    ],
  });

  try {
    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    const parsed = JSON.parse(json);
    const reasons = parsed.reasons ?? {};
    contacts.forEach((c) => map.set(c.id, reasons[c.id] ?? "Matches your search"));
  } catch {
    contacts.forEach((c) => map.set(c.id, "Matches your search"));
  }
  return map;
}

// 2-hop intro path heuristic: if a high-strength contact shares the same company, use them as a bridge.
function buildSimpleIntroPath(
  target: ContactRow,
  allContacts: ContactRow[],
): string[] | null {
  if ((target.strength_score ?? 0) >= 60) return ["You", target.full_name];

  const bridge = allContacts.find(
    (c) =>
      c.id !== target.id &&
      c.company &&
      target.company &&
      c.company.toLowerCase() === target.company.toLowerCase() &&
      (c.strength_score ?? 0) >= 50,
  );
  if (bridge) return ["You", bridge.full_name, target.full_name];
  return null;
}

export async function searchNetwork(query: string, limit = 20): Promise<NetworkSearchResult[]> {
  if (!query.trim()) return [];

  const auth = await requireOrgContext();
  if (!auth.ok) return [];
  const { ctx } = auth;

  // Cast to any — network_contacts is not yet in database.types.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient() as any;

  const intent = await parseQueryIntent(query);
  const allTerms = [
    ...intent.roles,
    ...intent.companies,
    ...intent.locations,
    ...intent.industries,
    ...intent.keywords,
  ].filter(Boolean);

  let dbQuery = supabase
    .from("network_contacts")
    .select(
      "id, full_name, title, company, location, email, linkedin_url, avatar_url, strength_score, strength_label, connected_on, notes, tags",
    )
    .eq("organization_id", ctx.orgId)
    .limit(limit * 3);

  if (allTerms.length > 0) {
    const conditions = allTerms
      .flatMap((term: string) => [
        `full_name.ilike.%${term}%`,
        `title.ilike.%${term}%`,
        `company.ilike.%${term}%`,
        `location.ilike.%${term}%`,
        `notes.ilike.%${term}%`,
      ])
      .join(",");
    dbQuery = dbQuery.or(conditions);
  }

  const { data: rawContacts } = await dbQuery.order("strength_score", { ascending: false });
  const contacts: ContactRow[] = (rawContacts ?? []) as ContactRow[];
  if (contacts.length === 0) return [];

  const reasons = await scoreRelevance(query, contacts.slice(0, limit));

  return contacts.slice(0, limit).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    title: c.title,
    company: c.company,
    location: c.location,
    email: c.email,
    linkedinUrl: c.linkedin_url,
    avatarUrl: c.avatar_url,
    strengthScore: c.strength_score ?? 0,
    strengthLabel: c.strength_label ?? "cold",
    connectedOn: c.connected_on,
    relevanceReason: reasons.get(c.id) ?? "Matches your search",
    introPath: buildSimpleIntroPath(c, contacts),
  }));
}
