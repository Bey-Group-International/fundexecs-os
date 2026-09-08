// lib/admin/subscription-invoices.ts
// The admin console's view of subscription billing: which operators have been
// invoiced and which of those bills are still waiting on money.
//
// Reads run on the service role because this is a cross-organization view — the
// whole point is to see every org's outstanding bill in one place, which no
// org-scoped RLS read can do. Callers MUST be behind requirePlatformAdmin.
import { createServiceClient } from "@/lib/supabase/server";
import type { SubscriptionInvoice } from "@/lib/subscription-invoices";

export interface AdminInvoiceRow extends SubscriptionInvoice {
  /** Organization name, so staff can match a wire to a customer. */
  organization_name: string | null;
}

/**
 * Open subscription invoices, oldest first — the ones most overdue surface at
 * the top, which is the order someone chasing payments wants them in.
 */
export async function listOpenSubscriptionInvoices(limit = 100): Promise<AdminInvoiceRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("status", "open")
    .order("due_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[admin] could not list open subscription invoices:", error);
    return [];
  }

  const invoices = (data ?? []) as SubscriptionInvoice[];
  if (invoices.length === 0) return [];

  // One lookup for the names rather than a join, so a missing organization row
  // degrades to an unnamed line instead of dropping the invoice entirely.
  const orgIds = [...new Set(invoices.map((i) => i.organization_id))];
  const { data: orgs } = await service
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);
  const names = new Map(
    ((orgs ?? []) as { id: string; name: string | null }[]).map((o) => [o.id, o.name]),
  );

  return invoices.map((invoice) => ({
    ...invoice,
    organization_name: names.get(invoice.organization_id) ?? null,
  }));
}

/** Recently settled bills, so staff can see what a confirmation actually did. */
export async function listRecentlySettledInvoices(limit = 10): Promise<AdminInvoiceRow[]> {
  const service = createServiceClient();
  const { data } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(limit);
  const invoices = (data ?? []) as SubscriptionInvoice[];
  if (invoices.length === 0) return [];

  const orgIds = [...new Set(invoices.map((i) => i.organization_id))];
  const { data: orgs } = await service
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);
  const names = new Map(
    ((orgs ?? []) as { id: string; name: string | null }[]).map((o) => [o.id, o.name]),
  );
  return invoices.map((invoice) => ({
    ...invoice,
    organization_name: names.get(invoice.organization_id) ?? null,
  }));
}
