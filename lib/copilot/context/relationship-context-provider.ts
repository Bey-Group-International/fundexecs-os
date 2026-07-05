// lib/copilot/context/relationship-context-provider.ts
// Relationship-aware context for Earn. Retrieves a SCOPED slice of the
// Capital Relationship Graph — never the whole book — ranked by capital
// relevance and relationship strength, and formats it as a prompt block with
// source attribution and confidence so Earn's recommendations always carry
// evidence ("why this contact, based on what, how sure").
//
// Server-side only: takes an RLS-scoped Supabase client, so results are
// tenancy-bounded by construction. Recommendations are Tier-1 (internal);
// any outreach Earn drafts from this context remains approval-gated at
// dispatch (send_outreach, Tier 2 — lib/gates.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, NetworkContact } from "@/lib/supabase/database.types";
import { scoreRelevance } from "@/lib/integrations/professional-network/score-relationship";
import type { CapitalRole } from "@/lib/integrations/professional-network/types";

type Client = SupabaseClient<Database>;

export type RelationshipScope = {
  /** Free-text focus of the active workflow (deal sector, fund thesis, ask). */
  keywords?: string[];
  /** Restrict to specific capital roles (e.g. LP search → limited_partner). */
  capitalRoles?: CapitalRole[];
  /** Max contacts to include (default 8) — keeps the prompt slice small. */
  limit?: number;
};

export type RelationshipContextEntry = {
  contactId: string;
  fullName: string;
  title: string | null;
  company: string | null;
  capitalRole: string;
  relevance: number;
  strength: number;
  strengthLabel: string;
  confidence: number;
  source: string;
  tags: string[];
  lastNote: string | null;
};

export type RelationshipContext = {
  entries: RelationshipContextEntry[];
  /** Prompt-ready block; empty string when there is nothing relevant. */
  promptBlock: string;
};

/**
 * Retrieve the contacts most relevant to the active workflow scope, re-ranked
 * with scope keywords so "who fits this fundraise?" ranks differently from
 * "who can diligence this acquisition?".
 */
export async function getRelationshipContext(
  supabase: Client,
  scope: RelationshipScope = {},
): Promise<RelationshipContext> {
  const limit = Math.max(1, Math.min(20, scope.limit ?? 8));

  let query = supabase
    .from("network_contacts")
    .select(
      "id, full_name, first_name, last_name, title, company, capital_role, relevance_score, strength_score, strength_label, confidence, source, tags, notes",
    )
    .is("archived_at", null)
    .neq("permission_status", "revoked")
    .order("relevance_score", { ascending: false })
    .order("strength_score", { ascending: false })
    .limit(limit * 4); // over-fetch, then re-rank with scope keywords

  if (scope.capitalRoles && scope.capitalRoles.length > 0) {
    query = query.in("capital_role", scope.capitalRoles);
  }

  const { data } = await query;
  const rows = (data ?? []) as Pick<
    NetworkContact,
    | "id" | "full_name" | "first_name" | "last_name" | "title" | "company"
    | "capital_role" | "relevance_score" | "strength_score" | "strength_label"
    | "confidence" | "source" | "tags" | "notes"
  >[];

  const ranked = rows
    .map((c) => {
      const scoped = scope.keywords?.length
        ? scoreRelevance({
            capitalRole: c.capital_role as CapitalRole,
            title: c.title,
            tags: c.tags ?? [],
            scopeKeywords: scope.keywords,
          })
        : c.relevance_score;
      return { c, scoped };
    })
    .sort((a, b) => b.scoped - a.scoped || b.c.strength_score - a.c.strength_score)
    .slice(0, limit);

  const entries: RelationshipContextEntry[] = ranked.map(({ c, scoped }) => ({
    contactId: c.id,
    fullName: c.full_name ?? `${c.first_name} ${c.last_name}`.trim(),
    title: c.title,
    company: c.company,
    capitalRole: c.capital_role,
    relevance: scoped,
    strength: c.strength_score,
    strengthLabel: c.strength_label,
    confidence: c.confidence,
    source: c.source,
    tags: c.tags ?? [],
    lastNote: c.notes,
  }));

  return { entries, promptBlock: formatPromptBlock(entries) };
}

/**
 * Format entries as the context block prepended to Earn's prompt. Includes the
 * evidence Earn needs to explain recommendations in business language, and the
 * standing rule that outreach stays approval-gated.
 */
export function formatPromptBlock(entries: RelationshipContextEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => {
    const who = [e.fullName, e.title, e.company].filter(Boolean).join(", ");
    const facts = [
      `capital role: ${e.capitalRole.replace(/_/g, " ")}`,
      `relevance ${e.relevance}/100`,
      `relationship ${e.strengthLabel} (${e.strength}/100)`,
      `data confidence ${e.confidence}/100 via ${e.source.replace(/_/g, " ")}`,
      e.tags.length ? `tags: ${e.tags.slice(0, 5).join(", ")}` : null,
    ].filter(Boolean);
    return `- ${who} — ${facts.join("; ")}`;
  });
  return [
    "Relationship context (org Capital Network, scoped to this task):",
    ...lines,
    "When recommending a contact, explain why they are relevant, cite the scores and source above as evidence, state confidence, and note that any outreach requires the operator's approval before sending (Tier 2 gate).",
  ].join("\n");
}
