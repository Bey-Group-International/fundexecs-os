// POST /api/network/contacts/merge — fold a duplicate into the record you keep.
//
// The merge splits in two on purpose.
//
//   planMerge (lib/network-merge.ts) DECIDES what the surviving record should
//   look like. It is pure, so the rules that matter — never overwrite a
//   populated field, union tags and flags, always keep the stricter outbound
//   status — are tested without a database.
//
//   merge_network_contacts() APPLIES it, in one statement. That has to happen
//   in the database: reparenting the duplicate's timeline means moving entries
//   other people and the engine wrote, which network_activities_update
//   correctly forbids a member from doing directly. Over PostgREST that update
//   would match zero rows and report no error, and the tombstone that followed
//   would strand the duplicate's history on a hidden record. The function also
//   gives the merge a transaction, which PostgREST cannot.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { planMerge, type MergeableContact } from "@/lib/network-merge";
import { recordNetworkAudit } from "@/lib/network-audit";
import { invalidateRoster } from "@/lib/network-roster";

export const dynamic = "force-dynamic";

const SELECT = `
  id, first_name, last_name, full_name, title, company, company_domain, email, phone,
  linkedin_url, avatar_url, location, notes, tags, capital_role, relationship_type,
  relationship_owner, strength_score, strength_label, relevance_score, stage, visibility,
  connected_on, last_activity_at, next_step_at, verified, confidence,
  communication_status, consent_basis, consent_at, compliance_flags, archived_at, merged_into_id
`;

/** Postgres error codes the merge function raises, mapped to HTTP. */
function statusForPgCode(code: unknown): number {
  switch (code) {
    case "P0002": // no_data_found — missing, or invisible to this caller
      return 404;
    case "42501": // insufficient_privilege
      return 403;
    case "22023": // invalid_parameter_value — merging a record into itself
      return 400;
    default:
      return 500;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-merge`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 20) },
    );
  }

  const payload = (await req.json().catch(() => null)) as { keepId?: string; mergeId?: string } | null;
  const keepId = payload?.keepId;
  const mergeId = payload?.mergeId;

  if (!keepId || !mergeId) {
    return NextResponse.json({ error: "keepId and mergeId are required." }, { status: 400 });
  }
  if (keepId === mergeId) {
    return NextResponse.json({ error: "A record cannot be merged into itself." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;

  // Read both under the caller's own RLS first. This is what decides the merge
  // AND what makes an invisible record a 404 rather than something the merge
  // function has to explain — it checks visibility again regardless.
  const { data: rows, error: readError } = await supabase
    .from("network_contacts")
    .select(SELECT)
    .eq("organization_id", auth.ctx.orgId)
    .in("id", [keepId, mergeId]);

  if (readError) {
    console.error("[network/merge] read", readError);
    return NextResponse.json({ error: "Failed to load those records" }, { status: 500 });
  }

  const winner = (rows ?? []).find((r: MergeableContact) => r.id === keepId) as
    | (MergeableContact & { merged_into_id?: string | null })
    | undefined;
  const loser = (rows ?? []).find((r: MergeableContact) => r.id === mergeId) as
    | (MergeableContact & { merged_into_id?: string | null })
    | undefined;

  if (!winner || !loser) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (winner.merged_into_id || loser.merged_into_id) {
    return NextResponse.json({ error: "One of those records has already been merged." }, { status: 409 });
  }

  const { patch, summary } = planMerge(winner, loser);

  const { data: result, error: mergeError } = await supabase.rpc("merge_network_contacts", {
    target_org: auth.ctx.orgId,
    keep_id: keepId,
    merge_id: mergeId,
    field_patch: patch,
  });

  if (mergeError) {
    const status = statusForPgCode((mergeError as { code?: string }).code);
    if (status === 500) console.error("[network/merge] rpc", mergeError);
    return NextResponse.json(
      {
        error:
          status === 404
            ? "Contact not found"
            : status === 403
              ? "You don't have access to merge those records."
              : status === 400
                ? "A record cannot be merged into itself."
                : "Merge failed. Nothing was changed.",
      },
      { status },
    );
  }

  invalidateRoster(auth.ctx.orgId);

  const moved = (result ?? {}) as {
    movedActivities?: number;
    movedTasks?: number;
    movedDrafts?: number;
  };
  const detail = summary.length > 0 ? summary.join(", ") : "no field changes were needed";

  const { error: logError } = await supabase.from("network_activities").insert({
    organization_id: auth.ctx.orgId,
    contact_id: keepId,
    actor_id: auth.ctx.userId,
    activity_type: "merge",
    subject: `Merged duplicate record for ${loser.full_name ?? "an unnamed contact"}`,
    body: `On merge, ${detail}. Moved ${moved.movedActivities ?? 0} timeline entries and ${moved.movedTasks ?? 0} follow-ups.`,
    is_system: true,
    metadata: { mergedId: mergeId, changes: Object.keys(patch), moved },
  });
  if (logError) console.warn("[network/merge] timeline entry failed", logError);

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "merge",
    entityId: keepId,
    entityLabel: winner.full_name ?? null,
    metadata: {
      mergedId: mergeId,
      mergedLabel: loser.full_name ?? null,
      changes: Object.keys(patch),
      moved,
    },
  });

  return NextResponse.json({ ok: true, keptId: keepId, mergedId: mergeId, changes: summary, moved });
}
