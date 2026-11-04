// lib/envelope-countersign.server.ts
//
// What the maker's countersign step needs: their own blocks, and the reader's answers as
// the reader left them. Null when it is not the maker's turn (so the wizard shows another step).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DoneBlock, SheetBlock } from "@/components/signing/SigningSheet";

interface Rec { id: string; name: string; role: string; status: string; signature_data: string | null }
interface Fld { id: string; recipient_id: string; field_type: string; page: number; x_pct: number; y_pct: number; width_pct: number; height_pct: number; required: boolean; prefill: string | null; locked: boolean; response: string | null }

export async function loadCountersign(
  client: SupabaseClient,
  envelopeId: string,
): Promise<{ defaultName: string; blocks: SheetBlock[]; done: DoneBlock[] } | null> {
  const [{ data: recs }, { data: flds }] = await Promise.all([
    client.from("envelope_recipients").select("id, name, role, status, signature_data").eq("envelope_id", envelopeId),
    client.from("envelope_fields").select("id, recipient_id, field_type, page, x_pct, y_pct, width_pct, height_pct, required, prefill, locked, response").eq("envelope_id", envelopeId),
  ]);
  const recipients = (recs ?? []) as Rec[];
  const fields = (flds ?? []) as Fld[];
  const owner = recipients.find((r) => r.role === "owner");
  if (!owner || owner.status === "signed") return null;
  const byId = new Map(recipients.map((r) => [r.id, r]));

  const blocks: SheetBlock[] = fields
    .filter((f) => f.recipient_id === owner.id)
    .map((f) => ({ id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct, widthPct: f.width_pct, heightPct: f.height_pct, required: f.required, prefill: f.prefill, locked: f.locked }));
  // What the reader filled in and signed, shown on the page as they left it.
  const done: DoneBlock[] = fields
    .filter((f) => f.recipient_id !== owner.id && byId.get(f.recipient_id)?.status === "signed")
    .map((f) => ({
      id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct, widthPct: f.width_pct, heightPct: f.height_pct,
      value: f.response,
      signaturePng: f.field_type === "signature" || f.field_type === "initials" ? byId.get(f.recipient_id)?.signature_data ?? null : null,
    }));
  return { defaultName: owner.name, blocks, done };
}
