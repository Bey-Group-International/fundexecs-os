"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  computeInvoiceTotals,
  agingSummary,
  type InvoiceLineInput,
  type AgingRow,
} from "@/lib/finance/arap";
import { invoiceJournalLines, paymentJournalLines } from "@/lib/finance/posting";
import { postJournalEntry, reverseJournalEntry } from "../actions";
import type {
  FinInvoiceKind,
  FinPartyKind,
  FinPaymentDirection,
  FinInvoice,
  FinInvoiceLine,
  FinPayment,
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
      // Insert as 'draft' first: aging/cashflow only see 'open'/'partial', so
      // there is no window where a header without lines is counted anywhere.
      status: "draft",
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
    // Clean up the draft (already invisible to reports) on line failure.
    await supabase.from("fin_invoices").delete().eq("id", invoice.id);
    return { ok: false, error: lineErr.message };
  }
  // Lines are in place — publish the invoice.
  await supabase.from("fin_invoices").update({ status: "open" }).eq("id", invoice.id);

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

  // When no explicit allocations are supplied, the RPC auto-allocates oldest-due
  // first INSIDE the transaction (open invoices locked FOR UPDATE), so there is
  // no read-then-write window for a concurrent payment to overpay an invoice.
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
    p_allocations: (input.allocations ?? []) as unknown as Json,
    p_actor: auth.ctx.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finance");
  return { ok: true, data: { paymentId } };
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
  if (Number.isNaN(Date.parse(`${input.asOf}T00:00:00Z`))) {
    return { ok: false, error: "Invalid as-of date." };
  }
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

// --- GL posting --------------------------------------------------------------

// Resolve a party's AR (receivable) or AP (payable) control account + its name.
async function resolveControlAccount(
  supabase: ReturnType<typeof createServerClient>,
  orgId: string,
  partyId: string,
  receivable: boolean,
): Promise<{ accountId: string | null; partyName: string | null }> {
  const { data } = await supabase
    .from("fin_parties")
    .select("name, ar_control_account_id, ap_control_account_id")
    .eq("organization_id", orgId)
    .eq("id", partyId)
    .maybeSingle();
  const p = data as {
    name: string;
    ar_control_account_id: string | null;
    ap_control_account_id: string | null;
  } | null;
  return {
    accountId: (receivable ? p?.ar_control_account_id : p?.ap_control_account_id) ?? null,
    partyName: p?.name ?? null,
  };
}

/**
 * Post an issued invoice's accrual entry to the ledger — receivable: Dr AR
 * control, Cr revenue + tax; payable: Dr expense + tax, Cr AP control — and
 * record the entry id back on the invoice. The posting itself is the Phase-1
 * Tier-1 `post_journal_entry`. Idempotent: a posted invoice is rejected.
 */
