"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  computeInvoiceTotals,
  allocatePayment,
  agingSummary,
  type InvoiceLineInput,
  type PayableInvoice,
  type AgingRow,
} from "@/lib/finance/arap";
import type {
  FinInvoiceKind,
  FinPartyKind,
  FinPaymentDirection,
  FinInvoice,
  Json,
} from "@/lib/supabase/database.types";

export interface ArapResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// --- Master data: customers & vendors ---------------------------------------

/** Register a customer/vendor (Tier 1). */
export async function createParty(input: {
  entityId: string;
  kind: FinPartyKind;
  name: string;
  email?: string;
  taxId?: string;
  arControlAccountId?: string;
  apControlAccountId?: string;
}): Promise<ArapResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!input.entityId || !input.name?.trim()) {
    return { ok: false, error: "Entity and name are required." };
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("fin_parties")
    .insert({
      organization_id: auth.ctx.orgId,
      entity_id: input.entityId,
      kind: input.kind,
      name: input.name.trim(),
      email: input.email?.trim() || null,
      tax_id: input.taxId?.trim() || null,
      ar_control_account_id: input.arControlAccountId ?? null,
      ap_control_account_id: input.apControlAccountId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create party." };
  revalidatePath("/finance");
  return { ok: true, data: { id: data.id } };
}

// --- Invoices (AR) and bills (AP) -------------------------------------------

/**
 * Record an invoice (receivable) or bill (payable): compute line + document
 * totals from the domain core, then insert the invoice and its lines as 'open'.
 * GL posting to the AR/AP control accounts is a follow-up increment. (Tier 1.)
 */
export async function issueInvoice(input: {
  entityId: string;
  partyId: string;
  kind: FinInvoiceKind;
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  memo?: string;
  lines: InvoiceLineInput[];
}): Promise<ArapResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const currency = (input.currency ?? "").trim().toUpperCase();
  if (!input.entityId || !input.partyId || !input.invoiceNo?.trim() || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Entity, party, invoice number, and a 3-letter currency are required." };
  }
  if (!input.lines?.length) return { ok: false, error: "An invoice needs at least one line." };

  const totals = computeInvoiceTotals(input.lines);
  if (totals.total <= 0) return { ok: false, error: "Invoice total must be positive." };

  const supabase = createServerClient();
  const { data: invoice, error: invErr } = await supabase
    .from("fin_invoices")
    .insert({
      organization_id: auth.ctx.orgId,
      entity_id: input.entityId,
      party_id: input.partyId,
      kind: input.kind,
      invoice_no: input.invoiceNo.trim(),
      issue_date: input.issueDate,
      due_date: input.dueDate,
      currency,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      status: "open",
      memo: input.memo?.trim() || null,
      created_by: auth.ctx.userId,
    })
    .select("id")
    .single();
  if (invErr || !invoice) return { ok: false, error: invErr?.message ?? "Could not create invoice." };

  const lineRows = totals.lines.map((l) => ({
    organization_id: auth.ctx.orgId,
    invoice_id: invoice.id,
    line_no: l.lineNo,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    tax_rate: l.taxRate,
    line_subtotal: l.lineSubtotal,
    line_tax: l.lineTax,
    line_total: l.lineTotal,
  }));
  const { error: lineErr } = await supabase.from("fin_invoice_lines").insert(lineRows);
  if (lineErr) {
    // Roll back the header so we never leave a total with no lines behind it.
    await supabase.from("fin_invoices").delete().eq("id", invoice.id);
    return { ok: false, error: lineErr.message };
  }

  revalidatePath("/finance");
  return { ok: true, data: { invoiceId: invoice.id, total: totals.total } };
}

// --- Payments ----------------------------------------------------------------

/**
 * Record a payment and allocate it across the party's open invoices. Explicit
 * allocations are honored; otherwise the amount is applied oldest-due first. The
 * payment, its allocations, and each invoice's amount_paid/status are written in
 * one transaction by the fin_apply_payment RPC. (Tier 1.)
 */
export async function recordPayment(input: {
  entityId: string;
  partyId: string;
  direction: FinPaymentDirection;
  paymentDate: string;
  currency: string;
  amount: number;
  memo?: string;
  bankAccountId?: string;
  allocations?: { invoiceId: string; amount: number }[];
}): Promise<ArapResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const currency = (input.currency ?? "").trim().toUpperCase();
  if (!input.entityId || !input.partyId || !(input.amount > 0) || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Entity, party, a positive amount, and a 3-letter currency are required." };
  }
  const supabase = createServerClient();

  let allocations = input.allocations;
  if (!allocations) {
    // Auto-allocate oldest-due first against the matching open invoices: an
    // inbound payment settles receivables, an outbound one settles payables.
    const kind: FinInvoiceKind = input.direction === "inbound" ? "receivable" : "payable";
    const { data: openRows } = await supabase
      .from("fin_invoices")
      .select("id, total, amount_paid, due_date")
      .eq("organization_id", auth.ctx.orgId)
      .eq("entity_id", input.entityId)
      .eq("party_id", input.partyId)
      .eq("kind", kind)
      .in("status", ["open", "partial"]);
    const open: PayableInvoice[] = ((openRows ?? []) as Pick<
      FinInvoice,
      "id" | "total" | "amount_paid" | "due_date"
    >[]).map((r) => ({ id: r.id, outstanding: r.total - r.amount_paid, dueDate: r.due_date }));
    allocations = allocatePayment(input.amount, open, "oldest-first").allocations;
  }

  const { data: paymentId, error } = await supabase.rpc("fin_apply_payment", {
    p_payment: {
      organizationId: auth.ctx.orgId,
      entityId: input.entityId,
      partyId: input.partyId,
      direction: input.direction,
      paymentDate: input.paymentDate,
      currency,
      amount: input.amount,
      memo: input.memo ?? null,
      bankAccountId: input.bankAccountId ?? "",
    } as unknown as Json,
    p_allocations: allocations as unknown as Json,
    p_actor: auth.ctx.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finance");
  return { ok: true, data: { paymentId, allocated: allocations } };
}

// --- Aging report ------------------------------------------------------------

/** Receivables/payables aging for an entity as of a date (Tier 1 read). */
export async function agingReport(input: {
  entityId: string;
  kind: FinInvoiceKind;
  asOf: string;
}): Promise<ArapResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const { data: rows } = await supabase
    .from("fin_invoices")
    .select("id, party_id, total, amount_paid, due_date")
    .eq("organization_id", auth.ctx.orgId)
    .eq("entity_id", input.entityId)
    .eq("kind", input.kind)
    .in("status", ["open", "partial"]);
  const aging: AgingRow[] = ((rows ?? []) as Pick<
    FinInvoice,
    "party_id" | "total" | "amount_paid" | "due_date"
  >[])
    .map((r) => ({ partyId: r.party_id, dueDate: r.due_date, outstanding: r.total - r.amount_paid }))
    .filter((r) => r.outstanding > 0);
  return { ok: true, data: agingSummary(aging, input.asOf) };
}
