// lib/meetings/attendee-zones.server.ts
// Where each guest probably is, from what the firm already holds. See
// attendee-zones.ts. Read on the caller's own client, so RLS decides what can
// be seen: a teammate's meetings within the organization, and only the
// caller's own bookings for an outside guest's zone.
import type { createServerClient } from "@/lib/supabase/server";
import { firstZoneByEmail } from "@/lib/meetings/attendee-zones";
import { isValidTimezone } from "@/lib/meetings/scheduling";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Most addresses asked about at once: a meeting's guest list, not a directory. */
export const ZONE_LOOKUP_MAX = 50;

async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

/** Teammates: the zone of the meetings each most recently hosted. */
async function memberZones(supabase: ServerClient, orgId: string, emails: string[]): Promise<Record<string, string>> {
  return safely(async () => {
    const { data: people, error } = await supabase.from("principals").select("id, email").in("email", emails);
    if (error || !people?.length) return {};
    const emailById = new Map(
      (people as Array<{ id: string; email: string | null }>)
        .filter((p) => p.email)
        .map((p) => [p.id, (p.email as string).toLowerCase()]),
    );
    const { data: meetings, error: mErr } = await supabase
      .from("live_meetings")
      .select("host_id, timezone")
      .eq("organization_id", orgId)
      .in("host_id", [...emailById.keys()])
      .not("timezone", "is", null)
      .order("created_at", { ascending: false })
      .limit(300);
    if (mErr) return {};
    return firstZoneByEmail(
      ((meetings ?? []) as Array<{ host_id: string | null; timezone: string | null }>).map((m) => ({
        email: m.host_id ? emailById.get(m.host_id) : null,
        timezone: m.timezone,
      })),
      isValidTimezone,
    );
  }, {});
}

/** Outside guests: the zone they last booked one of the caller's links in. */
async function bookerZones(supabase: ServerClient, emails: string[]): Promise<Record<string, string>> {
  return safely(async () => {
    const { data, error } = await supabase
      .from("scheduling_bookings")
      .select("invitee_email, invitee_timezone")
      .in("invitee_email", emails)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return {};
    return firstZoneByEmail(
      ((data ?? []) as Array<{ invitee_email: string | null; invitee_timezone: string | null }>).map((b) => ({
        email: b.invitee_email,
        timezone: b.invitee_timezone,
      })),
      isValidTimezone,
    );
  }, {});
}

/**
 * Known zones for the given addresses, keyed lower-case. A teammate's own
 * meetings win over a booking, being their own choice of zone. Never throws;
 * an address with no known zone is simply absent.
 */
export async function loadAttendeeZones(
  supabase: ServerClient,
  orgId: string,
  emails: readonly string[],
): Promise<Record<string, string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))].slice(
    0,
    ZONE_LOOKUP_MAX,
  );
  if (!wanted.length) return {};
  const [members, bookers] = await Promise.all([memberZones(supabase, orgId, wanted), bookerZones(supabase, wanted)]);
  return { ...bookers, ...members };
}