export async function postInvoice(input: {
  invoiceId: string;
  ledgerId: string;
  periodId: string;
  controlAccountId?: string;
  taxAccountId?: string;
  defaultLineAccountId?: string;
}): Promise<ArapResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();

  const { data: inv } = await supabase
    .from("fin_invoices")
    .select("party_id, kind, currency, issue_date, status, posted_entry_id, invoice_no")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found." };
  const invoice = inv as Pick<
    FinInvoice,
    "party_id" | "kind" | "currency" | "issue_date" | "status" | "posted_entry_id" | "invoice_no"
  >;
  if (invoice.posted_entry_id) return { ok: false, error: "Invoice is already posted." };
  if (invoice.status !== "open" && invoice.status !== "partial") {
    return { ok: false, error: "Only an open invoice can be posted." };
  }

  const resolved = await resolveControlAccount(
    supabase,
    auth.ctx.orgId,
    invoice.party_id,
    invoice.kind === "receivable",
  );
  const controlAccountId = input.controlAccountId ?? resolved.accountId ?? undefined;
  if (!controlAccountId) return { ok: false, error: "No control account configured for this party." };

  const { data: lineRows } = await supabase
    .from("fin_invoice_lines")
    .select("income_account_id, line_subtotal, line_tax")
    .eq("organization_id", auth.ctx.orgId)
    .eq("invoice_id", input.invoiceId);
  const lines = (lineRows ?? []) as Pick<
    FinInvoiceLine,
    "income_account_id" | "line_subtotal" | "line_tax"
  >[];
  if (!lines.length) return { ok: false, error: "Invoice has no lines." };

  let journalLines;
  try {
    journalLines = invoiceJournalLines(
      invoice.kind,
      invoice.currency,
      lines.map((l) => ({
        incomeAccountId: l.income_account_id,
        lineSubtotal: l.line_subtotal,
        lineTax: l.line_tax,
      })),
      {
        controlAccountId,
        taxAccountId: input.taxAccountId ?? null,
        defaultLineAccountId: input.defaultLineAccountId ?? null,
      },
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const posted = await postJournalEntry({
    ledgerId: input.ledgerId,
    periodId: input.periodId,
    entryDate: invoice.issue_date,
    memo: `${invoice.kind === "receivable" ? "Invoice" : "Bill"} ${invoice.invoice_no} · ${resolved.partyName ?? "party"}`,
    lines: journalLines,
  });
  if (!posted.ok) return { ok: false, error: posted.error ?? "Could not post the invoice entry." };
  const entryId = (posted.data as { entryId?: string })?.entryId;
  if (!entryId) return { ok: false, error: "Journal entry returned no id." };
  // Optimistic lock: only attach the entry if the invoice is still unposted, so
  // a concurrent post is detected rather than silently double-linking.
  const { data: linked } = await supabase
    .from("fin_invoices")
    .update({ posted_entry_id: entryId })
    .eq("id", input.invoiceId)
    .is("posted_entry_id", null)
    .select("id");
  if (!linked?.length) {
    // A concurrent request already posted this invoice. Our entry is now an
    // unlinked duplicate — reverse it so the ledger nets to zero (no orphan).
    const reversal = await reverseJournalEntry({
      entryId,
      entryDate: invoice.issue_date,
      memo: "Auto-reversal: concurrent duplicate post",
    });
    if (!reversal.ok) {
      console.error(`[postInvoice] auto-reversal failed for entry ${entryId}: ${reversal.error}`);
    }
    return {
      ok: false,
      error: `Invoice was already posted by a concurrent request; the duplicate entry was ${
        reversal.ok ? "reversed" : "NOT reversed — manual cleanup needed"
      }.`,
    };
  }
  revalidatePath("/finance");
  return { ok: true, data: { invoiceId: input.invoiceId, entryId } };
}

/**
 * Post a payment's cash entry to the ledger — inbound: Dr cash, Cr AR control;
 * outbound: Dr AP control, Cr cash — and record the entry id on the payment.
 * Cash account defaults to the linked bank account's GL account.
 */
export async function postPayment(input: {
  paymentId: string;
  ledgerId: string;
  periodId: string;
  controlAccountId?: string;
  cashAccountId?: string;
}): Promise<ArapResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();

  const { data: pay } = await supabase
    .from("fin_payments")
    .select("party_id, direction, currency, amount, payment_date, bank_account_id, posted_entry_id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", input.paymentId)
    .maybeSingle();
  if (!pay) return { ok: false, error: "Payment not found." };
  const payment = pay as Pick<
    FinPayment,
    "party_id" | "direction" | "currency" | "amount" | "payment_date" | "bank_account_id" | "posted_entry_id"
  >;
  if (payment.posted_entry_id) return { ok: false, error: "Payment is already posted." };

  const resolved = await resolveControlAccount(
    supabase,
    auth.ctx.orgId,
    payment.party_id,
    payment.direction === "inbound",
  );
  const controlAccountId = input.controlAccountId ?? resolved.accountId ?? undefined;
  if (!controlAccountId) return { ok: false, error: "No control account configured for this party." };

  let cashAccountId = input.cashAccountId;
  if (!cashAccountId && payment.bank_account_id) {
    const { data: bank } = await supabase
      .from("fin_bank_accounts")
      .select("gl_account_id")
      .eq("organization_id", auth.ctx.orgId)
      .eq("id", payment.bank_account_id)
      .maybeSingle();
    cashAccountId = (bank as { gl_account_id: string } | null)?.gl_account_id;
  }
  if (!cashAccountId) return { ok: false, error: "No cash account resolved (link a bank account or pass one)." };

  let journalLines;
  try {
    journalLines = paymentJournalLines(
      payment.direction,
      payment.currency,
      payment.amount,
      controlAccountId,
      cashAccountId,
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const posted = await postJournalEntry({
    ledgerId: input.ledgerId,
    periodId: input.periodId,
    entryDate: payment.payment_date,
    memo: `Payment · ${resolved.partyName ?? "party"} · ${payment.payment_date} ${payment.currency} ${payment.amount}`,
    lines: journalLines,
  });
  if (!posted.ok) return { ok: false, error: posted.error ?? "Could not post the payment entry." };
  const entryId = (posted.data as { entryId?: string })?.entryId;
  if (!entryId) return { ok: false, error: "Journal entry returned no id." };
  // Optimistic lock: attach only if still unposted (detect a concurrent post).
  const { data: linked } = await supabase
    .from("fin_payments")
    .update({ posted_entry_id: entryId })
    .eq("id", input.paymentId)
    .is("posted_entry_id", null)
    .select("id");
  if (!linked?.length) {
    const reversal = await reverseJournalEntry({
      entryId,
      entryDate: payment.payment_date,
      memo: "Auto-reversal: concurrent duplicate post",
    });
    if (!reversal.ok) {
      console.error(`[postPayment] auto-reversal failed for entry ${entryId}: ${reversal.error}`);
    }
    return {
      ok: false,
      error: `Payment was already posted by a concurrent request; the duplicate entry was ${
        reversal.ok ? "reversed" : "NOT reversed — manual cleanup needed"
      }.`,
    };
  }
  revalidatePath("/finance");
  return { ok: true, data: { paymentId: input.paymentId, entryId } };
}
