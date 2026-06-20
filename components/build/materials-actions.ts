"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));

// Accept only real http(s) links so a stored document URL can never carry a
// javascript:/data: payload into the rendered <a href> (defense in depth — the
// renderer also guards).
function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    // not a valid absolute URL
  }
  return null;
}

// Add a document to the data room as a link (no file storage). The external URL
// is held in `storage_key`; the section is the `doc_type`.
export async function addDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const name = String(formData.get("name") ?? "").trim();
  const link = safeLink(String(formData.get("url") ?? ""));
  let section = String(formData.get("section") ?? "").trim();
  if (!SECTION_KEYS.has(section)) section = "other";
  if (!name || !link) return;

  const supabase = createServerClient();
  await supabase.from("documents").insert({
    organization_id: ctx.orgId,
    name,
    doc_type: section,
    storage_key: link,
    uploaded_by: ctx.userId,
  });
  revalidatePath("/build/data_room");
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("documents").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath("/build/data_room");
}
