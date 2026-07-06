// lib/relationship/prospect-persistence.ts
// Persist a prospecting plan into the native CRM — the "act on it" step of the
// Relationship Intelligence Engine. Sourced prospects are deduplicated against
// the org's existing contacts, written to network_contacts with a lawful
// consent basis stamped (they come from public professional directories), and
// grouped into a saved contact_list the user can run a campaign from.
//
// normalizeForCrm is pure (unit-tested); savePlanToCrm does the RLS-scoped
// writes through the request server client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface PlanProspectLike {
  candidate: {
    name: string;
    title?: string | null;
    company?: string | null;
    location?: string | null;
    email?: string | null;
    seniority?: string | null;
    confidence?: number | null; // 0–100
  };
}

// Split a full name into first/last (network_contacts requires both non-null;
// empty last name is allowed for mononyms).
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export interface CrmContactRow {
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  seniority: string | null;
  source: string;
  confidence: number;
  verified: boolean;
  communication_status: string;
  consent_basis: string;
  consent_source: string;
}

// Map a plan prospect to a network_contacts row (minus org/owner). Cold-sourced
// contacts are stamped allowed + public_professional so the compliance gate
// treats them as lawfully contactable, with their source recorded for audit.
export function normalizeForCrm(p: PlanProspectLike, sourceLabel = "prospecting"): CrmContactRow {
  const c = p.candidate;
  const { first, last } = splitName(c.name);
  const email = c.email ? c.email.trim().toLowerCase() : null;
  return {
    first_name: first,
    last_name: last,
    email,
    title: c.title ?? null,
    company: c.company ?? null,
    location: c.location ?? null,
    seniority: c.seniority ?? null,
    source: sourceLabel,
    confidence: Math.max(0, Math.min(100, Math.round(c.confidence ?? 0))),
    verified: Boolean(email),
    communication_status: "allowed",
    consent_basis: "public_professional",
    consent_source: sourceLabel,
  };
}

// New columns (communication_status, consent_*) aren't in the generated types
// yet — use the untyped client view for writes, matching the repo pattern.
function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

export interface SavePlanResult {
  listId: string | null;
  listName: string;
  saved: number; // members added to the list
  created: number; // brand-new contacts inserted
  existing: number; // matched existing contacts (by email)
}

// Persist a plan's prospects as CRM contacts + a saved list. Deduplicates by
// email against the org's existing contacts; contacts with no email are always
// inserted. Returns a summary. Throws on a hard DB error (the route maps it).
export async function savePlanToCrm(
  db: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  args: { prospects: PlanProspectLike[]; goalText: string },
): Promise<SavePlanResult> {
  const listName = `Prospects — ${args.goalText.trim()}`.slice(0, 120);
  const rows = args.prospects.map((p) => normalizeForCrm(p));
  if (rows.length === 0) return { listId: null, listName, saved: 0, created: 0, existing: 0 };

  // 1. Match existing contacts by email (dedup).
  const emails = Array.from(new Set(rows.map((r) => r.email).filter((e): e is string => Boolean(e))));
  const existingByEmail = new Map<string, string>();
  if (emails.length) {
    const { data } = await loose(db)
      .from("network_contacts")
      .select("id, email")
      .eq("organization_id", orgId)
      .in("email", emails);
    for (const row of (data ?? []) as { id: string; email: string | null }[]) {
      if (row.email) existingByEmail.set(row.email.toLowerCase(), row.id);
    }
  }

  // 2. Insert the contacts we don't already have.
  const toInsert = rows.filter((r) => !(r.email && existingByEmail.has(r.email)));
  const insertedIds: string[] = [];
  if (toInsert.length) {
    const { data, error } = await loose(db)
      .from("network_contacts")
      .insert(toInsert.map((r) => ({ ...r, organization_id: orgId, imported_by: userId })))
      .select("id");
    if (error) throw new Error(`savePlanToCrm insert: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) insertedIds.push(row.id);
  }

  // 3. Create the list and add every contact (existing + new) as a member.
  const contactIds = [...new Set([...existingByEmail.values(), ...insertedIds])];
  const { data: listRow, error: listErr } = await loose(db)
    .from("contact_lists")
    .insert({ organization_id: orgId, created_by: userId, name: listName, description: `Auto-built from goal: ${args.goalText.trim()}` })
    .select("id")
    .single();
  if (listErr) throw new Error(`savePlanToCrm list: ${listErr.message}`);
  const listId = (listRow as { id: string } | null)?.id ?? null;

  if (listId && contactIds.length) {
    await loose(db)
      .from("contact_list_members")
      .upsert(contactIds.map((cid) => ({ list_id: listId, contact_id: cid })), { onConflict: "list_id,contact_id", ignoreDuplicates: true });
  }

  return {
    listId,
    listName,
    saved: contactIds.length,
    created: insertedIds.length,
    existing: existingByEmail.size,
  };
}
