"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createInvoice, voidInvoice } from "@/lib/invoices.server";
import type { InvoiceDraft, PaymentInvoice } from "@/lib/invoices";
import { requireFeatureAccess } from "@/lib/feature-access.server";

// Create a payment-link invoice for the caller's org. Returns the new invoice
// (with its public token) so the client can immediately show/copy the pay link.
export async function createInvoiceAction(
  draft: InvoiceDraft,
): Promise<{ invoice?: PaymentInvoice; error?: string }> {
  const gate = await requireFeatureAccess("execute");
  if (!gate.ok) return { error: gate.error };
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const res = await createInvoice(ctx.orgId, ctx.userId, draft);
    if (res.invoice) revalidatePath("/execute/billing");
    return res;
  } catch (err) {
    console.error("[invoices] createInvoiceAction failed:", err);
    return { error: "Something went wrong creating the invoice. Please try again." };
  }
}

// Void an open/draft invoice the caller owns.
export async function voidInvoiceAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  // Deliberately NOT plan-gated: an org whose plan lapsed must still be able to
  // void an open invoice that is still payable through its public link.
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const res = await voidInvoice(ctx.orgId, id);
    if (res.ok) revalidatePath("/execute/billing");
    return res;
  } catch (err) {
    console.error("[invoices] voidInvoiceAction failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
