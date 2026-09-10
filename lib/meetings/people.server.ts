// lib/meetings/people.server.ts
// Reading the three directories the attendee picker suggests from. The ranking,
// deduping and matching all live in people.ts, which is pure; this file only
// fetches rows and shapes them into PersonSuggestion.
import type { createServerClient } from "@/lib/supabase/server";
import type { PersonSuggestion } from "@/lib/meetings/people";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Rows pulled per source before ranking.
 *
 * Generous rather than exact: matching happens in memory (people.ts), so this
 * only has to be wide enough that the right person is in the candidate set. A
 * cap has to exist because this runs on every debounced keystroke.
 */
const PER_SOURCE = 200;

/** Meetings scanned for past attendees. Recent ones are the useful ones. */
const PAST_MEETINGS = 100;

/**
 * Every source is wrapped so a failure returns [] rather than throwing.
 *
 * A picker that goes blank because one of three directories is unavailable is
 * worse than one that quietly offers the other two — the member can still type
 * an address in full, which is the escape hatch that always works.
 */
async function safely<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}

/** Teammates: organization_members → principals. Carries title and avatar. */
async function loadMembers(supabase: ServerClient, orgId: string): Promise<PersonSuggestion[]> {
  return safely(async () => {
    const { data: memberRows, error } = await supabase
      .from("organization_members")
      .select("principal_id")
      .eq("organization_id", orgId)
      .limit(PER_SOURCE);
    if (error) return [];

    const ids = [...new Set((memberRows ?? []).map((r: { principal_id: string }) => r.principal_id))];
    if (ids.length === 0) return [];

    const { data, error: pErr } = await supabase
      .from("principals")
      .select("full_name, email, title, avatar_url")
      .in("id", ids);
    if (pErr) return [];

    return (data ?? [])
      .filter((r: { email: string | null }) => r.email?.trim())
      .map((r: { full_name: string | null; email: string; title: string | null; avatar_url: string | null }) => ({
        email: r.email.trim().toLowerCase(),
        name: r.full_name?.trim() || r.email.trim(),
        subtitle: r.title?.trim() || undefined,
        avatarUrl: r.avatar_url ?? undefined,
        source: "member" as const,
      }));
  });
}

/** Saved network contacts — the external people already known to the firm. */
async function loadContacts(supabase: ServerClient, orgId: string): Promise<PersonSuggestion[]> {
  return safely(async () => {
    const { data, error } = await supabase
      .from("network_contacts")
      .select("full_name, email, title, company, avatar_url")
      .eq("organization_id", orgId)
      .not("email", "is", null)
      .limit(PER_SOURCE);
    if (error) return [];

    return (data ?? [])
      .filter((r: { email: string | null }) => r.email?.trim())
      .map((r: { full_name: string | null; email: string; title: string | null; company: string | null; avatar_url: string | null }) => ({
        email: r.email.trim().toLowerCase(),
        name: r.full_name?.trim() || r.email.trim(),
        // Title at a company is how you tell two people with the same name
        // apart, so both go on the second line when both exist.
        subtitle: [r.title?.trim(), r.company?.trim()].filter(Boolean).join(" · ") || undefined,
        avatarUrl: r.avatar_url ?? undefined,
        source: "contact" as const,
      }));
  });
}

/**
 * People who were on recent meetings.
 *
 * The catch-all: a guest emailed once and never saved as a contact is invisible
 * to the other two directories, and typing their address again from memory is
 * exactly the friction the picker exists to remove. Read out of the meetings'
 * own `attendees` JSON, which is why every row is treated as untrusted shape.
 */
async function loadPastAttendees(supabase: ServerClient, orgId: string): Promise<PersonSuggestion[]> {
  return safely(async () => {
    const { data, error } = await supabase
      .from("live_meetings")
      .select("attendees")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(PAST_MEETINGS);
    if (error) return [];

    const out: PersonSuggestion[] = [];
    for (const row of (data ?? []) as Array<{ attendees: unknown }>) {
      if (!Array.isArray(row.attendees)) continue;
      for (const raw of row.attendees) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const entry = raw as Record<string, unknown>;
        const email = typeof entry.email === "string" ? entry.email.trim().toLowerCase() : "";
        if (!email) continue;
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        out.push({ email, name: name || email, source: "past" });
      }
    }
    return out;
  });
}

/**
 * Everyone the picker could offer, from all three directories.
 *
 * Unranked and undeduped on purpose — rankSuggestions does both, and it needs
 * to see every copy of a person to keep the best-ranked one.
 */
export async function loadPeopleDirectory(
  supabase: ServerClient,
  orgId: string,
): Promise<PersonSuggestion[]> {
  const [members, contacts, past] = await Promise.all([
    loadMembers(supabase, orgId),
    loadContacts(supabase, orgId),
    loadPastAttendees(supabase, orgId),
  ]);
  return [...members, ...contacts, ...past];
}
