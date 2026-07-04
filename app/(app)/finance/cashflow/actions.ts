"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { projectCashflow, type CashflowEvent, type CashflowGranularity } from "@/lib/finance/cashflow";
import { round4 } from "@/lib/finance/ledger";
import type { FinInvoice } from "@/lib/supabase/database.types";

export interface CashflowResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Project an entity's cash position forward. Opening cash is proxied by the sum
 * of staged bank transactions on/before `asOf`; the forward events are the
 * entity's open receivables (inflows at due date) and payables (outflows at due
 * date). Pure projection math lives in lib/finance/cashflow.ts. (Tier 1 read.)
 */
export async function getCashflowProjection(input: {
  entityId: string;
  asOf: string;
  horizonDays?: number;
  granularity?: CashflowGranularity;
}): Promise<CashflowResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!input.entityId || !input.asOf) {
    return { ok: false, error: "Entity and as-of date are required." };
  }
  if (Number.isNaN(Date.parse(`${input.asOf}T00:00:00Z`))) {
    return { ok: false, error: "Invalid as-of date." };
  }
  const supabase = await createServerClient();

  // Opening cash ≈ net of all staged bank transactions on/before as-of.
  const { data: accountRows } = await supabase
    .from("fin_bank_accounts")
    .select("id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("entity_id", input.entityId);
  const accountIds = (accountRows ?? []).map((a) => (a as { id: string }).id);
  let openingBalance = 0;
  if (accountIds.length) {
    const { data: txnRows } = await supabase
      .from("fin_bank_transactions")
      .select("amount")
      .eq("organization_id", auth.ctx.orgId)
      .in("bank_account_id", accountIds)
      .lte("txn_date", input.asOf);
    openingBalance = round4(
      (txnRows ?? []).reduce((sum, t) => sum + (t as { amount: number }).amount, 0),
    );
  }

  // Forward events: open/partial receivables inflow, payables outflow, at due date.
  const { data: invoiceRows } = await supabase
    .from("fin_invoices")
    .select("kind, total, amount_paid, due_date")
    .eq("organization_id", auth.ctx.orgId)
    .eq("entity_id", input.entityId)
    .in("status", ["open", "partial"]);
  const events: CashflowEvent[] = ((invoiceRows ?? []) as Pick<
    FinInvoice,
    "kind" | "total" | "amount_paid" | "due_date"
  >[])
    .map((inv) => {
      const outstanding = round4(inv.total - inv.amount_paid);
      if (outstanding <= 0) return null;
      const signed = inv.kind === "receivable" ? outstanding : -outstanding;
      return { date: inv.due_date, amount: signed, category: inv.kind } as CashflowEvent;
    })
    .filter((e): e is CashflowEvent => e !== null);

  const projection = projectCashflow(openingBalance, events, {
    asOf: input.asOf,
    horizonDays: input.horizonDays ?? 90,
    granularity: input.granularity ?? "week",
  });
  return { ok: true, data: projection };
}
