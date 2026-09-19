// Tasks and expected closes on one timeline.
//
//   GET ?month=YYYY-MM   — the days a month's calendar grid actually shows.
//   GET ?start=&end=     — an explicit window, for an agenda or a week view.
//
// The window is the GRID's range, not the month's. A September calendar draws
// days from late August and early October, and fetching only September leaves
// those looking empty when they are merely unasked-for.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { gridRange, monthOf, type ScheduleEntry } from "@/lib/network-workspace";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Widest window we will answer, so one request cannot ask for a decade. */
const MAX_DAYS = 400;

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = req.nextUrl.searchParams;
  let start = sp.get("start");
  let end = sp.get("end");

  if (!start || !end) {
    const month = sp.get("month") ?? monthOf();
    const range = gridRange(month);
    if (!range) {
      return NextResponse.json({ error: "month must look like YYYY-MM." }, { status: 400 });
    }
    start = range.start;
    end = range.end;
  }

  if (!DAY_PATTERN.test(start) || !DAY_PATTERN.test(end)) {
    return NextResponse.json({ error: "start and end must be YYYY-MM-DD." }, { status: 400 });
  }
  // Date.parse accepts 2026-02-30 and rolls it to March; a window built from a
  // day that does not exist is not a window anyone asked for.
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    new Date(startMs).toISOString().slice(0, 10) !== start ||
    new Date(endMs).toISOString().slice(0, 10) !== end
  ) {
    return NextResponse.json({ error: "start and end must be real dates." }, { status: 400 });
  }
  if (endMs < startMs) {
    return NextResponse.json({ error: "end cannot precede start." }, { status: 400 });
  }
  if ((endMs - startMs) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json(
      { error: `A schedule window cannot exceed ${MAX_DAYS} days.` },
      { status: 400 },
    );
  }

  const supabase = (await createServerClient()) as any;
  const { data, error } = await supabase.rpc("network_schedule", {
    target_org: auth.ctx.orgId,
    range_start: start,
    range_end: end,
  });

  if (error) {
    console.error("[network/schedule] read", error);
    return NextResponse.json({ error: "Failed to load the schedule" }, { status: 500 });
  }

  const entries: ScheduleEntry[] = ((data ?? []) as Record<string, any>[]).map((row) => ({
    kind: row.kind === "close" ? "close" : "task",
    id: String(row.id),
    title: String(row.title ?? "Untitled"),
    onDate: String(row.on_date),
    status: String(row.status ?? "open"),
    priority: row.priority ?? null,
    assigneeId: row.assignee_id ?? null,
    contactId: row.contact_id ?? null,
    opportunityId: row.opportunity_id ?? null,
    amount:
      row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: row.currency ?? null,
    overdue: row.overdue === true,
  }));

  return NextResponse.json({ entries, start, end });
}
