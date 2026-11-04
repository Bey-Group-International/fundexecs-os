import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { inviteSigners } from "@/lib/envelope-invite.server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Send the signing email again to whoever has not signed yet. A reminder, not a new request:
// the same link, and nothing about the envelope changes.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  // A reminder every few minutes is a nudge; more is a flood.
  const limiter = checkRateLimit({ key: `envelope-resend:${id}`, limit: 3, windowMs: 10 * 60_000 });
  if (!limiter.ok) return NextResponse.json({ ok: false, error: "You just sent a reminder. Try again in a few minutes." }, { status: 429 });

  const supabase = await createServerClient();
  const { data } = await supabase.from("envelopes").select("id, title, status, organization_id, lp_session_id").eq("id", id).maybeSingle();
  const env = data as { id: string; title: string; status: string; organization_id: string; lp_session_id: string | null } | null;
  if (!env || env.organization_id !== ctx.orgId) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (env.status !== "sent" && env.status !== "partially_signed") {
    return NextResponse.json({ ok: false, error: "Only a document that is out for signature can be sent again." }, { status: 409 });
  }

  const invite = await inviteSigners(supabase, { envelopeId: id, title: env.title, orgId: env.organization_id, lpSessionId: env.lp_session_id, onlyWaiting: true });
  if (!invite.ok) return NextResponse.json({ ok: false, error: "Could not send the reminder." }, { status: 500 });
  if (invite.signingUrls.length === 0) return NextResponse.json({ ok: false, error: "Everyone has already signed." }, { status: 409 });

  await supabase.from("envelope_events").insert({ envelope_id: id, event_type: "sent", metadata: { resend: true, to: invite.signingUrls.map((u) => u.email) } } as never);
  return NextResponse.json({ ok: true, sentTo: invite.signingUrls.map((u) => u.email) });
}
