// app/api/meetings/[id]/notes/route.ts
// Your own notes for a meeting: typed while it runs, kept with it afterwards.
// Nobody else reads them — except that the host's notes are given to the
// report model, because the host was there and the report is theirs.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { cleanNotes } from "@/lib/meetings/notetaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Db = { from: (table: string) => any };

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

function missing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Sign in to keep notes." }, { status: 401 });
  const { data, error } = await (await db())
    .from("live_meeting_notes")
    .select("body, updated_at")
    .eq("meeting_id", id)
    .eq("user_id", caller.userId)
    .maybeSingle();
  if (error) return NextResponse.json({ body: "", updatedAt: null, available: !missing(error) });
  return NextResponse.json({ body: data?.body ?? "", updatedAt: data?.updated_at ?? null, available: true });
}

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Sign in to keep notes." }, { status: 401 });
  const payload = (await req.json().catch(() => ({}))) as { body?: unknown };
  const body = cleanNotes(payload.body);
  if (body === null) return NextResponse.json({ error: "Send the notes as text." }, { status: 400 });
  const updatedAt = new Date().toISOString();
  const { error } = await (await db())
    .from("live_meeting_notes")
    .upsert({ meeting_id: id, user_id: caller.userId, body, updated_at: updatedAt }, { onConflict: "meeting_id,user_id" });
  if (error) {
    if (missing(error)) return NextResponse.json({ error: "Notes aren't available yet — try again in a few minutes." }, { status: 503 });
    return NextResponse.json({ error: "Could not save your notes." }, { status: 500 });
  }
  return NextResponse.json({ updatedAt });
}
