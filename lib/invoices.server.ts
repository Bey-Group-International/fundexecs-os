// lib/invoices.server.ts
// Persistence + fulfillment for payment-link invoices. Split from lib/invoices
// (the pure core) because these touch Supabase and the service role — the same
// split lib/deal-share(.server) uses. Authed writes go through the RLS-enforced
// server client; the public pay page and Stripe fulfillment go through the
// service role, gated only by the unguessable token.
import {
  createServerClient,
  createServiceClient,
  hasSupabaseServiceEnv,
} from "@/lib/supabase/server";
import {
  validateInvoiceDraft,
  nextInvoiceNumber,
  formatMoney,
  lineItemSubtotalCents,
} from "@/lib/invoices";
import { facilitatedPaymentHref } from "@/lib/payment-links";
import { sendEmail, invoiceReceiptEmail, invoiceCreatedEmail } from "@/lib/email";
import type { InvoiceDraft, PaymentInvoice } from "@/lib/invoices";

// Create an open invoice for the caller's org. Writer RLS gates the insert; the
// public token is DB-generated. The stored amount is derived from the validated
// line items, and any facilitated-payment URI is normalized/validated first so a
// bad scheme never reaches the pay page's <head>.
export async function createInvoice(
  orgId: string,
  createdBy: string | null,
  draft: InvoiceDraft,
): Promise<{ invoice?: PaymentInvoice; error?: string }> {
  const v = validateInvoiceDraft(draft);
  if (!v.ok) return { error: v.error };

  const supabase = await createServerClient();

  // Assign the next per-org invoice number unless the caller supplied one.
  let number = draft.number?.trim() || null;
  if (!number) {
    const { data: last } = await supabase
      .from("payment_invoices")
      .select("number")
      .eq("organization_id", orgId)
      .not("number", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    number = nextInvoiceNumber((last as { number?: string | null } | null)?.number ?? null);
  }

  const { data, error } = await supabase
    .from("payment_invoices")
    .insert({
      organization_id: orgId,
      number,
      title: draft.title.trim(),
      description: draft.description?.trim() || null,
      customer_name: draft.customerName?.trim() || null,
      customer_email: draft.customerEmail?.trim() || null,
      currency: (draft.currency ?? "usd").toLowerCase(),
      line_items: v.items,
      amount_cents: v.totalCents,
      status: "open",
      facilitated_payment_url: facilitatedPaymentHref(draft.facilitatedPaymentUrl),
      due_date: draft.dueDate || null,
      created_by: createdBy,
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    console.error("[invoices] create failed:", error);
    return { error: "Could not create the invoice. Please try again." };
  }

  const invoice = data as PaymentInvoice;

  // Best-effort: email the pay link to the customer on creation. Non-fatal —
  // a mail failure (or missing NEXT_PUBLIC_APP_URL) must never fail creation;
  // the merchant can always copy the link from the UI.
  const rawBase = process.env.NEXT_PUBLIC_APP_URL;
  if (invoice.customer_email && rawBase) {
    try {
      const base = rawBase.replace(/\/+$/, "");
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", invoice.organization_id)
        .maybeSingle();
      const merchantName = (org as { name?: string | null } | null)?.name ?? invoice.title;
      const { subject, html } = invoiceCreatedEmail({
        merchantName,
        invoiceTitle: invoice.title,
        invoiceNumber: invoice.number,
        amountFormatted: formatMoney(invoice.amount_cents, invoice.currency),
        payUrl: `${base}/pay/${invoice.token}`,
      });
      await sendEmail({
        to: { name: invoice.customer_name ?? invoice.customer_email, email: invoice.customer_email },
        subject,
        htmlBody: html,
      });
    } catch (err) {
      console.error("[invoices] created-email failed:", err);
    }
  }

  return { invoice };
}

// The caller org's invoices, newest first.
export async function listInvoices(orgId: string, limit = 50): Promise<PaymentInvoice[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("payment_invoices")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PaymentInvoice[];
}

// Void an open/draft invoice the caller owns (writer RLS enforces ownership; a
// paid invoice is left untouched so a receipt can't be revoked after payment).
export async function voidInvoice(
  orgId: string,
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("payment_invoices")
    .update({ status: "void" })
    .eq("id", id)
    .eq("organization_id", orgId)
    .in("status", ["open", "draft"]);
  if (error) {
    console.error("[invoices] void failed:", error);
    return { error: "Could not void the invoice." };
  }
  return { ok: true };
}

// Resolve an invoice by its public token for the unauthenticated pay page.
// Service role (RLS-bypassing) but token-gated — only the row matching the token
// is ever returned. Returns null for an unknown or voided token, or when no
// service key is configured (preview without secrets — fail closed).
export async function getInvoiceByToken(token: string): Promise<PaymentInvoice | null> {
  if (!token || !hasSupabaseServiceEnv()) return null;
  const service = createServiceClient();
  const { data } = await service
    .from("payment_invoices")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  const inv = (data as PaymentInvoice | null) ?? null;
  if (!inv || inv.status === "void") return null;
  return inv;
}

// Mark an invoice paid exactly once (service role). Idempotent: the `neq('paid')`
// guard means a redelivered webhook or a re-hit return URL can't double-apply,
// and the Stripe linkage is recorded for reconciliation.
export async function markInvoicePaid(
  invoiceId: string,
  stripe: { sessionId?: string | null; paymentIntent?: string | null },
): Promise<void> {
  const service = createServiceClient();
  const paidAt = new Date().toISOString();
  // `.select("*")` returns the row ONLY when the `neq('paid')` guard actually
  // flipped it — so a redelivered webhook that no-ops returns no row. That makes
  // the receipt send-once: we only email on the real open→paid transition.
  const { data } = await service
    .from("payment_invoices")
    .update({
      status: "paid",
      paid_at: paidAt,
      stripe_session_id: stripe.sessionId ?? null,
      stripe_payment_intent: stripe.paymentIntent ?? null,
    })
    .eq("id", invoiceId)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();

  const row = (data as PaymentInvoice | null) ?? null;

  // Best-effort receipt to the payer. Entirely non-fatal: a mail failure must
  // never break payment fulfillment, so all of it is wrapped and swallowed.
  if (row && row.customer_email) {
    try {
      const { data: org } = await service
        .from("organizations")
        .select("name")
        .eq("id", row.organization_id)
        .maybeSingle();
      const merchantName = (org as { name?: string | null } | null)?.name ?? row.title;
      const paidOn = new Date(paidAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const { subject, html } = invoiceReceiptEmail({
        merchantName,
        invoiceTitle: row.title,
        invoiceNumber: row.number,
        amountFormatted: formatMoney(row.amount_cents, row.currency),
        paidOn,
        lineItems: (row.line_items ?? []).map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitFormatted: formatMoney(li.unitAmountCents, row.currency),
          subtotalFormatted: formatMoney(lineItemSubtotalCents(li), row.currency),
        })),
      });
      await sendEmail({
        to: { name: row.customer_name ?? row.customer_email, email: row.customer_email },
        subject,
        htmlBody: html,
      });
    } catch (err) {
      console.error("[invoices] receipt-email failed:", err);
    }
  }
}
