// app/api/meetings/calls/[id]/route.ts
// Renaming and organising a recorded call: its name, tags, who was on it, and
// the deal it was about.
//
// Its own route rather than the meeting PATCH, which is built for scheduled
// meetings: it diffs guests, checks conflicts, moves bookings and sends update
// notices. A call is organised so its owner can find it again, and nothing
// about that should reach anybody else — which is also why `attendees` here is
// written directly: on a call it is a label, and nobody is emailed.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ONE_WAY_KIND } from "@/lib/meetings/one-way";
import { cleanCallTitle } from "@/lib/meetings/call-archive";
import { attendeesFromPeople, cleanCallPeople, cleanCallTags, isUuid } from "@/lib/meetings/call-organise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    tags?: unknown;
    people?: unknown;
    dealId?: unknown;
  };
  const update: Record<string, unknown> = {};
  const out: Record<string, unknown> = { id };

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? cleanCallTitle(body.title) : null;
    if (!title) return NextResponse.json({ error: "A call needs a name." }, { status: 400 });
    update.title = title;
    out.title = title;
  }
  if (body.tags !== undefined) {
    update.tags = cleanCallTags(body.tags);
    out.tags = update.tags;
  }
  if (body.people !== undefined) {
    const people = cleanCallPeople(body.people);
    update.attendees = attendeesFromPeople(people);
    out.people = people;
  }

  const supabase = await createServerClient();

  if (body.dealId !== undefined) {
    if (body.dealId === null || body.dealId === "") {
      update.deal_id = null;
      out.dealId = null;
      out.dealName = null;
    } else if (!isUuid(body.dealId)) {
      return NextResponse.json({ error: "That isn't a deal." }, { status: 400 });
    } else {
      // A deal in the caller's own organisation, read through their own
      // client. The composite foreign key would refuse anything else too; this
      // turns that into a sentence and fetches the name to show.
      const { data: deal } = await supabase
        .from("deals")
        .select("id, name")
        .eq("id", body.dealId)
        .eq("organization_id", auth.ctx.orgId)
        .maybeSingle();
      if (!deal) return NextResponse.json({ error: "That deal wasn't found." }, { status: 422 });
      update.deal_id = body.dealId;
      out.dealId = body.dealId;
      out.dealName = (deal as { name: string | null }).name?.trim() || "Deal";
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  // Narrowed to the caller's own call, in the organisation they are working
  // in — the same visibility the archive lists with. Anything else updates no
  // row and answers 404, the same as a call that does not exist.
  const { data, error } = await supabase
    .from("live_meetings")
    .update(update as never)
    .eq("id", id)
    .eq("host_id", auth.ctx.userId)
    .eq("organization_id", auth.ctx.orgId)
    .eq("kind", ONE_WAY_KIND)
    .is("deleted_at", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(out);
}
