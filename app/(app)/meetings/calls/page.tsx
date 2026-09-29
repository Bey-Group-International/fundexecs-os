import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ONE_WAY_KIND, readAcknowledgement } from "@/lib/meetings/one-way";
import type { CallHit } from "@/lib/meetings/call-archive";
import { narrowArchive } from "@/lib/meetings/session-archive.server";
import { LIST_PAGE } from "@/lib/meetings/session-archive";
import { CallArchive } from "./CallArchive";

export const dynamic = "force-dynamic";

/**
 * The recorded-call archive.
 *
 * The first page is rendered on the server so the list is there on arrival;
 * searching is a request, because it reads transcripts and those do not belong
 * in the initial payload.
 */
export default async function CallsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  // The same clauses the search route applies, from one place. Three copies of
  // this narrowing existed — here, in the route, and in the meeting log — and one
  // of the five clauses is wrong in a way no happy-path test notices: a
  // regenerated report INSERTS a row, so an embed with no order on it hands back
  // an arbitrary one, which is a superseded summary in this list and a superseded
  // transcript for the route to search. See session-archive.server.ts.
  const { data } = await narrowArchive(
    supabase
      .from("live_meetings")
      .select(
        "id, room_code, title, created_at, recording_consent, " +
        "live_meeting_recordings(duration_seconds, deleted_at), " +
        // No transcript: this is the first page, and it shows the summary.
        "live_meeting_reports(summary)",
      ),
    {
      kind: ONE_WAY_KIND,
      visibility: { scope: "host", hostId: ctx.userId, organizationId: ctx.orgId },
      searching: false,
      page: LIST_PAGE,
    },
  );

  type Row = {
    id: string;
    room_code: string;
    title: string | null;
    created_at: string;
    recording_consent: unknown;
    live_meeting_recordings?: Array<{ duration_seconds: number | null; deleted_at: string | null }> | null;
    live_meeting_reports?: Array<{ summary: string | null }> | null;
  };

  const initial: CallHit[] = ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    roomCode: row.room_code,
    title: row.title?.trim() || "Call",
    at: row.created_at,
    // The longest surviving recording: a call stopped and restarted has
    // several, and the first may be the eight seconds before somebody noticed
    // the microphone was muted.
    durationSeconds: (row.live_meeting_recordings ?? [])
      .filter((r) => !r.deleted_at && typeof r.duration_seconds === "number" && r.duration_seconds > 0)
      .reduce<number | null>((best, r) => (best === null || r.duration_seconds! > best ? r.duration_seconds! : best), null),
    summary: (row.live_meeting_reports?.[0]?.summary ?? "").trim(),
    consented: readAcknowledgement(row.recording_consent) !== null,
    matches: 0,
    snippet: null,
  }));

  return <CallArchive initial={initial} />;
}
