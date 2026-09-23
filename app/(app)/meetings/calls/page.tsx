import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ONE_WAY_KIND, readAcknowledgement } from "@/lib/meetings/one-way";
import type { CallHit } from "@/lib/meetings/call-archive";
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
  const { data } = await supabase
    .from("live_meetings")
    .select(
      "id, room_code, title, created_at, recording_consent, " +
      "live_meeting_recordings(duration_seconds, deleted_at), " +
      "live_meeting_reports(summary)",
    )
    .eq("organization_id", ctx.orgId)
    .eq("host_id", ctx.userId)
    .eq("kind", ONE_WAY_KIND)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    // The newest report, explicitly. Regenerating a report INSERTS another row
    // rather than updating the old one, so an unordered embed can hand back a
    // superseded summary — and, worse, a superseded transcript to search.
    .order("created_at", { ascending: false, referencedTable: "live_meeting_reports" })
    .limit(1, { referencedTable: "live_meeting_reports" })
    .limit(50);

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
