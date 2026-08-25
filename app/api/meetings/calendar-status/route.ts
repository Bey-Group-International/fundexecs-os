// What the "Calendar connection" panel is allowed to claim.
//
// This endpoint exists to keep that panel honest. The app records a Google
// connection per org (written by the OAuth callback) and carries
// external_calendar_* columns on every meeting, which together look like
// working calendar sync. They are not: lib/meetings/service.ts#syncMeetingExternal
// mints a local mirror id and marks the row synced without contacting any
// provider, there is no calendar adapter in lib/integrations/adapters, and the
// Google OAuth scopes cover gmail.send and contacts.readonly only — nothing
// calendar. So the connected account is an EMAIL identity, and "synced" means
// "mirrored locally".
//
// Reporting that plainly is the whole job here. A panel that showed a Connect
// button, or read "Synced" as if events were leaving the app, would be telling
// the user something untrue about where their meetings live.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CalendarStatus {
  /** An org-level Google account is linked (for email — not calendar). */
  googleAccountConnected: boolean;
  /** The connected account's handle, for recognition. Never a credential. */
  googleAccountLabel: string | null;
  /**
   * Whether a real two-way calendar provider is wired up. Hard-coded false:
   * flip this when an adapter actually writes to a provider, and the panel
   * stops disclaiming on its own.
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
    const [connection, synced] = await Promise.all([
      supabase
        .from("integration_connections")
        .select("account_label, status")
        .eq("organization_id", auth.ctx.orgId)
        .eq("channel", "gmail")
        .maybeSingle(),
      supabase
        .from("live_meetings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", auth.ctx.orgId)
        .is("deleted_at", null)
        .eq("external_calendar_sync_enabled", true),
    ]);

    const row = connection.data as { account_label: string | null; status: string } | null;
    const connected = row?.status === "connected";

    const status: CalendarStatus = {
      googleAccountConnected: connected,
      googleAccountLabel: connected ? row?.account_label ?? null : null,
      providerSyncAvailable: false,
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
