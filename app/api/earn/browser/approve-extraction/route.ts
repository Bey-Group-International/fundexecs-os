// POST /api/earn/browser/approve-extraction
//
// The gate where reviewed data ENTERS the system — and the only place it does.
// On operator approval of a review-queue item, the approved fields are routed to
// real records: PERSON fields → a professional network contact; FILING / COMPANY
// fields → `edgar_filing_records` / `diligence_reports`. The session is driven
// through the machine (awaiting_user_review → approved_for_save → saved), or to
// `rejected` when nothing is approved. No send / dispatch happens here — external
// actions need their own separate approval.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { loadSession, transitionSession, writeAudit } from "@/lib/earn/browser-operator/server";
import { persistApprovedRecords } from "@/lib/earn/browser-operator/persist-records.server";
import type { ExtractedDataPoint } from "@/lib/earn/browser-operator/types";
import type { EarnReviewQueueItem } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type Payload = {
  reviewId?: string;
  /** Field names the operator approved. Anything else in the batch is rejected. */
  approvedFields?: string[];
};

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:earn-browser-approve-extraction`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Payload | null;
  if (!payload?.reviewId) {
    return NextResponse.json({ error: "Required: reviewId (review-queue item id)." }, { status: 400 });
  }
  const approvedNames = new Set((payload.approvedFields ?? []).filter(Boolean));

  const supabase = await createServerClient();

  const { data: itemData } = await supabase
    .from("earn_review_queue")
    .select("*")
    .eq("id", payload.reviewId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  const item = itemData as EarnReviewQueueItem | null;
  if (!item) {
    return NextResponse.json({ error: "Review item not found" }, { status: 404 });
  }
  if (item.status !== "pending") {
    return NextResponse.json({ error: `Review item already ${item.status}.` }, { status: 409 });
  }

  const session = await loadSession(supabase, item.session_id, auth.ctx.orgId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const allPoints = (item.fields as unknown as ExtractedDataPoint[]) ?? [];
  const approved = allPoints.filter((p) => approvedNames.has(p.field_name));

  // Nothing approved → reject the batch and reject the session's review.
  if (approved.length === 0) {
    const rej = await transitionSession(supabase, session, "reject");
    if (!rej.ok && rej.reason === "illegal_transition") {
      return NextResponse.json(
        { error: `Cannot reject from '${rej.from}'. The session is not awaiting review.` },
        { status: 409 },
      );
    }
    await supabase
      .from("earn_review_queue")
      .update({ status: "rejected", decided_by: auth.ctx.userId, decided_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("organization_id", auth.ctx.orgId);
    await writeAudit(supabase, {
      orgId: auth.ctx.orgId,
      sessionId: session.id,
      userId: auth.ctx.userId,
      input: { action: "field_rejected", summary: "Operator rejected all extracted fields." },
    });
    return NextResponse.json({ ok: true, rejected: true, status: "rejected" });
  }

  // awaiting_user_review → approved_for_save. Illegal from elsewhere → 409.
  const approveSave = await transitionSession(supabase, session, "approve_save", { save_approved: true });
  if (!approveSave.ok && approveSave.reason === "illegal_transition") {
    return NextResponse.json(
      { error: `Cannot approve from '${approveSave.from}'. The session must be awaiting review.` },
      { status: 409 },
    );
  }
  if (!approveSave.ok) {
    return NextResponse.json({ error: approveSave.error }, { status: 500 });
  }

  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: { action: "save_approved", summary: `Operator approved ${approved.length} field(s) for saving.` },
  });

  // Persist approved fields into real records. THIS is where data enters.
  const persisted = await persistApprovedRecords(supabase, approved, {
    orgId: auth.ctx.orgId,
    userId: auth.ctx.userId,
    sessionId: session.id,
    fallbackSubject: session.requested_prompt,
  });

  // Mark the queue item approved.
  await supabase
    .from("earn_review_queue")
    .update({ status: "approved", decided_by: auth.ctx.userId, decided_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("organization_id", auth.ctx.orgId);

  // approved_for_save → saved (terminal).
  const saved = await transitionSession(supabase, approveSave.session, "save_complete");
  if (!saved.ok) {
    return NextResponse.json({ error: "Records saved but session finalize failed.", persisted }, { status: 500 });
  }

  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: {
      action: "saved",
      summary: `Saved ${persisted.contactsCreated} contact(s), ${persisted.filingsCreated} filing(s), ${persisted.reportsCreated} report(s).`,
    },
  });
  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: { action: "session_completed" },
  });

  return NextResponse.json({
    ok: true,
    status: saved.session.status,
    persisted,
  });
}
