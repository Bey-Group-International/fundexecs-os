"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

// Create a fresh session and open it (the rail's "New Session").
export async function startSession(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const supabase = createServerClient();
  const { data } = await supabase
    .from("sessions")
    .insert({ organization_id: ctx.orgId, name: "New session", origin: "earn", created_by: ctx.userId })
    .select("id")
    .single();
  redirect(data?.id ? `/session/${data.id}` : "/workspace");
}

export async function setSessionColor(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const color = String(formData.get("color") ?? "").trim() || null;
  if (!id) return;
  const supabase = createServerClient();
  await supabase
    .from("sessions")
    .update({ color })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(`/session/${id}`);
  revalidatePath("/dashboard");
}

// Archive is reversible: toggles archived_at.
export async function setSessionArchived(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const archived = String(formData.get("archived") ?? "") === "true";
  if (!id) return;
  const supabase = createServerClient();
  await supabase
    .from("sessions")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/dashboard");
  revalidatePath(`/session/${id}`);
}

// Delete is permanent. The confirm lives in the UI.
export async function deleteSession(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("sessions").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath("/dashboard");
  redirect("/workspace");
}

// Share: create a link (scope 'public' read-only via /s/<token>, or 'org').
export async function createSessionShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const scope = String(formData.get("scope") ?? "org") === "public" ? "public" : "org";
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("session_shares").insert({
    organization_id: ctx.orgId,
    session_id: id,
    scope,
    created_by: ctx.userId,
  });
  revalidatePath(`/session/${id}`);
}
