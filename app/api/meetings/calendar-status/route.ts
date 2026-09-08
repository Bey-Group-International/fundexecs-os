// What the "Calendar connection" panel is allowed to claim.
//
// This endpoint exists to keep that panel honest, and for a long time honesty
// meant saying that nothing worked: the app carried external_calendar_* columns
// on every meeting and an org-level Google connection, which together LOOKED
// like calendar sync while syncMeetingExternal only minted a local mirror id,
// and the OAuth grant covered gmail.send and contacts.readonly — nothing
// calendar. Every one of those facts has since changed, and this file went on
// asserting them long after they stopped being true, which is its own kind of
// lie: the panel told members a working feature did not exist.
//
// What is true now: GOOGLE_CALENDAR_SCOPES asks for auth/calendar; a member's
// grant, their calendar list and their events are synced into
// google_calendar_connections / google_calendars / external_events; and
// syncMeetingExternal pushes a real event through pushMeetingToGoogle. So the
// remaining question is not "does calendar sync exist" but "can THIS member's
// connection actually take a write" — which is what providerSyncAvailable
// answers, by resolving the same write target the push path uses.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { writeTargetFor } from "@/lib/calendar/google-write.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CalendarStatus {
  /**
   * The ORGANIZATION's Gmail identity — how meeting email goes out when a
   * member has not connected their own Google account. Deliberately not the
   * member's calendar grant, which is `calendarConnected` below; the two are
   * separate connections and conflating them is what made this panel wrong
   * before.
   */
  googleAccountConnected: boolean;
  /** That account's handle, for recognition. Never a credential. */
  googleAccountLabel: string | null;
  /** Whether THIS member has connected their own Google Calendar. */
  calendarConnected: boolean;
  /**
   * Whether meetings can actually be pushed to a provider — a connection plus
   * a calendar this member owns or can write to. Read access is not enough: it
   * would 403 on every push, so it does not count. Resolved through the same
   * helper the push path uses, so the panel cannot claim a capability the
   * writer does not have.
   */
  providerSyncAvailable: boolean;
  /** Meetings currently flagged to mirror externally, for context. */
  meetingsWithSyncEnabled: number;
}

export async function GET() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabase = await createServerClient();
    const [connection, calendarConnection, synced, writeTarget] = await Promise.all([
      supabase
        .from("integration_connections")
        .select("account_label, status")
        .eq("organization_id", auth.ctx.orgId)
        .eq("channel", "gmail")
        .maybeSingle(),
      // The member's own calendar grant. Separate from the mailbox above, and
      // the difference the panel's copy turns on: "you have not connected a
      // calendar" and "your calendar is read-only" need different answers.
      supabase
        .from("google_calendar_connections")
        .select("id")
        .eq("user_id", auth.ctx.userId)
        .maybeSingle(),
      supabase
        .from("live_meetings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", auth.ctx.orgId)
        .is("deleted_at", null)
        .eq("external_calendar_sync_enabled", true),
      // Reuses the same resolution the push path uses, so the panel cannot
      // claim a capability the writer does not have.
      writeTargetFor(supabase, auth.ctx.userId).catch(() => null),
    ]);

    const row = connection.data as { account_label: string | null; status: string } | null;
    const connected = row?.status === "connected";

    const status: CalendarStatus = {
      googleAccountConnected: connected,
      googleAccountLabel: connected ? row?.account_label ?? null : null,
      calendarConnected: Boolean(calendarConnection.data),
      providerSyncAvailable: Boolean(writeTarget),
      meetingsWithSyncEnabled: synced.count ?? 0,
    };
    return NextResponse.json(status);
  } catch (err) {
    console.error("[/api/meetings/calendar-status] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read calendar status" },
      { status: 500 },
    );
  }
}
