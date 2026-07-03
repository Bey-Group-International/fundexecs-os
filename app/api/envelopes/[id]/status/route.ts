import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const envelopeId = params.id;
  const supabase = createServerClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch envelope (RLS enforced; no explicit org check here). Column list
  // matches the migration (20260701250000_envelopes.sql) — this select used
  // to name a sent_at column that doesn't exist, erroring on every request.
  const { data: envelope, error: envErr } = await supabase
    .from("envelopes")
    .select("id, title, status, created_at, completed_at, organization_id")
    .eq("id", envelopeId)
    .maybeSingle();

  if (envErr) {
    console.error("[/api/envelopes/[id]/status] envelope error", envErr);
    return NextResponse.json({ error: envErr.message }, { status: 500 });
  }
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 });
  }

  // Fetch recipients status summary (viewed state lives in `status`; there is
  // no viewed_at column in the schema).
  const { data: recipients, error: recipErr } = await supabase
    .from("envelope_recipients")
    .select("id, name, email, status, signed_at")
    .eq("envelope_id", envelopeId);

  if (recipErr) {
    console.error("[/api/envelopes/[id]/status] recipients error", recipErr);
    return NextResponse.json({ error: recipErr.message }, { status: 500 });
  }

  const rows = recipients ?? [];

  const summary = {
    total: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    viewed: rows.filter((r) => r.status === "viewed").length,
    signed: rows.filter((r) => r.status === "signed").length,
    declined: rows.filter((r) => r.status === "declined").length,
  };

  return NextResponse.json({
    envelope: {
      id: envelope.id,
      title: envelope.title,
      status: envelope.status,
      created_at: envelope.created_at,
      completed_at: envelope.completed_at,
    },
    recipients: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      status: r.status,
      signed_at: r.signed_at,
    })),
    summary,
  });
}
