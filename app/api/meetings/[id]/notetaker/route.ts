// app/api/meetings/[id]/notetaker/route.ts
// The notetaker's settings for one meeting: paused, who sees the live notes,
// and the transcription language.
//
// Everyone in the call reads them — a guest included, because the consent
// notice and the pause are for everybody. Only the host changes them; the room
// is nudged over its channel and reads them back from here.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { DEFAULT_NOTETAKER, patchNotetaker } from "@/lib/meetings/notetaker";
import { loadNotetakerMeeting } from "@/lib/meetings/notetaker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Db = { from: (table: string) => any };

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const loaded = await loadNotetakerMeeting(await db(), id);
  if ("missing" in loaded) return NextResponse.json({ settings: DEFAULT_NOTETAKER, isHost: false });
  if ("notFound" in loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    settings: loaded.meeting.settings,
    isHost: Boolean(caller.userId && caller.userId === loaded.meeting.hostId),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await db();
  const loaded = await loadNotetakerMeeting(client, id);
  if ("missing" in loaded) {
    return NextResponse.json({ error: "Notetaker settings aren't available yet — try again in a few minutes." }, { status: 503 });
  }
  if ("notFound" in loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.meeting.hostId !== caller.userId) {
    return NextResponse.json({ error: "Only the host can change the notetaker." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const next = patchNotetaker(loaded.meeting.settings, body);
  if (!next) return NextResponse.json({ error: "Nothing valid to change." }, { status: 400 });
  const { error } = await client.from("live_meetings").update({ notetaker: next }).eq("id", id);
  if (error) {
    console.error("[/api/meetings/[id]/notetaker] could not save", error.message);
    return NextResponse.json({ error: "Could not save the notetaker settings." }, { status: 500 });
  }
  return NextResponse.json({ settings: next });
}
