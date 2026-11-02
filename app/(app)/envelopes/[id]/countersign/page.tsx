import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { Countersign } from "./Countersign";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Countersign — FundExecs OS" };

interface Rec { id: string; name: string; role: string; status: string; signature_data: string | null }
interface Fld { id: string; recipient_id: string; field_type: string; page: number; x_pct: number; y_pct: number; width_pct: number; height_pct: number; required: boolean; prefill: string | null; locked: boolean; response: string | null }

export default async function CountersignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");
  if (!canAdminOrg(ctx.role)) redirect(`/envelopes/${id}`);

  const supabase = await createServerClient();
  const { data: env } = await supabase.from("envelopes").select("id, title, status, pdf_storage_key").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle();
  const envelope = env as { id: string; title: string; status: string; pdf_storage_key: string | null } | null;
  if (!envelope) notFound();
  // Only once a recipient has signed and before the document is complete.
  if (envelope.status !== "partially_signed" || !envelope.pdf_storage_key) redirect(`/envelopes/${id}`);

  const [{ data: recs }, { data: flds }] = await Promise.all([
    supabase.from("envelope_recipients").select("id, name, role, status, signature_data").eq("envelope_id", id),
    supabase.from("envelope_fields").select("id, recipient_id, field_type, page, x_pct, y_pct, width_pct, height_pct, required, prefill, locked, response").eq("envelope_id", id),
  ]);
  const recipients = (recs ?? []) as Rec[];
  const fields = (flds ?? []) as Fld[];
  const owner = recipients.find((r) => r.role === "owner");
  if (!owner || owner.status === "signed") redirect(`/envelopes/${id}`);
  const byId = new Map(recipients.map((r) => [r.id, r]));

  const blocks = fields
    .filter((f) => f.recipient_id === owner.id)
    .map((f) => ({ id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct, widthPct: f.width_pct, heightPct: f.height_pct, required: f.required, prefill: f.prefill, locked: f.locked }));
  // What the recipient filled in and signed, shown on the page as they left it.
  const done = fields
    .filter((f) => f.recipient_id !== owner.id && byId.get(f.recipient_id)?.status === "signed")
    .map((f) => ({
      id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct, widthPct: f.width_pct, heightPct: f.height_pct,
      value: f.response,
      signaturePng: f.field_type === "signature" || f.field_type === "initials" ? byId.get(f.recipient_id)?.signature_data ?? null : null,
    }));

  return <Countersign envelopeId={id} title={envelope.title} defaultName={owner.name} blocks={blocks} done={done} />;
}
