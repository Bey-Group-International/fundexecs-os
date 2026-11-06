// Cancel a scheduled follow-up before it goes — all of it, or some recipients.
import { NextRequest, NextResponse } from "next/server";
import { requireMeetingHost } from "../host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireMeetingHost(id);
  if (!access.ok) return access.response;
  const payload = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(payload.ids) ? payload.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : null;
  let q = access.db
    .from("live_meeting_followup_sends")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("meeting_id", id)
    .eq("status", "scheduled");
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: "Couldn't cancel the scheduled follow-up." }, { status: 500 });
  return NextResponse.json({ cancelled: (data ?? []).length });
}
