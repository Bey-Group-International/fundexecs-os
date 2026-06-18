"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

// Sessions can be named and filed into groups. All mutations are org-scoped
// (defense-in-depth alongside RLS).

export async function createSessionGroup(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = createServerClient();
  await supabase
    .from("session_groups")
    .insert({ organization_id: ctx.orgId, name, created_by: ctx.userId });
  revalidatePath("/dashboard");
}

export async function renameSession(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const supabase = createServerClient();
  await supabase
    .from("sessions")
    .update({ name: name.slice(0, 120) })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/dashboard");
}

export async function moveSessionToGroup(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("group_id") ?? "");
  const group_id = raw === "" ? null : raw;
  if (!id) return;

  const supabase = createServerClient();
  await supabase
    .from("sessions")
    .update({ group_id })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/dashboard");
}
