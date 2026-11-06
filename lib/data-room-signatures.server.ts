import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { SignatureTask } from "@/lib/data-room-signatures";

/**
 * Everything across the organization's rooms that is waiting on the fund's
 * signature. A failed read throws: an empty list the operator trusts would hide
 * a document that is holding up a counterparty.
 */
export async function loadSignaturesAwaitingFund(orgId: string): Promise<SignatureTask[]> {
  const supabase = await createServerClient();

  const [legacyRes, envRes, roomsRes, sharesRes] = await Promise.all([
    supabase
      .from("data_room_document_signatures")
      .select("id, room_id, file_name, signer_name, signer_email, signed_at")
      .eq("organization_id", orgId)
      .is("countersigned_at", null)
      .order("signed_at", { ascending: true })
      .limit(500),
    supabase
      .from("envelopes")
      .select("id, title, updated_at, data_room_share_id, data_room_document_id, reader_email, envelope_recipients(name, email, role, status, signed_at)")
      .eq("organization_id", orgId)
      .eq("status", "partially_signed")
      .not("data_room_document_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(500),
    supabase.from("data_rooms").select("id, name").eq("organization_id", orgId),
    supabase.from("data_room_shares").select("id, room_id").eq("organization_id", orgId),
  ]);
  for (const [what, res] of [
    ["signatures", legacyRes],
    ["envelopes", envRes],
    ["rooms", roomsRes],
    ["links", sharesRes],
  ] as const) {
    if (res.error) throw new Error(`Couldn't load the room ${what}: ${res.error.message}`);
  }

  const roomName = new Map(((roomsRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const roomOfShare = new Map(((sharesRes.data ?? []) as { id: string; room_id: string }[]).map((s) => [s.id, s.room_id]));

  const tasks: SignatureTask[] = [];

  for (const r of (legacyRes.data ?? []) as {
    id: string;
    room_id: string;
    file_name: string;
    signer_name: string;
    signer_email: string;
    signed_at: string;
  }[]) {
    tasks.push({
      key: `legacy:${r.id}`,
      kind: "legacy",
      id: r.id,
      title: r.file_name,
      roomId: r.room_id,
      roomName: roomName.get(r.room_id) ?? "Data room",
      signerName: r.signer_name,
      signerEmail: r.signer_email,
      signedAt: r.signed_at,
    });
  }

  for (const e of (envRes.data ?? []) as unknown as {
    id: string;
    title: string;
    updated_at: string;
    data_room_share_id: string | null;
    reader_email: string | null;
    envelope_recipients: { name: string; email: string; role: string; status: string; signed_at: string | null }[];
  }[]) {
    // The owner's turn only: someone must be left to sign, and it must be the fund.
    const owner = e.envelope_recipients.find((r) => r.role === "owner");
    if (!owner || owner.status === "signed") continue;
    const reader = e.envelope_recipients.find((r) => r.role === "signer" && r.status === "signed");
    const roomId = e.data_room_share_id ? roomOfShare.get(e.data_room_share_id) : undefined;
    if (!roomId) continue; // not tied to a room we can name
    tasks.push({
      key: `envelope:${e.id}`,
      kind: "envelope",
      id: e.id,
      title: e.title,
      roomId,
      roomName: roomName.get(roomId) ?? "Data room",
      signerName: reader?.name ?? null,
      signerEmail: reader?.email ?? e.reader_email,
      signedAt: reader?.signed_at ?? e.updated_at,
    });
  }

  return tasks;
}
