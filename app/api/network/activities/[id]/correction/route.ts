// POST /api/network/activities/[id]/correction — take a machine-written entry
// off the wrong person's record, or put it back.
//
// The CRM writes entries nobody typed, and both writers can be wrong about WHO:
// a meeting invite can carry a colleague's address, an inbound email's From
// header is written by whoever sent it, and a summary can simply describe the
// wrong person's business. Until this route there was no way to fix that —
// network_activities_update restricts a member to their own, non-system entries,
// which is what makes the timeline evidence, so a machine-written entry on the
// wrong record was permanent.
//
// The work happens in flag_network_activity_misattributed(), for the same reason
// merge_network_contacts() exists: RLS forbids the update from the client, so
// over PostgREST it would match zero rows and report no error, and this route
// would tell the caller it had worked. The function is SECURITY DEFINER and
// re-checks everything the policies would have — membership, the admin right,
// and the contact's visibility through the same helper.
//
// It marks rather than edits or deletes. Editing the body would destroy what
// is_system is for, and deleting would be undone by the next message on the same
// thread.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { statusForPgCode } from "@/lib/pg-error-status";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Enough to say which entry and why, not a second copy of the conversation. */
const MAX_REASON = 500;

const LIMIT_PER_MIN = 30;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;

  const policy = {
    key: `org:${auth.ctx.orgId}:activity-correction`,
    limit: LIMIT_PER_MIN,
    windowMs: 60_000,
  };
  const rateLimit = checkRateLimit(policy);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, policy.limit) },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { misattributed?: unknown; reason?: unknown }
    | null;

  // Explicit, not defaulted. "Correct this" and "restore this" are opposite acts
  // on a permanent record, and a missing field must not silently pick one.
  if (typeof body?.misattributed !== "boolean") {
    return NextResponse.json(
      { error: "misattributed must be true or false" },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : null;

  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc("flag_network_activity_misattributed", {
    activity_id: id,
    reason,
    flag: body.misattributed,
  });

  if (error) {
    const status = statusForPgCode((error as { code?: string }).code);
    if (status === 500) console.error("[network/activities/correction] rpc", error);
    return NextResponse.json(
      {
        error:
          status === 404
            ? "Entry not found"
            : status === 403
              ? "Only an organization admin can correct an automatic entry"
              : status === 400
                ? "Only an automatic entry is corrected this way"
                : "Failed to correct the entry",
      },
      { status },
    );
  }

  // No audit write here on purpose. flag_network_activity_misattributed writes
  // the trail itself, inside the same transaction as the correction, so the two
  // commit together. Doing it from here was neither atomic — recordNetworkAudit
  // swallows its failures, and the correction had already committed — nor
  // reliably attributed, because auth.ctx.orgId is the caller's CURRENT
  // organisation, which for an admin of two is not necessarily the one this
  // entry belongs to.
  return NextResponse.json({ ok: true, result: data });
}
