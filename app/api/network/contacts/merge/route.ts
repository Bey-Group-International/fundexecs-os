// POST /api/network/contacts/merge — fold a duplicate into the record you keep.
//
// The merge itself is decided by planMerge (pure, tested); this route reads both
// rows, applies the plan, reparents the history, tombstones the loser, and
// leaves a system timeline entry plus an audit record on both.
//
// There is no transaction available through PostgREST, so the order matters:
// history moves FIRST, and the loser is only tombstoned once it has nothing
// left pointing at it. A failure partway leaves both records intact and
// visible, which is recoverable; tombstoning first and failing would strand the
// duplicate's history on a hidden row.

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
    | (MergeableContact & { archived_at?: string | null; merged_into_id?: string | null })
    | undefined;
  const loser = (rows ?? []).find((r: MergeableContact) => r.id === mergeId) as
    | (MergeableContact & { archived_at?: string | null; merged_into_id?: string | null })
    | undefined;

  // Either genuinely missing, or invisible to this caller under the visibility
  // rule. Both are a 404 — merging is not a way to learn a private record exists.
  if (!winner || !loser) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (winner.merged_into_id || loser.merged_into_id) {
    return NextResponse.json({ error: "One of those records has already been merged." }, { status: 409 });
  }

  const { patch, summary } = planMerge(winner, loser);

  // 1. History first: reparent the timeline and any open follow-ups.
  const { error: activityError } = await supabase
    .from("network_activities")
    .update({ contact_id: keepId })
    .eq("organization_id", auth.ctx.orgId)
    .eq("contact_id", mergeId);
  if (activityError) {
    console.error("[network/merge] move activities", activityError);
    return NextResponse.json(
      { error: "Couldn't move the duplicate's history. Nothing was changed." },
      { status: 500 },
    );
  }

  const { error: taskError } = await supabase
    .from("network_tasks")
    .update({ contact_id: keepId })
    .eq("organization_id", auth.ctx.orgId)
    .eq("contact_id", mergeId);
  if (taskError) {
    console.error("[network/merge] move tasks", taskError);
    return NextResponse.json(
      { error: "Couldn't move the duplicate's follow-ups. Its history has already moved — retry the merge." },
      { status: 500 },
    );
  }

  // Outreach drafts point at a contact too; a draft written for the duplicate
  // is a draft for this person.
  const { error: draftError } = await supabase
    .from("outreach_drafts")
    .update({ contact_id: keepId })
    .eq("organization_id", auth.ctx.orgId)
    .eq("contact_id", mergeId);
  if (draftError) console.warn("[network/merge] move drafts", draftError);

  // 2. Apply the merged field values.
  if (Object.keys(patch).length > 0) {
    const { error: patchError } = await supabase
      .from("network_contacts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("organization_id", auth.ctx.orgId)
      .eq("id", keepId);
    if (patchError) {
      console.error("[network/merge] patch winner", patchError);
      return NextResponse.json({ error: "Couldn't apply the merged values." }, { status: 500 });
    }
  }

  // 3. Tombstone the loser — kept, not deleted, so its foreign keys survive and
  //    a re-import recognises it rather than recreating the duplicate.
  const { error: tombstoneError } = await supabase
    .from("network_contacts")
    .update({
      merged_into_id: keepId,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", mergeId);
  if (tombstoneError) {
    console.error("[network/merge] tombstone", tombstoneError);
    return NextResponse.json(
      { error: "The records were merged but the duplicate is still active. Archive it manually." },
      { status: 500 },
    );
  }

  invalidateRoster(auth.ctx.orgId);

  const detail = summary.length > 0 ? summary.join(", ") : "no field changes were needed";
  const { error: logError } = await supabase.from("network_activities").insert({
    organization_id: auth.ctx.orgId,
    contact_id: keepId,
    actor_id: auth.ctx.userId,
    activity_type: "merge",
    subject: `Merged duplicate record for ${loser.full_name ?? "an unnamed contact"}`,
    body: `On merge, ${detail}.`,
    is_system: true,
    metadata: { mergedId: mergeId, changes: Object.keys(patch) },
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
    },
  });

  return NextResponse.json({ ok: true, keptId: keepId, mergedId: mergeId, changes: summary });
}
