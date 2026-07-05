// Server-side pipeline: take a normalized profile through dedupe → scoring →
// network_contacts insert → relationship edge, under the caller's RLS session.
//
// This is the single write path shared by the manual/linkedin_url add flow and
// (eventually) backend connector syncs, so every source lands identically in
// the Capital Relationship Graph.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { blockingDuplicates, findDuplicates } from "./dedupe-contacts";
import { initialScores } from "./score-relationship";
import type { DedupeMatch, ExistingContactRef, NormalizedProfile } from "./types";

type Client = SupabaseClient<Database>;

export type AddContactResult =
  | { ok: true; contactId: string; duplicates: DedupeMatch[] }
  | { ok: false; needsReview: true; duplicates: DedupeMatch[] }
  | { ok: false; needsReview?: false; error: string };

/**
 * Insert a normalized profile as an org contact and mirror it into the
 * relationship graph. High-confidence duplicates block the insert unless the
 * caller passes force=true (the user explicitly chose "add anyway").
 */
export async function addProfessionalContact(
  supabase: Client,
  args: {
    orgId: string;
    userId: string;
    profile: NormalizedProfile;
    /** Insert even when a high-confidence duplicate exists. */
    force?: boolean;
  },
): Promise<AddContactResult> {
  const { orgId, userId, profile } = args;

  // Dedupe against candidates that could plausibly match (same email, same
  // linkedin, or same last name) rather than the whole book.
  const orFilters: string[] = [];
  if (profile.email) orFilters.push(`email.eq.${profile.email}`);
  if (profile.linkedin_url) orFilters.push(`linkedin_url.eq.${profile.linkedin_url}`);
  if (profile.last_name) orFilters.push(`last_name.ilike.${profile.last_name}`);
  if (profile.first_name && !profile.last_name) orFilters.push(`first_name.ilike.${profile.first_name}`);

  let candidates: ExistingContactRef[] = [];
  if (orFilters.length > 0) {
    const { data } = await supabase
      .from("network_contacts")
      .select("id, full_name, first_name, last_name, email, linkedin_url, company")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .or(orFilters.join(","))
      .limit(50);
    candidates = (data ?? []) as ExistingContactRef[];
  }

  const duplicates = findDuplicates(profile, candidates);
  if (!args.force && blockingDuplicates(duplicates).length > 0) {
    return { ok: false, needsReview: true, duplicates };
  }

  const scores = initialScores(profile);

  const { data: inserted, error } = await supabase
    .from("network_contacts")
    .insert({
      organization_id: orgId,
      imported_by: userId,
      relationship_owner: userId,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      phone: profile.phone,
      linkedin_url: profile.linkedin_url,
      title: profile.title,
      company: profile.company,
      location: profile.location,
      connected_on: profile.connected_on,
      source: profile.source,
      capital_role: profile.capital_role,
      relevance_score: scores.relevance,
      strength_score: scores.strength,
      strength_label: scores.strengthLabel,
      strength_updated_at: new Date().toISOString(),
      confidence: profile.confidence,
      permission_status: "connected",
      tags: profile.tags,
      notes: profile.notes,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Contact insert failed" };
  }

  // Mirror into the relationship graph so the contact appears in /graph and
  // the Capital Map immediately. Best-effort — a graph write failure should
  // not lose the contact itself.
  try {
    await supabase.from("relationships").insert({
      organization_id: orgId,
      graph: "relationship",
      from_entity_type: "principal",
      from_entity_id: userId,
      to_entity_type: "contact",
      to_entity_id: inserted.id,
      relation: "knows",
      strength: scores.strength,
      metadata: {
        source: profile.source,
        capital_role: profile.capital_role,
        confidence: profile.confidence,
      } as Json,
    });
  } catch {
    // Graph mirroring is an enhancement; the contact record is the source of truth.
  }

  return { ok: true, contactId: inserted.id, duplicates };
}
