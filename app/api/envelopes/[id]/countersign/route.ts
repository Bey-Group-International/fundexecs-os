import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { missingRequiredFields, type EnvelopeFieldRequirement } from "@/lib/envelope-signing";
import { parseSignaturePng } from "@/lib/signing/signature-image";
import { blockValueProblem, resolveDateTimeResponse } from "@/lib/signing/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The account owner's turn: after every recipient has signed, an owner or admin of the
// organization fills their own blocks and signs, which completes the document.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canAdminOrg(ctx.role)) return NextResponse.json({ ok: false, error: "Only an owner or admin can countersign." }, { status: 403 });
  if (!ctx.emailConfirmed || !ctx.email) return NextResponse.json({ ok: false, error: "Confirm your email address before countersigning." }, { status: 403 });

  let body: { signatureData?: string; fieldResponses?: Record<string, string>; signerName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!parseSignaturePng(body.signatureData)) return NextResponse.json({ ok: false, error: "Draw or type your signature to sign." }, { status: 400 });
  const signatureData = body.signatureData as string;
  const responses: Record<string, string> = body.fieldResponses && typeof body.fieldResponses === "object" ? { ...body.fieldResponses } : {};

  const supabase = await createServerClient();
  // Row-level security keeps this to the member's own organization.
  const { data: env } = await supabase.from("envelopes").select("id, status, organization_id, lp_session_id").eq("id", id).maybeSingle();
  const envelope = env as { id: string; status: string; organization_id: string; lp_session_id: string | null } | null;
  if (!envelope || envelope.organization_id !== ctx.orgId) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (envelope.status === "completed") return NextResponse.json({ ok: false, error: "This document is already fully signed." }, { status: 409 });
  if (envelope.status !== "partially_signed") {
    return NextResponse.json({ ok: false, error: "Wait for the recipient to sign first." }, { status: 409 });
  }

  const { data: recs } = await supabase.from("envelope_recipients").select("id, role, status").eq("envelope_id", id);
  const recipients = (recs ?? []) as { id: string; role: string; status: string }[];
  const owner = recipients.find((r) => r.role === "owner");
  if (!owner) return NextResponse.json({ ok: false, error: "This document has no countersigner." }, { status: 409 });
  if (owner.status === "signed") return NextResponse.json({ ok: false, error: "Already countersigned." }, { status: 409 });
  if (recipients.some((r) => r.role !== "owner" && r.status !== "signed")) {
    return NextResponse.json({ ok: false, error: "Every recipient must sign before you countersign." }, { status: 409 });
  }

  const { data: fieldRows } = await supabase
    .from("envelope_fields")
    .select("id, field_type, label, required, prefill, locked")
    .eq("recipient_id", owner.id);
  const fields = (fieldRows ?? []) as (EnvelopeFieldRequirement & { prefill?: string | null; locked?: boolean })[];
  const now = new Date().toISOString();
  const adjustedTimes: string[] = [];
  for (const f of fields) {
    if (f.field_type === "datetime") {
      const r = resolveDateTimeResponse(responses[f.id], now);
      if (r.problem) return NextResponse.json({ ok: false, error: r.problem }, { status: 400 });
      responses[f.id] = r.value;
      if (r.adjusted && r.chosen) adjustedTimes.push(r.chosen);
    } else if (f.locked && f.prefill) responses[f.id] = f.prefill;
  }
  const missing = missingRequiredFields(fields, { signatureData, initialsData: null, fieldResponses: responses });
  if (missing.length) return NextResponse.json({ ok: false, error: `Required fields are incomplete: ${missing.join(", ")}` }, { status: 400 });

  for (const f of fields) {
    const problem = blockValueProblem(f.field_type, responses[f.id]);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  }

  for (const f of fields) {
    if (responses[f.id] === undefined) continue;
    const { error } = await supabase.from("envelope_fields").update({ response: responses[f.id] }).eq("id", f.id).eq("recipient_id", owner.id);
    if (error) return NextResponse.json({ ok: false, error: "Failed to record your answers" }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
  const signerName = (body.signerName ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const { error: signErr } = await supabase
    .from("envelope_recipients")
    .update({
      status: "signed",
      signed_at: now,
      signature_data: signatureData,
      ip_address: ip,
      // The record names whoever actually countersigned.
      email: ctx.email,
      ...(signerName ? { name: signerName } : {}),
    })
    .eq("id", owner.id);
  if (signErr) return NextResponse.json({ ok: false, error: "Failed to record your signature" }, { status: 500 });

  await supabase.from("envelope_events").insert({ envelope_id: id, event_type: "signed", recipient_id: owner.id, ip_address: ip, metadata: { actor: ctx.userId, party: "owner", ...(adjustedTimes.length ? { datetime_chosen: adjustedTimes, datetime_actual: now } : {}) } } as never);
  const { error: doneErr } = await supabase.from("envelopes").update({ status: "completed", completed_at: now }).eq("id", id);
  if (!doneErr) await supabase.from("envelope_events").insert({ envelope_id: id, event_type: "completed" });

  try {
    const { after } = await import("next/server");
    const { notifyCompleted } = await import("@/lib/envelope-notify.server");
    after(() => notifyCompleted(id).catch(() => undefined));
    if (envelope.lp_session_id) {
      const sessionId = envelope.lp_session_id;
      const { onLpAgreementCountersigned } = await import("@/lib/lp-agreement.server");
      const { createServiceClient } = await import("@/lib/supabase/server");
      after(() => onLpAgreementCountersigned(createServiceClient(), sessionId, ctx.userId).catch(() => undefined));
    }
  } catch {
    // Outside a request: nothing to schedule.
  }
  return NextResponse.json({ ok: true, envelopeCompleted: !doneErr });
}
