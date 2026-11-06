// Remove one of your own bookmarks, or relabel it.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { cleanBookmarkLabel } from "@/lib/meetings/notetaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; bookmarkId: string }>;
type Db = { from: (table: string) => any };

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id, bookmarkId } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const { data, error } = await (await db())
    .from("live_meeting_bookmarks")
    .update({ label: cleanBookmarkLabel(body.label) })
    .eq("id", bookmarkId)
    .eq("meeting_id", id)
    .eq("user_id", caller.userId)
    .select("id, at, label");
  if (error) return NextResponse.json({ error: "Could not save the bookmark." }, { status: 500 });
  const row = (data ?? [])[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ bookmark: row });
}

export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const { id, bookmarkId } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok || !caller.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await (await db())
    .from("live_meeting_bookmarks")
    .delete()
    .eq("id", bookmarkId)
    .eq("meeting_id", id)
    .eq("user_id", caller.userId)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not remove the bookmark." }, { status: 500 });
  if (!(data ?? []).length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
