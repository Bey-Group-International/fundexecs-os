// The link a repeating meeting's invitation carries.
//
// One invitation covers every meeting in the series, but each meeting has its
// own room. So the link names the series, and this sends whoever opens it to
// the meeting that is on now or next — the one they are almost certainly
// trying to join. The series id is as unguessable as a room code, and grants
// nothing a room code does not: it only ever leads to one of the rooms.
import { notFound, redirect } from "next/navigation";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { pickSeriesOccurrence } from "@/lib/meetings/recurrence";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SeriesInvitePage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  if (!UUID.test(seriesId) || !hasSupabaseServiceEnv()) notFound();

  const { data } = await createServiceClient()
    .from("live_meetings")
    .select("room_code, scheduled_at, duration_minutes")
    .eq("series_id", seriesId)
    .eq("is_draft", false)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(60);

  const room = pickSeriesOccurrence(
    (data ?? []) as Array<{ room_code: string; scheduled_at: string | null; duration_minutes: number | null }>,
    Date.now(),
  );
  if (!room) notFound();
  redirect(`/meeting-invite/${room}`);
}
