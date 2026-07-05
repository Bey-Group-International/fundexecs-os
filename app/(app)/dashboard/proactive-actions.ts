"use server";

// Server actions for the proactive feed — the operator's verdicts are the
// training signal the trust budget decays on (lib/proactive/learn.ts). Each
// action reuses the RLS-enforced server client (only org writers can decide,
// per proactive_commands' writer-write policy) and records the verdict.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { recordDecision } from "@/lib/proactive/items";
import type { ProactiveVerdict } from "@/lib/proactive/types";

async function decide(formData: FormData, verdict: ProactiveVerdict): Promise<void> {
  const itemId = String(formData.get("itemId") ?? "").trim();
  if (!itemId) return;
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const supabase = await createServerClient();
  await recordDecision(supabase, ctx.orgId, itemId, verdict, ctx.userId);
  revalidatePath("/dashboard");
}

/** Approve the outward send — the gated decision Earn staged for the operator. */
export async function approveProactive(formData: FormData): Promise<void> {
  await decide(formData, "approved");
}

/** Dismiss — a negative training signal; this proposed-Command type decays. */
export async function dismissProactive(formData: FormData): Promise<void> {
  await decide(formData, "dismissed");
}

/** Snooze — a soft negative; the item parks and may re-surface later. */
export async function snoozeProactive(formData: FormData): Promise<void> {
  await decide(formData, "snoozed");
}
