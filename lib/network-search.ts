// lib/network-search.ts
//
// Network search — lexical first, AI second.
//
// This used to block on TWO Claude calls before it could return anything: one
// to parse the query into filters, another to write a reason line per result.
// Every keystroke-driven search paid both, and the results themselves came from
// an ILIKE built by concatenating the model's extracted terms into a PostgREST
// `.or()` string — so a term containing a comma or a parenthesis did not match
// literally, it rewrote the filter expression.
//
// Now the search itself is Postgres: ranked full-text over the `fts` column
// (added in 20260702000300 and, until this, never queried) with trigram
// similarity as the fallback for misspellings, all inside the
// search_network_contacts function so the terms travel as bound parameters.
// It is fast, it costs nothing, and it works with no API key configured.
//
// The model is still available, but as an explicit second step: rankWithAI()
// annotates results the database already found. Nothing waits on it to render.

import { anthropicClient } from "@/lib/anthropic-client";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { recordNetworkAudit } from "@/lib/network-audit";

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
  stage?: string | null;
  capitalRole?: string | null;
  lastActivityAt?: string | null;
}

interface SearchRow {
  id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  strength_score: number | null;
  strength_label: string | null;
  capital_role: string | null;
  stage: string | null;
  tags: string[] | null;
  connected_on: string | null;
  last_activity_at: string | null;
  rank: number | null;
}

export interface SearchOptions {
  limit?: number;
  stage?: string | null;
  owner?: string | null;
  capitalRole?: string | null;
  /** Ask the model to write a relevance line per result. Off by default: it
   *  adds a round trip and an API cost to a query the database already
   *  answered. */
  useAI?: boolean;
}

/**
 * 2-hop intro path heuristic: a well-connected contact at the same company
 * bridges to a colder one.
 */
function buildSimpleIntroPath(target: SearchRow, all: SearchRow[]): string[] | null {
  const name = target.full_name ?? target.id;
  if ((target.strength_score ?? 0) >= 60) return ["You", name];

  const bridge = all.find(
    (c) =>
      c.id !== target.id &&
      c.company &&
      target.company &&
      c.company.toLowerCase() === target.company.toLowerCase() &&
      (c.strength_score ?? 0) >= 50,
  );
  return bridge ? ["You", bridge.full_name ?? bridge.id, name] : null;
}

/** The default reason line — stated in terms of what actually matched, rather
 *  than the model's paraphrase of the query. */
function lexicalReason(row: SearchRow, query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return "In your network";
  if (row.full_name?.toLowerCase().includes(q)) return "Name matches your search";
  if (row.company?.toLowerCase().includes(q)) return `At ${row.company}`;
  if (row.title?.toLowerCase().includes(q)) return row.title;
  if (row.location?.toLowerCase().includes(q)) return `Based in ${row.location}`;
  if (row.tags?.some((t) => t.toLowerCase().includes(q))) return "Tagged for this";
  return [row.title, row.company].filter(Boolean).join(" · ") || "Matches your search";
}

function toResult(row: SearchRow, rows: SearchRow[], query: string): NetworkSearchResult {
  return {
    id: row.id,
    fullName: row.full_name ?? "",
    title: row.title,
    company: row.company,
    location: row.location,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    avatarUrl: row.avatar_url,
    strengthScore: row.strength_score ?? 0,
    strengthLabel: row.strength_label ?? "cold",
    connectedOn: row.connected_on,
    relevanceReason: lexicalReason(row, query),
    introPath: buildSimpleIntroPath(row, rows),
    stage: row.stage,
    capitalRole: row.capital_role,
    lastActivityAt: row.last_activity_at,
  };
}

/**
 * Ask the model for a one-line reason per result.
 *
 * Runs only when explicitly requested, only over results the database already
 * returned, and never blocks them: on any failure the lexical reasons stand.
 */
export async function annotateWithAI(
  query: string,
  results: NetworkSearchResult[],
): Promise<NetworkSearchResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || results.length === 0) return results;

  try {
    const client = anthropicClient(apiKey);
    const roster = results
      .slice(0, 25)
      .map((r) => `${r.id}|${r.fullName}|${r.title ?? ""}|${r.company ?? ""}|${r.location ?? ""}`)
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
${roster}

Return JSON: {"reasons":{"<id>":"<reason>"}}`,
        },
      ],
    });

    const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    const reasons = (JSON.parse(json) as { reasons?: Record<string, string> }).reasons ?? {};

    return results.map((r) =>
      typeof reasons[r.id] === "string" && reasons[r.id].trim()
        ? { ...r, relevanceReason: reasons[r.id].trim() }
        : r,
    );
  } catch {
    // The database answer is the answer. A model failure costs the prose, not
    // the results.
    return results;
  }
}

/**
 * Search the org's contacts.
 *
 * Returns ranked results from Postgres. RLS — including the private-contact
 * visibility rule — applies inside the function, so a member never sees a
 * relationship they could not open directly.
 */
export async function searchNetwork(
  query: string,
  limitOrOptions: number | SearchOptions = 20,
): Promise<NetworkSearchResult[]> {
  const options: SearchOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  if (!query.trim()) return [];

  const auth = await requireOrgContext();
  if (!auth.ok) return [];
  const { ctx } = auth;

  // network_contacts and the search function are not in database.types.
  const supabase = (await createServerClient()) as any;

  const { data, error } = await supabase.rpc("search_network_contacts", {
    target_org: ctx.orgId,
    query_text: query,
    match_limit: limit,
    stage_filter: options.stage ?? null,
    owner_filter: options.owner ?? null,
    role_filter: options.capitalRole ?? null,
  });

  if (error) {
    console.error("[network-search] rpc failed", error);
    return [];
  }

  const rows = (data ?? []) as SearchRow[];

  // Searching the book is itself an audited act — it is how someone would
  // enumerate an org's relationships, and the query text is the evidence of
  // what they were looking for.
  await recordNetworkAudit(supabase, {
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "search",
    entityType: "network_contact",
    metadata: { query: query.slice(0, 200), results: rows.length },
  });

  const results = rows.map((row) => toResult(row, rows, query));
  return options.useAI ? annotateWithAI(query, results) : results;
}
