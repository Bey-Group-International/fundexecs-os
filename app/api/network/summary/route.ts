// The numbers the workspace opens with.
//
//   GET — one round trip: work due, relationships going cold, deals closing.
//
// This is a read of `network_workspace_summary`, which is SECURITY INVOKER, so
// what it counts is what the caller can see. A colleague's private
// relationships are not in your totals — a headline number you cannot drill
// into is worse than no number, because it looks like a fact.

import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { mapWorkspaceSummary } from "@/lib/network-workspace";

export const dynamic = "force-dynamic";

/** The workspace's opening numbers for the caller's organization, in one round trip. */
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = (await createServerClient()) as any;
  const { data, error } = await supabase.rpc("network_workspace_summary", {
    target_org: auth.ctx.orgId,
  });

  // A failed rollup must not be served as zeroes. "No work overdue" and "we
  // could not check" look identical on a dashboard tile and only one of them
  // lets somebody go home.
  if (error) {
    console.error("[network/summary] read", error);
    return NextResponse.json({ error: "Failed to load the workspace summary" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ summary: mapWorkspaceSummary(row) });
}
