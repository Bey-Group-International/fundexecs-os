"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { decideAccessRequest } from "@/lib/admin/access-requests";
import { createServiceClient } from "@/lib/supabase/server";
import { markInvoiceSettled } from "@/lib/subscription-invoices.server";
import { applySettledInvoices } from "@/lib/subscriptions.server";

// Approve / decline an access request from the admin console.
//
// The /admin layout already gates the page, but a server action is its own
// entry point — anything reachable by POST re-checks the gate here rather than
// trusting that the caller came from a rendered admin page.
async function decide(
  id: string,
  decision: "approved" | "declined",
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { error: "Not authorized." };
  if (!id) return { error: "Missing request id." };

  const result = await decideAccessRequest({
    id,
    decision,
    reviewerId: gate.ctx.userId,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin");
  return {};
}

export async function approveAccessRequest(id: string): Promise<{ error?: string }> {
  return decide(id, "approved");
}

export async function declineAccessRequest(id: string): Promise<{ error?: string }> {
  return decide(id, "declined");
}


/**
 * Confirm that a subscription invoice has been settled — the human half of the
 * native billing path. Finance sees the transfer land and says so here, which is
 * what releases the period's credits.
 *
 * Gated twice on purpose: the /admin layout gates the page, but a server action
 * is its own entry point, and this one hands over paid value. An operator must
 * never be able to mark their own bill paid.
 */
export async function confirmSubscriptionPaymentAction(
  invoiceId: string,
  reference: string,
): Promise<{ error?: string; ok?: boolean }> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { error: "Not authorized." };
  if (!invoiceId) return { error: "Missing invoice id." };

  const trimmed = reference.trim();
  if (!trimmed) {
    // The reference is the audit trail tying a period's credits to a specific
    // payment. Confirming without one leaves nothing to reconcile against.
    return { error: "Enter the payment reference (wire id, transfer note, cheque number)." };
  }

  try {
    const service = createServiceClient();
    const settled = await markInvoiceSettled(
      invoiceId,
      { via: "bank_transfer", reference: trimmed, note: `Confirmed by ${gate.ctx.email ?? "admin"}` },
      service,
    );
    if (!settled.ok) return { error: settled.error ?? "Could not record the payment." };

    // Hand the period over now rather than leaving it for the hourly sweep —
    // someone who just paid should not wait an hour for their plan.
    await applySettledInvoices(service);

    revalidatePath("/admin");
    revalidatePath("/wallet");
    return { ok: true };
  } catch (err) {
    console.error("[admin] confirmSubscriptionPaymentAction failed:", err);
    return { error: "Something went wrong recording the payment." };
  }
}
