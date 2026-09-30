// Time the member is already committed to in a connected calendar, for the
// scheduler to check a proposed time against while it is being picked.
//
// The save routes enforce the same rule — a meeting cannot be saved over this
// time — but finding out only after pressing Schedule is finding out late.
// Spans only: "busy then" is all the scheduler needs to say, and a private
// event's details have no reason to travel here.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadExternalConflicts } from "@/lib/meetings/conflicts.server";
import { isValidTimezone } from "@/lib/meetings/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longer than any meeting can be; a wider ask is a mistake, not a check. */
const MAX_WINDOW_MS = 24 * 3600_000;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const params = req.nextUrl.searchParams;
    const start = new Date(params.get("start") ?? "");
    const end = new Date(params.get("end") ?? "");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > MAX_WINDOW_MS) {
      return NextResponse.json({ error: "Give a start and end no more than a day apart." }, { status: 400 });
    }
    const tz = params.get("tz");
    const timezone = tz && isValidTimezone(tz) ? tz : "UTC";

    const busy = await loadExternalConflicts(await createServerClient(), {
      userId: auth.ctx.userId,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      timezone,
    });
    return NextResponse.json({ busy });
  } catch (err) {
    console.error("[/api/meetings/busy] GET", err);
    return NextResponse.json({ error: "Could not check your calendar." }, { status: 500 });
  }
}
