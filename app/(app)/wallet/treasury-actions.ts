"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { stripeConfigured } from "@/lib/stripe";
import {
  createLinkSession,
  recordLinkedAccount,
  disconnectLinkedAccount,
  type RecordLinkedAccountInput,
} from "@/lib/treasury/linked-accounts";
import {
  validateTransfer,
  createTransfer,
  executeTransfer,
  updateTransferStatus,
} from "@/lib/treasury/transfers";
import type { LinkedAccount, TransferDirection } from "@/lib/supabase/database.types";

// Start a Stripe Financial Connections session; the browser mounts the secure
// bank-link with the returned client_secret. Writer-gated by the RLS the page
// already enforces; here we only need an org in context.
export async function startBankLinkAction(): Promise<{ clientSecret?: string; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  return createLinkSession();
}

// Persist an account the browser linked through Financial Connections. Only the
// Stripe references + display-safe metadata are stored — never account numbers.
export async function recordLinkedAccountAction(input: RecordLinkedAccountInput): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const supabase = await createServerClient();
  const res = await recordLinkedAccount(supabase, ctx.orgId, ctx.userId ?? null, input);
  if (res.error) return { error: res.error };
  revalidatePath("/wallet");
  return { ok: true };
}

export async function disconnectAccountAction(formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const accountId = String(formData.get("account_id") ?? "");
  if (!accountId) return { error: "Missing account." };
  const supabase = await createServerClient();
  const ok = await disconnectLinkedAccount(supabase, ctx.orgId, accountId);
  if (ok) revalidatePath("/wallet");
  return ok ? { ok: true } : { error: "Could not disconnect the account." };
}

// Create and (when Stripe is live) execute an ACH transfer. Validation runs
// server-side against the stored account so the client can't move more than the
// balance or outside the limits. Returns the resulting status.
export async function createTransferAction(
  formData: FormData,
): Promise<{ ok?: boolean; status?: string; error?: string; note?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const direction = (String(formData.get("direction") ?? "deposit") === "withdrawal"
    ? "withdrawal"
    : "deposit") as TransferDirection;
  const linkedAccountId = String(formData.get("linked_account_id") ?? "");
  const dollars = Number(formData.get("amount") ?? "0");
  const amountCents = Math.round(dollars * 100);
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!linkedAccountId) return { error: "Select a linked account." };

  const supabase = await createServerClient();
  const { data: accountRow } = await supabase
    .from("linked_accounts")
    .select("*")
    .eq("id", linkedAccountId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const account = (accountRow as LinkedAccount | null) ?? null;

  const check = validateTransfer({ direction, amountCents, account });
  if (!check.ok) return { error: check.errors[0] };

  const { transfer, error } = await createTransfer(supabase, ctx.orgId, ctx.userId ?? null, {
    direction,
    amountCents,
    linkedAccountId,
    description,
  });
  if (error || !transfer) return { error: error ?? "Could not record the transfer." };

  // No live key → the transfer is recorded (audit) but not executed.
  if (!stripeConfigured()) {
    revalidatePath("/wallet");
    return { ok: true, status: "pending", note: "Recorded. Connect Stripe to execute transfers." };
  }

  const result = await executeTransfer(transfer, account!);
  await updateTransferStatus(supabase, transfer.id, "pending", result.status, {
    failureReason: result.failureReason ?? null,
  });
  revalidatePath("/wallet");
  return result.status === "failed"
    ? { ok: false, status: result.status, error: result.failureReason ?? "Transfer failed." }
    : { ok: true, status: result.status };
}
