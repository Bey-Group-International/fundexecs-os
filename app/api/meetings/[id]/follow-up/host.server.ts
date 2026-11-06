// Shared by the follow-up's satellite routes: the caller must be the meeting's host.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type Db = { from: (table: string) => any };

export type HostAccess =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      userId: string;
      orgId: string;
      email: string;
      meeting: { id: string; title: string; host_id: string };
      /** The service client when configured, else the caller's own. */
      db: Db;
    };

export async function requireMeetingHost(meetingId: string): Promise<HostAccess> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  const supabase = await createServerClient();
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title, host_id")
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!meeting) return { ok: false, response: NextResponse.json({ error: "Meeting not found" }, { status: 404 }) };
  if (meeting.host_id !== auth.ctx.userId) {
    return { ok: false, response: NextResponse.json({ error: "Only the meeting host can do that." }, { status: 403 }) };
  }
  const db: Db = hasSupabaseServiceEnv() ? (createServiceClient() as Db) : (supabase as unknown as Db);
  return {
    ok: true,
    userId: auth.ctx.userId,
    orgId: auth.ctx.orgId,
    email: auth.ctx.email,
    meeting: { id: meeting.id, title: (meeting.title as string | null) ?? "", host_id: meeting.host_id as string },
    db,
  };
}
