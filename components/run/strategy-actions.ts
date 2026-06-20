"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { clampUnit } from "@/lib/run-strategy";

/**
 * Set (or adjust) a deal's thesis fit from the Strategy module. The control
 * submits a 0..100 percentage; we store it as a 0..1 fraction on
 * `deals.thesis_fit`, clamped into range. Org-scoped so an operator can only
 * touch their own deals. Revalidates the Strategy surface so the re-scored
 * allocation / prioritization views reflect the change immediately.
 */
export async function setThesisFit(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) return;

  const raw = String(formData.get("thesis_fit") ?? "").trim();
  if (raw === "") return;

  const pct = Number(raw);
  if (!Number.isFinite(pct)) return;

  // Form sends a percentage (0..100); persist as a clamped 0..1 fraction.
  const fit = clampUnit(pct / 100);
  if (fit == null) return;

  const supabase = createServerClient();
  await supabase
    .from("deals")
    .update({ thesis_fit: fit })
    .eq("id", dealId)
    .eq("organization_id", ctx.orgId);

  revalidatePath("/run/strategy");
}
