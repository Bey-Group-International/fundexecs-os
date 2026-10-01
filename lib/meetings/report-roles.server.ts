// lib/meetings/report-roles.server.ts
// Who a meeting's report should treat as the host, and who as the recipients.
//
// The report is written by a model that was never told. It was handed a list
// of names — the host first, or as "You" — and wrote a follow-up to whoever it
// guessed the reader was. The send path has always known the answer (the
// mailbox is the host's, and recipients.ts leaves the host out), but only at
// the moment of sending, after the words were chosen.
//
// So the same answer is worked out here, before the model is asked, from the
// same sources the send uses: the host's directory row, the invite list, and
// who was in the room.
//
// Never throws. A report must not fail because a lookup about it did; the worst
// case is the prompt that existed before this file, which names no roles.
import type { createServerClient } from "@/lib/supabase/server";
import { meetingRecipients } from "@/lib/meetings/recipients";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import type { ReportPerson } from "@/lib/meetings/report-analysis";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export interface ReportRoles {
  host: ReportPerson | null;
  /** Everyone the follow-up is for, including people with no address here. */
  recipients: ReportPerson[];
}

/** The host's directory row: the name the organisation knows them by. Null on any failure. */
export async function loadHost(
  supabase: SupabaseClient,
  hostId: string,
): Promise<{ full_name: string | null; email: string | null } | null> {
  try {
    const { data } = await supabase
      .from("principals")
      .select("full_name, email")
      .eq("id", hostId)
      .maybeSingle();
    return (data as { full_name: string | null; email: string | null } | null) ?? null;
  } catch {
    return null;
  }
}

export async function loadReportRoles(
  supabase: SupabaseClient,
  input: {
    meetingId: string;
    hostId: string;
    /** The signed-in host's address, from the session. */
    hostEmail: string | null;
    /** `live_meetings.attendees`, as stored. */
    invited: unknown;
  },
): Promise<ReportRoles> {
  const [principal, present] = await Promise.all([
    loadHost(supabase, input.hostId),
    loadPresentPeople(supabase, input.meetingId).catch(() => []),
  ]);

  const hostEmail = (input.hostEmail ?? principal?.email ?? "").trim().toLowerCase() || null;
  const hostName = (principal?.full_name ?? "").trim();
  const host: ReportPerson | null =
    hostName || hostEmail ? { name: hostName || hostEmail || "", email: hostEmail } : null;

  // The send's own rule, so the people the report writes to are exactly the
  // people it will reach.
  const audience = meetingRecipients({ invited: input.invited, present, senderEmail: hostEmail });
  const hostKey = hostName.toLowerCase();
  const recipients: ReportPerson[] = [
    ...audience.recipients.map((r) => ({ name: r.name, email: r.email })),
    // Guests who joined by link are still who the email is about, even though
    // nobody here can mail them. The host is never among them: the room's copy
    // of the host has an address, and is matched by name here in case it did not.
    ...audience.unreachable
      .filter((name) => name.trim().toLowerCase() !== hostKey)
      .map((name) => ({ name })),
  ];

  return { host, recipients };
}
