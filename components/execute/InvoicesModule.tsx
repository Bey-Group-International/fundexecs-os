// components/execute/InvoicesModule.tsx
// Execute › Invoices — live data wiring for the native AR/AP board. Server
// component: resolves org context, reads the finance entities, parties, and
// invoices (RLS-enforced, request-scoped client), maps each row onto the shape
// the presentational board expects, and computes party names for display. Every
// read is best-effort — any failure (no org, query error, exception) degrades to
// an empty board rather than throwing, so the Invoices module always renders its
// empty states. The board itself posts to the existing finance server actions.
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { InvoicesBoard } from "@/components/execute/InvoicesBoard";
import type {
  InvoiceEntity,
  InvoiceParty,
  InvoiceRow,
} from "@/components/execute/InvoicesBoard";
import type {
  FinEntity,
  FinParty,
  FinInvoice,
} from "@/lib/supabase/database.types";

interface InvoicesData {
  entities: InvoiceEntity[];
  parties: InvoiceParty[];
  invoices: InvoiceRow[];
  asOf: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY = (): InvoicesData => ({
  entities: [],
  parties: [],
  invoices: [],
  asOf: today(),
});

async function loadInvoicesData(): Promise<InvoicesData> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return EMPTY();
    const orgId = ctx.orgId;

    const supabase = await createServerClient();

    const [entitiesRes, partiesRes, invoicesRes] = await Promise.all([
      supabase
        .from("fin_entities")
        .select("id, name, base_currency")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
      supabase
        .from("fin_parties")
        .select("id, name, kind, entity_id, is_active")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
      supabase
        .from("fin_invoices")
        .select(
          "id, entity_id, party_id, kind, invoice_no, issue_date, due_date, currency, total, amount_paid, status",
        )
        .eq("organization_id", orgId)
        .order("issue_date", { ascending: false }),
    ]);

    const entityRows = (entitiesRes.data ?? []) as Pick<
      FinEntity,
      "id" | "name" | "base_currency"
    >[];
    const partyRows = (partiesRes.data ?? []) as Pick<
      FinParty,
      "id" | "name" | "kind" | "entity_id" | "is_active"
    >[];
    const invoiceRows = (invoicesRes.data ?? []) as Pick<
      FinInvoice,
      | "id"
      | "entity_id"
      | "party_id"
      | "kind"
      | "invoice_no"
      | "issue_date"
      | "due_date"
      | "currency"
      | "total"
      | "amount_paid"
      | "status"
    >[];

    const partyName = new Map(partyRows.map((p) => [p.id, p.name]));

    const entities: InvoiceEntity[] = entityRows.map((e) => ({
      id: e.id,
      name: e.name,
      baseCurrency: e.base_currency,
    }));

    const parties: InvoiceParty[] = partyRows.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      entityId: p.entity_id,
      isActive: p.is_active,
    }));

    const invoices: InvoiceRow[] = invoiceRows.map((r) => ({
      id: r.id,
      entityId: r.entity_id,
      partyId: r.party_id,
      partyName: partyName.get(r.party_id) ?? "Unknown party",
      kind: r.kind,
      invoiceNo: r.invoice_no,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      currency: r.currency,
      total: r.total,
      amountPaid: r.amount_paid,
      status: r.status,
    }));

    return { entities, parties, invoices, asOf: today() };
  } catch {
    // Best-effort: any failure degrades to the existing empty states.
    return EMPTY();
  }
}

export async function InvoicesModule() {
  const { entities, parties, invoices, asOf } = await loadInvoicesData();

  return (
    <InvoicesBoard
      entities={entities}
      parties={parties}
      invoices={invoices}
      asOf={asOf}
    />
  );
}
