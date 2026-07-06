"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

// Execute › Shareholder Comms server actions. The shareholder_comms table isn't
// in the generated types yet (migration 20260707140000), so writes use an
// untyped client cast — mirroring the ClosingLive / docusign-actions pattern.

const COMMS = "/execute/comms";

const TYPES = new Set([
  "quarterly_update",
  "capital_call",
  "distribution_notice",
  "annual_report",
  "ad_hoc",
]);

export async function addShareholderComm(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const type = String(formData.get("type") ?? "ad_hoc").trim();

  const supabase = await createServerClient();
  await supabase.from("shareholder_comms" as never).insert({
    organization_id: ctx.orgId,
    title,
    type: TYPES.has(type) ? type : "ad_hoc",
    status: "draft",
    created_by: ctx.userId,
  } as never);
  revalidatePath(COMMS);
}

export async function markCommSent(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createServerClient();
  await supabase
    .from("shareholder_comms" as never)
    .update({ status: "sent", last_sent_date: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(COMMS);
}
