// app/api/meetings/[id]/bookmarks/route.ts
// Moments flagged while the meeting runs. Each person sees their own; the
// report reads them all, as moments that mattered to somebody in the room.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { cleanBookmarkLabel } from "@/lib/meetings/notetaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Db = { from: (table: string) => any };

/** Most bookmarks one person keeps in one meeting. */
const MAX_PER_PERSON = 100;

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Sign in to keep bookmarks." }, { status: 401 });
  const { data, error } = await (await db())
    .from("live_meeting_bookmarks")
    .select("id, at, label")
    .eq("meeting_id", id)
    .eq("user_id", caller.userId)
    .order("at", { ascending: true })
    .limit(MAX_PER_PERSON);
  if (error) return NextResponse.json({ bookmarks: [] });
  return NextResponse.json({ bookmarks: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Sign in to keep bookmarks." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { at?: unknown; label?: unknown };
  const now = Date.now();
  const asked = typeof body.at === "string" ? Date.parse(body.at) : NaN;
  // A moment already past, or now; never one still to come. A clock a little
  // ahead of the server's is read as now.
  const at = Number.isFinite(asked) && asked <= now + 60_000 && asked > now - 24 * 3600_000 ? Math.min(asked, now) : now;
  const client = await db();

  const { count } = await client
    .from("live_meeting_bookmarks")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", id)
    .eq("user_id", caller.userId);
  if ((count ?? 0) >= MAX_PER_PERSON) {
    return NextResponse.json({ error: "That's the most bookmarks one meeting can hold." }, { status: 409 });
  }

  const { data, error } = await client
    .from("live_meeting_bookmarks")
    .insert({ meeting_id: id, user_id: caller.userId, at: new Date(at).toISOString(), label: cleanBookmarkLabel(body.label) })
    .select("id, at, label")
    .single();
  if (error || !data) {
    const missing = (error as { code?: string } | null)?.code === "42P01";
    return NextResponse.json(
      { error: missing ? "Bookmarks aren't available yet — try again in a few minutes." : "Could not save the bookmark." },
      { status: missing ? 503 : 500 },
    );
  }
  return NextResponse.json({ bookmark: data });
}
