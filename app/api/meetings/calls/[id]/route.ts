// app/api/meetings/calls/[id]/route.ts
// Renaming a recorded call.
//
// Its own route rather than the meeting PATCH, which is built for scheduled
// meetings: it diffs guests, checks conflicts, moves bookings and sends update
// notices. A call is renamed so its owner can find it again, and nothing about
// that should reach anybody else.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ONE_WAY_KIND } from "@/lib/meetings/one-way";
import { cleanCallTitle } from "@/lib/meetings/call-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === "string" ? cleanCallTitle(body.title) : null;
  if (!title) return NextResponse.json({ error: "A call needs a name." }, { status: 400 });

  const supabase = await createServerClient();
  // Narrowed to the caller's own call, in the organisation they are working
  // in — the same visibility the archive lists with. Anything else updates no
  // row and answers 404, the same as a call that does not exist.
  const { data, error } = await supabase
    .from("live_meetings")
    .update({ title })
    .eq("id", id)
    .eq("host_id", auth.ctx.userId)
    .eq("organization_id", auth.ctx.orgId)
    .eq("kind", ONE_WAY_KIND)
    .is("deleted_at", null)
    .select("id, title");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id, title });
}
